import type {
  AuthSession,
  DbMemberInfo,
  InspectorCrawlResult,
  InspectorFullQueryRow,
  RowRef,
  RowSnapshot,
  SavedRowEntry,
} from "@vennbase/core";
import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { getInspectorSession, inspector, signInInspector } from "./client";

type DetailState = {
  status: "idle" | "loading" | "ready" | "error";
  meta: RowSnapshot | null;
  fields: Record<string, unknown> | null;
  directMembers: Array<{ username: string; role: string }>;
  effectiveMembers: DbMemberInfo[];
  children: InspectorFullQueryRow[];
  error: string;
};

function rowKey(row: Pick<RowRef, "id" | "baseUrl">): string {
  return `${row.baseUrl}:${row.id}`;
}

function dedupeRowRefs(rows: RowRef[]): RowRef[] {
  const seen = new Set<string>();
  const output: RowRef[] = [];

  for (const row of rows) {
    const key = rowKey(row);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(row);
  }

  return output;
}

function labelForRow(args: {
  ref: RowRef;
  meta?: RowSnapshot | null;
  fields?: Record<string, unknown> | null;
}): string {
  const fields = args.fields ?? {};
  const previewFields = ["title", "name", "label", "body", "text"];
  for (const fieldName of previewFields) {
    const value = fields[fieldName];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  if (args.meta?.name?.trim()) {
    return args.meta.name.trim();
  }

  return `${args.ref.collection}:${args.ref.id.slice(0, 8)}`;
}

function formatDate(timestamp: number | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "unknown";
  }

  return new Date(timestamp).toLocaleString();
}

function formatVia(via: DbMemberInfo["via"]): string {
  if (via === "direct") {
    return "direct";
  }

  return `${via.collection}:${via.id.slice(0, 8)}`;
}

function formatRoles(roles: DbMemberInfo["roles"]): string {
  return roles.join(", ");
}

function parseManualSeedInput(input: string): RowRef[] {
  const parsed = JSON.parse(input) as unknown;
  const values = Array.isArray(parsed) ? parsed : [parsed];
  const output: RowRef[] = [];

  for (const value of values) {
    if (!value || typeof value !== "object") {
      throw new Error("Each seed must be an object with id, collection, and baseUrl.");
    }

    const candidate = value as Partial<RowRef>;
    if (
      typeof candidate.id !== "string"
      || typeof candidate.collection !== "string"
      || typeof candidate.baseUrl !== "string"
    ) {
      throw new Error("Each seed must include string id, collection, and baseUrl fields.");
    }

    output.push({
      id: candidate.id,
      collection: candidate.collection,
      baseUrl: candidate.baseUrl.replace(/\/+$/g, ""),
    });
  }

  return output;
}

export function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionStatus, setSessionStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sessionError, setSessionError] = useState("");
  const [savedRows, setSavedRows] = useState<SavedRowEntry[]>([]);
  const [savedRowsError, setSavedRowsError] = useState("");
  const [manualSeedDraft, setManualSeedDraft] = useState("");
  const [manualSeedError, setManualSeedError] = useState("");
  const [manualSeeds, setManualSeeds] = useState<RowRef[]>([]);
  const [crawlResult, setCrawlResult] = useState<InspectorCrawlResult | null>(null);
  const [crawlStatus, setCrawlStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [crawlError, setCrawlError] = useState("");
  const [crawlNonce, setCrawlNonce] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectionHistory, setSelectionHistory] = useState<RowRef[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [copyStatus, setCopyStatus] = useState("");
  const [detail, setDetail] = useState<DetailState>({
    status: "idle",
    meta: null,
    fields: null,
    directMembers: [],
    effectiveMembers: [],
    children: [],
    error: "",
  });

  const signedIn = sessionStatus === "ready" && session?.signedIn === true;

  useEffect(() => {
    let cancelled = false;

    setSessionStatus("loading");
    setSessionError("");

    void getInspectorSession()
      .then((nextSession) => {
        if (cancelled) {
          return;
        }

        setSession(nextSession);
        setSessionStatus("ready");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSessionStatus("error");
        setSessionError(error instanceof Error ? error.message : "Failed to resolve session.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setSavedRows([]);
      return;
    }

    let cancelled = false;

    setSavedRowsError("");
    void inspector.listSavedRows()
      .then((rows) => {
        if (!cancelled) {
          setSavedRows(rows);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSavedRowsError(error instanceof Error ? error.message : "Failed to list saved rows.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const seedRefs = dedupeRowRefs([
    ...savedRows.map((entry) => entry.ref),
    ...manualSeeds,
  ]);
  const seedSignature = seedRefs.map((row) => rowKey(row)).join("|");

  useEffect(() => {
    if (!signedIn) {
      setCrawlResult(null);
      setCrawlStatus("idle");
      setCrawlError("");
      return;
    }

    if (seedRefs.length === 0) {
      setCrawlResult({
        nodes: [],
        edges: [],
        errors: [],
      });
      setCrawlStatus("ready");
      return;
    }

    let cancelled = false;

    setCrawlStatus("loading");
    setCrawlError("");

    void inspector.crawl(seedRefs, {
      maxRows: 250,
      childLimit: 200,
    }).then((result) => {
      if (cancelled) {
        return;
      }

      setCrawlResult(result);
      setCrawlStatus("ready");

      if (!selectedKey) {
        const firstRow = result.nodes[0]?.ref ?? seedRefs[0] ?? null;
        if (firstRow) {
          setSelectedKey(rowKey(firstRow));
        }
      }
    }).catch((error) => {
      if (cancelled) {
        return;
      }

      setCrawlStatus("error");
      setCrawlError(error instanceof Error ? error.message : "Failed to crawl row graph.");
    });

    return () => {
      cancelled = true;
    };
  }, [signedIn, seedSignature, crawlNonce]);

  const nodeByKey = new Map<string, InspectorCrawlResult["nodes"][number]>();
  for (const node of crawlResult?.nodes ?? []) {
    nodeByKey.set(rowKey(node.ref), node);
  }

  const inventory = new Map<string, {
    ref: RowRef;
    meta: RowSnapshot | null;
    fields: Record<string, unknown> | null;
    sources: string[];
    crawlErrorCount: number;
  }>();

  for (const savedRow of savedRows) {
    const key = rowKey(savedRow.ref);
    const existing = inventory.get(key);
    const sources = existing?.sources ?? [];
    sources.push(`saved:${savedRow.key}`);
    inventory.set(key, {
      ref: existing?.ref ?? savedRow.ref,
      meta: existing?.meta ?? null,
      fields: existing?.fields ?? null,
      sources,
      crawlErrorCount: existing?.crawlErrorCount ?? 0,
    });
  }

  for (const manualSeed of manualSeeds) {
    const key = rowKey(manualSeed);
    const existing = inventory.get(key);
    const sources = existing?.sources ?? [];
    if (!sources.includes("manual")) {
      sources.push("manual");
    }
    inventory.set(key, {
      ref: existing?.ref ?? manualSeed,
      meta: existing?.meta ?? null,
      fields: existing?.fields ?? null,
      sources,
      crawlErrorCount: existing?.crawlErrorCount ?? 0,
    });
  }

  for (const node of crawlResult?.nodes ?? []) {
    const key = rowKey(node.ref);
    const existing = inventory.get(key);
    inventory.set(key, {
      ref: node.ref,
      meta: node.meta,
      fields: node.fields,
      sources: existing?.sources ?? [],
      crawlErrorCount: crawlResult?.errors.filter((error) => rowKey(error.ref) === key).length ?? 0,
    });
  }

  const inventoryRows = Array.from(inventory.values())
    .filter((entry) => {
      const searchValue = deferredSearch.trim().toLowerCase();
      if (!searchValue) {
        return true;
      }

      const haystack = [
        labelForRow(entry),
        entry.ref.collection,
        entry.ref.id,
        entry.meta?.owner ?? "",
        entry.sources.join(" "),
      ].join(" ").toLowerCase();

      return haystack.includes(searchValue);
    })
    .sort((left, right) => {
      const leftLabel = labelForRow(left).toLowerCase();
      const rightLabel = labelForRow(right).toLowerCase();
      return leftLabel.localeCompare(rightLabel)
        || left.ref.collection.localeCompare(right.ref.collection)
        || left.ref.id.localeCompare(right.ref.id);
    });

  const selectedRef = inventoryRows.find((entry) => rowKey(entry.ref) === selectedKey)?.ref
    ?? seedRefs.find((ref) => rowKey(ref) === selectedKey)
    ?? null;
  const selectedSignature = selectedRef ? rowKey(selectedRef) : "";

  useEffect(() => {
    if (!signedIn || !selectedRef) {
      setDetail({
        status: "idle",
        meta: null,
        fields: null,
        directMembers: [],
        effectiveMembers: [],
        children: [],
        error: "",
      });
      return;
    }

    let cancelled = false;
    setDetail((current) => ({
      ...current,
      status: "loading",
      error: "",
    }));

    void Promise.all([
      inspector.getRowMeta(selectedRef),
      inspector.getRowFields(selectedRef),
      inspector.getDirectMembers(selectedRef),
      inspector.getEffectiveMembers(selectedRef),
      inspector.queryChildren(selectedRef, { limit: 200 }),
    ]).then(([meta, fieldResponse, directMembers, effectiveMembers, children]) => {
      if (cancelled) {
        return;
      }

      setDetail({
        status: "ready",
        meta,
        fields: fieldResponse.fields,
        directMembers,
        effectiveMembers,
        children,
        error: "",
      });
    }).catch((error) => {
      if (cancelled) {
        return;
      }

      setDetail({
        status: "error",
        meta: null,
        fields: null,
        directMembers: [],
        effectiveMembers: [],
        children: [],
        error: error instanceof Error ? error.message : "Failed to load row details.",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [signedIn, selectedSignature]);

  const selectedNode = selectedRef ? nodeByKey.get(rowKey(selectedRef)) ?? null : null;
  const groupedChildren = new Map<string, InspectorFullQueryRow[]>();
  for (const child of detail.children) {
    const existing = groupedChildren.get(child.collection) ?? [];
    existing.push(child);
    groupedChildren.set(child.collection, existing);
  }

  async function handleSignIn(): Promise<void> {
    setSessionStatus("loading");
    setSessionError("");

    try {
      await signInInspector();
      const nextSession = await getInspectorSession();
      setSession(nextSession);
      setSessionStatus("ready");
    } catch (error) {
      setSessionStatus("error");
      setSessionError(error instanceof Error ? error.message : "Failed to sign in.");
    }
  }

  async function refreshSavedRows(): Promise<void> {
    setSavedRowsError("");
    try {
      const rows = await inspector.listSavedRows();
      setSavedRows(rows);
      setCrawlNonce((value) => value + 1);
    } catch (error) {
      setSavedRowsError(error instanceof Error ? error.message : "Failed to reload saved rows.");
    }
  }

  function selectRow(ref: RowRef): void {
    const nextKey = rowKey(ref);
    startTransition(() => {
      setSelectedKey(nextKey);
    });
    setSelectionHistory((current) => {
      const next = current.filter((entry) => rowKey(entry) !== nextKey);
      next.unshift(ref);
      return next.slice(0, 12);
    });
  }

  async function copySelectedRef(): Promise<void> {
    if (!selectedRef) {
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedRef, null, 2));
      setCopyStatus("Row ref copied.");
    } catch {
      setCopyStatus("Clipboard write failed.");
    }
  }

  function addManualSeeds(): void {
    setManualSeedError("");

    try {
      const parsed = parseManualSeedInput(manualSeedDraft);
      setManualSeeds((current) => dedupeRowRefs([...current, ...parsed]));
      setManualSeedDraft("");
      setCrawlNonce((value) => value + 1);
      if (!selectedKey && parsed[0]) {
        setSelectedKey(rowKey(parsed[0]));
      }
    } catch (error) {
      setManualSeedError(error instanceof Error ? error.message : "Invalid seed input.");
    }
  }

  const selectedRawJson = JSON.stringify({
    selectedRef,
    crawlNode: selectedNode,
    detail,
    crawlErrors: crawlResult?.errors.filter((error) => selectedRef && rowKey(error.ref) === rowKey(selectedRef)) ?? [],
  }, null, 2);

  if (sessionStatus === "loading") {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div>
            <div className="eyebrow">Vennbase Inspector</div>
            <h1>Connecting to Puter</h1>
          </div>
        </header>
        <main className="empty-state">
          <p>Checking session and loading the app context.</p>
        </main>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div>
            <div className="eyebrow">Vennbase Inspector</div>
            <h1>Read app data from the current origin</h1>
          </div>
        </header>
        <main className="empty-state">
          <p className="muted-copy">This inspector uses the same Puter app silo as whatever is currently running on this origin.</p>
          <button className="primary-button" type="button" onClick={() => void handleSignIn()}>
            Log in with Puter
          </button>
          <p className="error-copy">{sessionError}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Vennbase Inspector</div>
          <h1>{session?.signedIn ? session.user.username : "Unknown user"} on {window.location.origin}</h1>
        </div>
        <div className="toolbar">
          <button className="secondary-button" type="button" onClick={() => void refreshSavedRows()}>
            Reload seeds
          </button>
          <button className="secondary-button" type="button" onClick={() => setCrawlNonce((value) => value + 1)}>
            Crawl graph
          </button>
          <button className="secondary-button" type="button" onClick={() => void copySelectedRef()}>
            Copy ref
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="pane pane-left">
          <section className="section-block">
            <div className="section-head">
              <h2>Seeds</h2>
              <span className="count-chip">{seedRefs.length}</span>
            </div>
            <p className="small-copy">Saved rows plus any manual seed refs you add below.</p>
            <textarea
              className="seed-input"
              rows={6}
              placeholder='{"id":"row_123","collection":"projects","baseUrl":"https://worker.example"}'
              value={manualSeedDraft}
              onChange={(event) => setManualSeedDraft(event.target.value)}
            />
            <div className="inline-actions">
              <button className="secondary-button" type="button" onClick={addManualSeeds}>
                Add seed
              </button>
              <button className="secondary-button" type="button" onClick={() => setManualSeeds([])}>
                Clear manual
              </button>
            </div>
            {manualSeedError ? <p className="error-copy">{manualSeedError}</p> : null}
            {savedRowsError ? <p className="error-copy">{savedRowsError}</p> : null}
          </section>

          <section className="section-block section-fill">
            <div className="section-head">
              <h2>Rows</h2>
              <span className="count-chip">{inventoryRows.length}</span>
            </div>
            <input
              className="search-input"
              type="search"
              placeholder="Filter rows"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="list-view">
              {inventoryRows.length === 0 ? (
                <p className="small-copy">No rows discovered yet.</p>
              ) : null}
              {inventoryRows.map((entry) => {
                const active = selectedKey === rowKey(entry.ref);
                return (
                  <button
                    key={rowKey(entry.ref)}
                    className={`row-item ${active ? "selected" : ""}`}
                    type="button"
                    onClick={() => selectRow(entry.ref)}
                  >
                    <span className="row-item-top">
                      <span className="row-label">{labelForRow(entry)}</span>
                      <span className="row-collection">{entry.ref.collection}</span>
                    </span>
                    <span className="row-item-bottom">
                      <span className="mono-copy">{entry.ref.id}</span>
                      <span>{entry.sources.join(" ")}</span>
                      {entry.crawlErrorCount > 0 ? <span className="error-pill">{entry.crawlErrorCount} errors</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        <main className="pane pane-center">
          <section className="section-block">
            <div className="section-head">
              <h2>Selection</h2>
              <span className="count-chip">{detail.children.length} children</span>
            </div>
            {!selectedRef ? <p className="small-copy">Select a row to inspect it.</p> : null}
            {selectedRef ? (
              <>
                <div className="meta-grid">
                  <div className="meta-cell">
                    <span className="meta-label">Label</span>
                    <span>{labelForRow({ ref: selectedRef, meta: detail.meta, fields: detail.fields })}</span>
                  </div>
                  <div className="meta-cell">
                    <span className="meta-label">Collection</span>
                    <span>{detail.meta?.collection ?? selectedRef.collection}</span>
                  </div>
                  <div className="meta-cell">
                    <span className="meta-label">Owner</span>
                    <span>{detail.meta?.owner ?? "unknown"}</span>
                  </div>
                  <div className="meta-cell">
                    <span className="meta-label">Created</span>
                    <span>{formatDate(detail.meta?.createdAt)}</span>
                  </div>
                  <div className="meta-cell meta-cell-wide">
                    <span className="meta-label">Base URL</span>
                    <span className="mono-copy">{selectedRef.baseUrl}</span>
                  </div>
                  <div className="meta-cell meta-cell-wide">
                    <span className="meta-label">Row ID</span>
                    <span className="mono-copy">{selectedRef.id}</span>
                  </div>
                </div>
                <p className="error-copy">{detail.status === "error" ? detail.error : ""}</p>
                <p className="small-copy">{copyStatus}</p>
              </>
            ) : null}
          </section>

          <section className="section-block">
            <div className="section-head">
              <h2>Fields</h2>
              <span className="count-chip">{Object.entries(detail.fields ?? {}).length}</span>
            </div>
            <div className="data-table">
              {(Object.entries(detail.fields ?? {})).map(([fieldName, value]) => (
                <div key={fieldName} className="data-row">
                  <div className="data-key">{fieldName}</div>
                  <pre className="data-value">{JSON.stringify(value, null, 2)}</pre>
                </div>
              ))}
              {Object.keys(detail.fields ?? {}).length === 0 ? <p className="small-copy">No stored fields.</p> : null}
            </div>
          </section>

          <section className="section-block">
            <div className="section-head">
              <h2>Parents</h2>
              <span className="count-chip">{detail.meta?.parentRefs.length ?? 0}</span>
            </div>
            <div className="list-view">
              {(detail.meta?.parentRefs ?? []).map((parentRef) => (
                <button
                  key={rowKey(parentRef)}
                  className="linked-row"
                  type="button"
                  onClick={() => selectRow(parentRef)}
                >
                  <span>{parentRef.collection}</span>
                  <span className="mono-copy">{parentRef.id}</span>
                </button>
              ))}
              {(detail.meta?.parentRefs.length ?? 0) === 0 ? <p className="small-copy">No parents.</p> : null}
            </div>
          </section>

          <section className="section-block">
            <div className="section-head">
              <h2>Children</h2>
              <span className="count-chip">{detail.children.length}</span>
            </div>
            <div className="children-groups">
              {Array.from(groupedChildren.entries()).map(([collection, rows]) => (
                <div key={collection} className="child-group">
                  <div className="child-group-head">
                    <span>{collection}</span>
                    <span className="count-chip">{rows.length}</span>
                  </div>
                  {rows.map((child) => (
                    <button
                      key={rowKey(child.ref)}
                      className="linked-row"
                      type="button"
                      onClick={() => selectRow(child.ref)}
                    >
                      <span>{labelForRow({ ref: child.ref, fields: child.fields })}</span>
                      <span className="mono-copy">{child.id}</span>
                    </button>
                  ))}
                </div>
              ))}
              {detail.children.length === 0 ? <p className="small-copy">No indexed child rows discovered.</p> : null}
            </div>
          </section>

          <section className="section-block">
            <div className="section-head">
              <h2>Members</h2>
              <span className="count-chip">{detail.effectiveMembers.length}</span>
            </div>
            <div className="member-grid">
              <div>
                <h3>Direct</h3>
                {(detail.directMembers).map((member) => (
                  <div key={`${member.username}:${member.role}`} className="member-row">
                    <span>{member.username}</span>
                    <span>{member.role}</span>
                  </div>
                ))}
                {detail.directMembers.length === 0 ? <p className="small-copy">No direct members.</p> : null}
              </div>
              <div>
                <h3>Effective</h3>
                {(detail.effectiveMembers).map((member) => (
                  <div key={`${member.username}:${formatRoles(member.roles)}:${formatVia(member.via)}`} className="member-row">
                    <span>{member.username}</span>
                    <span>{formatRoles(member.roles)}</span>
                    <span className="mono-copy">{formatVia(member.via)}</span>
                  </div>
                ))}
                {detail.effectiveMembers.length === 0 ? <p className="small-copy">No effective members.</p> : null}
              </div>
            </div>
          </section>
        </main>

        <aside className="pane pane-right">
          <section className="section-block">
            <div className="section-head">
              <h2>Diagnostics</h2>
              <span className="count-chip">{crawlResult?.errors.length ?? 0}</span>
            </div>
            <div className="stats-grid">
              <div className="stat-cell">
                <span className="meta-label">Seeds</span>
                <span>{seedRefs.length}</span>
              </div>
              <div className="stat-cell">
                <span className="meta-label">Nodes</span>
                <span>{crawlResult?.nodes.length ?? 0}</span>
              </div>
              <div className="stat-cell">
                <span className="meta-label">Edges</span>
                <span>{crawlResult?.edges.length ?? 0}</span>
              </div>
              <div className="stat-cell">
                <span className="meta-label">Status</span>
                <span>{crawlStatus}</span>
              </div>
            </div>
            <p className="error-copy">{crawlStatus === "error" ? crawlError : ""}</p>
          </section>

          <section className="section-block">
            <div className="section-head">
              <h2>History</h2>
              <span className="count-chip">{selectionHistory.length}</span>
            </div>
            <div className="list-view">
              {selectionHistory.map((entry) => (
                <button
                  key={rowKey(entry)}
                  className="linked-row"
                  type="button"
                  onClick={() => selectRow(entry)}
                >
                  <span>{entry.collection}</span>
                  <span className="mono-copy">{entry.id}</span>
                </button>
              ))}
              {selectionHistory.length === 0 ? <p className="small-copy">Selections appear here.</p> : null}
            </div>
          </section>

          <section className="section-block section-fill">
            <div className="section-head">
              <h2>Raw JSON</h2>
              <span className="count-chip">{selectedRef ? "selected" : "none"}</span>
            </div>
            <pre className="raw-json">{selectedRawJson}</pre>
          </section>
        </aside>
      </div>
    </div>
  );
}

import { createAdaptivePoller } from "./polling";
import { RowHandle, type RowHandleBackend } from "./row-handle";
import type { Rows } from "./rows";
import type { DbQueryOptions, DbQueryWatchCallbacks, DbQueryWatchHandle, DbRowRef, DbSchema } from "./schema";
import { getCollectionSpec, pickIndex } from "./schema";
import type { Transport } from "./transport";
import { roomEndpointUrl, stripTrailingSlash } from "./transport";
import type { JsonValue } from "./types";

interface DbQueryRow {
  rowId: string;
  owner: string;
  workerUrl: string;
  collection: string;
  fields: Record<string, JsonValue>;
}

interface DbQueryResponse {
  rows: DbQueryRow[];
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function snapshotRows(rows: RowHandle[]): string {
  const snapshot = rows.map((row) => ({
    id: row.id,
    collection: row.collection,
    owner: row.owner,
    workerUrl: row.workerUrl,
    fields: row.fields,
  }));
  return stableJsonStringify(snapshot);
}

function normalizeParents(input: DbRowRef | DbRowRef[]): DbRowRef[] {
  return Array.isArray(input) ? input : [input];
}

export class Query {
  constructor(
    private readonly transport: Transport,
    private readonly rows: Rows,
    private readonly schema: DbSchema,
    private readonly backend: RowHandleBackend,
  ) {}

  async query(
    collection: string,
    options: DbQueryOptions,
  ): Promise<RowHandle[]> {
    const parentRefs = normalizeParents(options.in);
    if (parentRefs.length === 0) {
      throw new Error("query requires at least one parent in scope");
    }

    const collectionSpec = getCollectionSpec(this.schema, collection);
    const selectedIndex = pickIndex(collectionSpec, options);
    const limit = Math.max(1, Math.min(200, options.limit ?? 50));

    const parentResults = await Promise.all(
      parentRefs.map(async (parent) => {
        const params = new URLSearchParams();
        params.set("collection", collection);
        params.set("order", options.order ?? "asc");
        params.set("limit", String(limit));

        if (selectedIndex) {
          params.set("index", selectedIndex.name);
          if (selectedIndex.encodedValue !== null) {
            params.set("value", selectedIndex.encodedValue);
          }
        } else if (options.where) {
          params.set("where", JSON.stringify(options.where));
        }

        return this.transport.request<DbQueryResponse>(
          roomEndpointUrl(parent, "db-query", params),
          "GET",
        );
      }),
    );

    const deduped = new Map<string, DbQueryRow>();
    for (const result of parentResults) {
      for (const row of result.rows) {
        const key = `${row.owner}:${row.rowId}`;
        if (!deduped.has(key)) {
          deduped.set(key, row);
        }
      }
    }

    const queryRows = Array.from(deduped.values()).slice(0, limit);
    const hydrated = await Promise.all(
      queryRows.map(async (row) => {
        const rowRef: DbRowRef = {
          id: row.rowId,
          collection,
          owner: row.owner,
          workerUrl: stripTrailingSlash(row.workerUrl),
        };

        try {
          return await this.rows.getRow(collection, rowRef);
        } catch {
          return new RowHandle(this.backend, rowRef, row.fields);
        }
      }),
    );

    return hydrated;
  }

  watchQuery(
    collection: string,
    options: DbQueryOptions,
    callbacks: DbQueryWatchCallbacks<RowHandle>,
  ): DbQueryWatchHandle {
    let lastSnapshot: string | null = null;

    const poller = createAdaptivePoller({
      run: async ({ markActivity }) => {
        const result = await this.query(collection, options);
        const nextSnapshot = snapshotRows(result);

        if (lastSnapshot === nextSnapshot) {
          return;
        }

        lastSnapshot = nextSnapshot;
        callbacks.onChange(result);
        markActivity();
      },
      onError: (error) => {
        callbacks.onError?.(error);
      },
    });

    return {
      disconnect() {
        poller.disconnect();
      },
      refresh() {
        return poller.refresh();
      },
    };
  }
}

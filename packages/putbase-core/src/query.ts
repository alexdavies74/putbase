import { createAdaptivePoller } from "./polling";
import { RowHandle } from "./row-handle";
import type { Rows } from "./rows";
import type {
  AllowedParentCollections,
  CollectionName,
  DbQueryOptions,
  DbQueryWatchCallbacks,
  DbQueryWatchHandle,
  DbRowFields,
  DbRowRef,
  DbSchema,
  RowFields,
} from "./schema";
import { getCollectionSpec, pickIndex } from "./schema";
import { toRowRef } from "./row-reference";
import type { Transport } from "./transport";
import { normalizeTarget } from "./transport";
import type { JsonValue } from "./types";

interface DbQueryRow {
  rowId: string;
  owner: string;
  target: string;
  collection: string;
  fields: Record<string, JsonValue>;
}

interface DbQueryResponse {
  rows: DbQueryRow[];
}

function compareFieldValue(left: JsonValue | undefined, right: JsonValue | undefined): number {
  if (left === right) {
    return 0;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return String(left ?? "").localeCompare(String(right ?? ""));
}

function compareIndexedRows(
  left: DbQueryRow,
  right: DbQueryRow,
  indexFields: readonly string[],
  order: "asc" | "desc",
): number {
  for (const fieldName of indexFields) {
    const comparison = compareFieldValue(left.fields[fieldName], right.fields[fieldName]);
    if (comparison !== 0) {
      return order === "desc" ? -comparison : comparison;
    }
  }

  const ownerComparison = left.owner.localeCompare(right.owner);
  if (ownerComparison !== 0) {
    return order === "desc" ? -ownerComparison : ownerComparison;
  }

  const rowIdComparison = left.rowId.localeCompare(right.rowId);
  return order === "desc" ? -rowIdComparison : rowIdComparison;
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

function snapshotRows(rows: Array<RowHandle<string, DbRowFields>>): string {
  const snapshot = rows.map((row) => ({
    id: row.id,
    collection: row.collection,
    owner: row.owner,
    target: row.target,
    fields: row.fields,
  }));
  return stableJsonStringify(snapshot);
}

function normalizeParents(input: DbRowRef | DbRowRef[] | undefined): DbRowRef[] {
  if (!input) {
    return [];
  }
  return (Array.isArray(input) ? input : [input]).map((row) => toRowRef(row));
}

export class Query<Schema extends DbSchema> {
  constructor(
    private readonly transport: Transport,
    private readonly rows: Rows<Schema>,
    private readonly schema: Schema,
    private readonly resolveOptions?: <TCollection extends CollectionName<Schema>>(
      collection: TCollection,
      options: DbQueryOptions<Schema, TCollection>,
    ) => Promise<DbQueryOptions<Schema, TCollection>>,
  ) {}

  async query<TCollection extends CollectionName<Schema>>(
    collection: TCollection,
    options: DbQueryOptions<Schema, TCollection>,
  ): Promise<Array<RowHandle<TCollection, RowFields<Schema, TCollection>, AllowedParentCollections<Schema, TCollection>, Schema>>> {
    const resolvedOptions = this.resolveOptions
      ? await this.resolveOptions(collection, options)
      : options;
    const parentRefs = normalizeParents(resolvedOptions.in);
    if (parentRefs.length === 0) {
      throw new Error("query requires at least one parent in scope");
    }

    const collectionSpec = getCollectionSpec(this.schema, collection);
    const selectedIndex = pickIndex(collectionSpec, resolvedOptions);
    const limit = Math.max(1, Math.min(200, resolvedOptions.limit ?? 50));

    const parentResults = await Promise.all(
      parentRefs.map(async (parent) => {
        let indexName: string | undefined;
        let value: string | null | undefined;
        if (selectedIndex) {
          indexName = selectedIndex.name;
          value = selectedIndex.encodedValue;
        }

        return this.transport.row(parent).request<DbQueryResponse>("db/query", {
          collection,
          order: resolvedOptions.order ?? "asc",
          limit,
          index: indexName,
          value,
          where: selectedIndex ? undefined : resolvedOptions.where,
        });
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

    const queryRows = Array.from(deduped.values());
    if (selectedIndex) {
      const indexFields = collectionSpec.indexes?.[selectedIndex.name]?.fields ?? [];
      queryRows.sort((left, right) => compareIndexedRows(
        left,
        right,
        indexFields,
        resolvedOptions.order ?? "asc",
      ));
    }

    const limitedRows = queryRows.slice(0, limit);
    const hydrated = await Promise.all(
      limitedRows.map(async (row) => {
        const rowRef: DbRowRef<TCollection> = {
          id: row.rowId,
          collection,
          owner: row.owner,
          target: normalizeTarget(row.target),
        };

        return this.rows.getRow(collection, rowRef);
      }),
    );

    return hydrated;
  }

  watchQuery<TCollection extends CollectionName<Schema>>(
    collection: TCollection,
    options: DbQueryOptions<Schema, TCollection>,
    callbacks: DbQueryWatchCallbacks<RowHandle<TCollection, RowFields<Schema, TCollection>, AllowedParentCollections<Schema, TCollection>, Schema>>,
  ): DbQueryWatchHandle {
    let lastSnapshot: string | null = null;

    const poller = createAdaptivePoller({
      run: async ({ markActivity }) => {
        const result = await this.query(collection, options);
        const nextSnapshot = snapshotRows(result as unknown as Array<RowHandle<string, DbRowFields>>);

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

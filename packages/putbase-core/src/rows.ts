import { RowHandle } from "./row-handle";
import type { RowRuntime } from "./row-runtime";
import type {
  AllowedParentCollections,
  CollectionName,
  DbPutOptions,
  DbRowFields,
  DbRowLocator,
  DbRowRef,
  DbSchema,
  InsertFields,
  RowFields,
} from "./schema";
import { applyDefaults, assertPutParents, assertValidFieldValues, getCollectionSpec } from "./schema";
import type { Transport } from "./transport";
import { normalizeTarget } from "./transport";
import { toRowLocator, toRowRef } from "./row-reference";
import type { JsonValue } from "./types";

interface GetFieldsResponse {
  fields: Record<string, JsonValue>;
  collection: string | null;
}

export class Rows<Schema extends DbSchema> {
  constructor(
    private readonly transport: Transport,
    private readonly rowRuntime: RowRuntime,
    private readonly schema: Schema,
    private readonly createRowHandle: <
      TCollection extends CollectionName<Schema>,
    >(
      collection: TCollection,
      row: DbRowRef<TCollection>,
      fields: RowFields<Schema, TCollection>,
    ) => RowHandle<TCollection, RowFields<Schema, TCollection>, AllowedParentCollections<Schema, TCollection>, Schema>,
    private readonly addParent: (child: DbRowRef, parent: DbRowRef) => Promise<void>,
  ) {}

  async put<TCollection extends CollectionName<Schema>>(
    collection: TCollection,
    fields: InsertFields<Schema, TCollection>,
    options: DbPutOptions<Schema, TCollection> = {},
  ): Promise<RowHandle<TCollection, RowFields<Schema, TCollection>, AllowedParentCollections<Schema, TCollection>, Schema>> {
    const collectionSpec = getCollectionSpec(this.schema, collection);
    const parentRefs = normalizeParents(options.in);
    assertPutParents(collection, collectionSpec, parentRefs);
    assertValidFieldValues(collection, collectionSpec, fields as Record<string, unknown>);

    const row = await this.rowRuntime.createRow(
      options.name ?? `${collection}-${crypto.randomUUID().slice(0, 8)}`,
    );
    const rowRef: DbRowRef<TCollection> = toRowRef({
      id: row.id,
      collection,
      owner: row.owner,
      target: normalizeTarget(row.target),
    });

    const payload = applyDefaults(
      collectionSpec,
      fields as InsertFields<Schema, TCollection> & DbRowFields,
    ) as Record<string, JsonValue>;

    await this.transport.row(rowRef).request("fields/set", {
      fields: payload,
      collection,
    });

    for (const parent of parentRefs) {
      await this.addParent(rowRef, parent);
    }

    return this.createRowHandle(
      collection,
      rowRef,
      payload as RowFields<Schema, TCollection>,
    );
  }

  async update<TCollection extends CollectionName<Schema>>(
    collection: TCollection,
    row: DbRowRef<TCollection>,
    fields: Partial<RowFields<Schema, TCollection>>,
  ): Promise<RowHandle<TCollection, RowFields<Schema, TCollection>, AllowedParentCollections<Schema, TCollection>, Schema>> {
    const rowRef: DbRowRef<TCollection> = toRowRef({
      id: row.id,
      collection,
      owner: row.owner,
      target: row.target,
    });
    const collectionSpec = getCollectionSpec(this.schema, collection);
    assertValidFieldValues(collection, collectionSpec, fields as Record<string, unknown>);
    const response = await this.transport.row(rowRef).request<GetFieldsResponse>("fields/set", {
      fields,
      merge: true,
      collection,
    });
    await this.syncParentIndexes(rowRef, response.fields);

    return this.getRow(collection, rowRef);
  }

  async getRow<TCollection extends CollectionName<Schema>>(
    collection: TCollection,
    row: DbRowRef<TCollection>,
  ): Promise<RowHandle<TCollection, RowFields<Schema, TCollection>, AllowedParentCollections<Schema, TCollection>, Schema>> {
    const rowRef: DbRowRef<TCollection> = toRowRef({
      id: row.id,
      collection,
      owner: row.owner,
      target: row.target,
    });
    const fields = await this.refreshFields(rowRef);
    return this.createRowHandle(collection, rowRef, fields as RowFields<Schema, TCollection>);
  }

  async refreshFields(row: DbRowLocator): Promise<Record<string, JsonValue>> {
    const response = await this.transport.row(toRowLocator(row)).request<GetFieldsResponse>("fields/get", {});
    return response.fields;
  }

  async fetchWithCollection(
    row: DbRowLocator,
  ): Promise<{ fields: Record<string, JsonValue>; collection: string | null }> {
    const response = await this.transport.row(toRowLocator(row)).request<GetFieldsResponse>("fields/get", {});
    return { fields: response.fields, collection: response.collection };
  }

  private async syncParentIndexes(row: DbRowRef, fields: Record<string, JsonValue>): Promise<void> {
    const snapshot = await this.rowRuntime.getRow(row.target);
    const childSpec = this.schema[row.collection];
    await Promise.all(
      snapshot.parentRefs.map((parentRef) =>
        this.transport.row(parentRef).request("parents/register-child", {
          childRowId: row.id,
          childOwner: row.owner,
          childTarget: row.target,
          collection: row.collection,
          fields,
          schema: {
            indexes: childSpec?.indexes,
          },
        }),
      ),
    );
  }
}

function normalizeParents(input: DbRowRef | DbRowRef[] | undefined): DbRowRef[] {
  if (!input) return [];
  return (Array.isArray(input) ? input : [input]).map((row) => toRowRef(row));
}

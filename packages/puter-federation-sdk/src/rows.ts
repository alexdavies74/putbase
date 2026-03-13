import { RowHandle, type RowHandleBackend } from "./row-handle";
import type { Rooms } from "./rooms";
import type { DbPutOptions, DbRowRef, DbSchema } from "./schema";
import { applyDefaults, assertPutParents, getCollectionSpec } from "./schema";
import type { Transport } from "./transport";
import { roomEndpointUrl, stripTrailingSlash } from "./transport";
import type { JsonValue } from "./types";

interface GetFieldsResponse {
  fields: Record<string, JsonValue>;
  collection: string | null;
}

export class Rows {
  constructor(
    private readonly transport: Transport,
    private readonly rooms: Rooms,
    private readonly schema: DbSchema,
    private readonly backend: RowHandleBackend,
    private readonly addParent: (child: DbRowRef, parent: DbRowRef) => Promise<void>,
  ) {}

  async put(
    collection: string,
    fields: Record<string, JsonValue>,
    options: DbPutOptions = {},
  ): Promise<RowHandle> {

    const collectionSpec = getCollectionSpec(this.schema, collection);
    const parentRefs = normalizeParents(options.in);
    assertPutParents(collection, collectionSpec, parentRefs);

    const room = await this.rooms.createRoom(
      options.name ?? `${collection}-${crypto.randomUUID().slice(0, 8)}`,
    );
    const rowRef: DbRowRef = {
      id: room.id,
      collection,
      owner: room.owner,
      workerUrl: stripTrailingSlash(room.workerUrl),
    };

    const payload = applyDefaults(collectionSpec, fields);

    await this.transport.request(roomEndpointUrl(rowRef, "fields"), "POST", {
      fields: payload,
      collection,
    });

    for (const parent of parentRefs) {
      await this.addParent(rowRef, parent);
    }

    return new RowHandle(this.backend, rowRef, payload);
  }

  async update(
    collection: string,
    row: DbRowRef,
    fields: Record<string, JsonValue>,
  ): Promise<RowHandle> {
    const rowRef: DbRowRef = { ...row, collection };
    await this.transport.request(roomEndpointUrl(rowRef, "fields"), "POST", {
      fields,
      merge: true,
      collection,
    });

    return this.getRow(collection, rowRef);
  }

  async getRow(collection: string, row: DbRowRef): Promise<RowHandle> {
    const rowRef: DbRowRef = { ...row, collection };
    const fields = await this.refreshFields(rowRef);
    return new RowHandle(this.backend, rowRef, fields);
  }

  async refreshFields(row: DbRowRef): Promise<Record<string, JsonValue>> {
    const response = await this.transport.request<GetFieldsResponse>(
      roomEndpointUrl(row, "fields"),
      "GET",
    );
    return response.fields;
  }

  async fetchWithCollection(row: Pick<DbRowRef, "id" | "workerUrl"> & { owner: string }): Promise<{ fields: Record<string, JsonValue>; collection: string | null }> {
    const bareRef: DbRowRef = { ...row, collection: "unknown" };
    const response = await this.transport.request<GetFieldsResponse>(
      roomEndpointUrl(bareRef, "fields"),
      "GET",
    );
    return { fields: response.fields, collection: response.collection };
  }
}

function normalizeParents(input: DbRowRef | DbRowRef[] | undefined): DbRowRef[] {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

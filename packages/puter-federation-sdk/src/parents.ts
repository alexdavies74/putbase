import type { Rooms } from "./rooms";
import type { Transport } from "./transport";
import { roomEndpointUrl, stripTrailingSlash } from "./transport";
import type { DbSchema, DbRowRef } from "./schema";
import { assertParentAllowed } from "./schema";
import type { JsonValue } from "./types";

export class Parents {
  constructor(
    private readonly transport: Transport,
    private readonly rooms: Rooms,
    private readonly schema: DbSchema,
    private readonly refreshFields: (row: DbRowRef) => Promise<Record<string, JsonValue>>,
  ) {}

  async add(child: DbRowRef, parent: DbRowRef): Promise<void> {
    assertParentAllowed(this.schema, child.collection, parent.collection);

    const childFields = await this.refreshFields(child);
    const childSpec = this.schema[child.collection];

    await this.transport.request(roomEndpointUrl(parent, "register-child"), "POST", {
      childRowId: child.id,
      childOwner: child.owner,
      childWorkerUrl: child.workerUrl,
      collection: child.collection,
      fields: childFields,
      schema: {
        indexes: childSpec?.indexes,
      },
    });

    await this.transport.request(roomEndpointUrl(child, "link-parent"), "POST", {
      parentWorkerUrl: parent.workerUrl,
    });
  }

  async remove(child: DbRowRef, parent: DbRowRef): Promise<void> {
    await this.transport.request(roomEndpointUrl(parent, "unregister-child"), "POST", {
      childRowId: child.id,
      childOwner: child.owner,
      collection: child.collection,
    });

    await this.transport.request(roomEndpointUrl(child, "unlink-parent"), "POST", {
      parentWorkerUrl: parent.workerUrl,
    });
  }

  async list(child: DbRowRef): Promise<DbRowRef[]> {
    const room = await this.rooms.getRoom(child.workerUrl);

    const parentSnapshots = await Promise.all(
      room.parentRooms.map((workerUrl) => this.rooms.getRoom(workerUrl)),
    );

    return parentSnapshots.map((parentRoom) => ({
      id: parentRoom.id,
      owner: parentRoom.owner,
      workerUrl: stripTrailingSlash(parentRoom.workerUrl),
      collection: "unknown",
    } satisfies DbRowRef));
  }
}

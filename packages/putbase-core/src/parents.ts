import type { RowRuntime } from "./row-runtime";
import type { Transport } from "./transport";
import type { DbSchema, DbRowRef } from "./schema";
import { assertParentAllowed } from "./schema";
import { toRowRef } from "./row-reference";
import type { JsonValue } from "./types";

export class Parents {
  constructor(
    private readonly transport: Transport,
    private readonly rowRuntime: RowRuntime,
    private readonly schema: DbSchema,
    private readonly refreshFields: (row: DbRowRef) => Promise<Record<string, JsonValue>>,
  ) {}

  async addRemote(child: DbRowRef, parent: DbRowRef): Promise<void> {
    const childRef = toRowRef(child);
    const parentRef = toRowRef(parent);
    assertParentAllowed(this.schema, childRef.collection, parentRef.collection);

    const childFields = await this.refreshFields(childRef);
    const childSpec = this.schema[childRef.collection];

    await this.transport.row(parentRef).request("parents/register-child", {
      childRowId: childRef.id,
      childOwner: childRef.owner,
      childTarget: childRef.target,
      collection: childRef.collection,
      fields: childFields,
      schema: {
        indexes: childSpec?.indexes,
      },
    });

    await this.transport.row(childRef).request("parents/link-parent", {
      parentRef,
    });
  }

  async removeRemote(child: DbRowRef, parent: DbRowRef): Promise<void> {
    const childRef = toRowRef(child);
    const parentRef = toRowRef(parent);

    await this.transport.row(parentRef).request("parents/unregister-child", {
      childRowId: childRef.id,
      childOwner: childRef.owner,
      collection: childRef.collection,
    });

    await this.transport.row(childRef).request("parents/unlink-parent", {
      parentRef,
    });
  }

  async list<TParentCollection extends string>(child: DbRowRef): Promise<Array<DbRowRef<TParentCollection>>> {
    const childRef = toRowRef(child);
    const row = await this.rowRuntime.getRow(childRef.target);
    return row.parentRefs as Array<DbRowRef<TParentCollection>>;
  }
}

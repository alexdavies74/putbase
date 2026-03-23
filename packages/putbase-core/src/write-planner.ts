import type { DbRowRef } from "./schema";
import { buildRowTarget } from "./transport";
import type { InviteToken, PutBaseUser, Row } from "./types";
import type { Transport } from "./transport";

export interface PlannedRow {
  readonly row: Row;
  readonly ref: DbRowRef;
}

export class WritePlanner {
  constructor(private readonly transport: Transport) {}

  planRow(args: {
    collection: string;
    federationWorkerUrl: string;
    name: string;
    user: PutBaseUser;
  }): PlannedRow {
    const id = this.transport.createId("row");
    const target = buildRowTarget(args.federationWorkerUrl, id);

    return {
      row: {
        id,
        name: args.name,
        owner: args.user.username,
        target,
        createdAt: Date.now(),
      },
      ref: {
        id,
        owner: args.user.username,
        target,
        collection: args.collection,
      },
    };
  }

  planInviteToken(args: { rowId: string; invitedBy: string }): InviteToken {
    return {
      token: this.transport.createId("invite"),
      rowId: args.rowId,
      invitedBy: args.invitedBy,
      createdAt: Date.now(),
    };
  }
}

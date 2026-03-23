import type { Transport } from "./transport";
import type { DbMemberInfo, DbSchema, MemberRole, RowTarget } from "./schema";
import { normalizeRowRef } from "./row-reference";

interface ListMembersResponse {
  members: Array<{ username: string; role: MemberRole }>;
}

interface EffectiveMembersResponse {
  members: DbMemberInfo[];
}

export class Members<Schema extends DbSchema> {
  constructor(private readonly transport: Transport) {}

  async addRemote(row: RowTarget, username: string, role: MemberRole): Promise<void> {
    await this.transport.row(normalizeRowRef(row)).request("members/add", {
      username,
      role,
    });
  }

  async removeRemote(row: RowTarget, username: string): Promise<void> {
    await this.transport.row(normalizeRowRef(row)).request("members/remove", {
      username,
    });
  }

  async listDirect(row: RowTarget): Promise<Array<{ username: string; role: MemberRole }>> {
    const payload = await this.transport.row(normalizeRowRef(row)).request<ListMembersResponse>("members/direct", {});
    return payload.members;
  }

  async listEffective(row: RowTarget): Promise<Array<DbMemberInfo<Schema>>> {
    const payload = await this.transport.row(normalizeRowRef(row)).request<EffectiveMembersResponse>("members/effective", {});
    return payload.members as Array<DbMemberInfo<Schema>>;
  }
}

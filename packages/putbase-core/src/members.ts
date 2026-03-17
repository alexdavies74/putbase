import type { Transport } from "./transport";
import type { DbMemberInfo, DbRowLocator, DbSchema, MemberRole } from "./schema";

interface ListMembersResponse {
  members: Array<{ username: string; role: MemberRole }>;
}

interface EffectiveMembersResponse {
  members: DbMemberInfo[];
}

export class Members<Schema extends DbSchema> {
  constructor(private readonly transport: Transport) {}

  async add(row: DbRowLocator, username: string, role: MemberRole): Promise<void> {
    await this.transport.row(row).request("members/add", {
      username,
      role,
    });
  }

  async remove(row: DbRowLocator, username: string): Promise<void> {
    await this.transport.row(row).request("members/remove", {
      username,
    });
  }

  async listDirect(row: DbRowLocator): Promise<Array<{ username: string; role: MemberRole }>> {
    const payload = await this.transport.row(row).request<ListMembersResponse>("members/direct", {});
    return payload.members;
  }

  async listEffective(row: DbRowLocator): Promise<Array<DbMemberInfo<Schema>>> {
    const payload = await this.transport.row(row).request<EffectiveMembersResponse>("members/effective", {});
    return payload.members as Array<DbMemberInfo<Schema>>;
  }
}

import { Identity } from "./identity";
import { Invites } from "./invites";
import { Members } from "./members";
import { Parents } from "./parents";
import { Provisioning } from "./provisioning";
import { Query } from "./query";
import { RowHandle, type RowHandleBackend } from "./row-handle";
import { Rooms } from "./rooms";
import { Rows } from "./rows";
import type {
  DbMemberInfo,
  DbPutOptions,
  DbQueryOptions,
  DbQueryWatchCallbacks,
  DbQueryWatchHandle,
  DbRowRef,
  DbSchema,
  MemberRole,
} from "./schema";
import { stripTrailingSlash } from "./transport";
import { Transport } from "./transport";
import type {
  CrdtConnectCallbacks,
  CrdtConnection,
  InviteToken,
  JsonValue,
  ParsedInviteInput,
  PuterFedRoomsOptions,
  RoomUser,
} from "./types";
import { Sync } from "./sync";

export interface PutBaseOptions<Schema extends DbSchema = DbSchema>
  extends PuterFedRoomsOptions {
  schema: Schema;
}

export class PutBase<Schema extends DbSchema = DbSchema> implements RowHandleBackend {
  private readonly transport: Transport;
  private readonly identity: Identity;
  private readonly provisioning: Provisioning;
  private readonly roomsModule: Rooms;
  private readonly invitesModule: Invites;
  private readonly syncModule: Sync;
  private readonly membersModule: Members;
  private readonly parentsModule: Parents;
  private readonly rowsModule: Rows;
  private readonly queryModule: Query;

  constructor(private readonly options: PutBaseOptions<Schema>) {
    this.identity = new Identity(options);
    this.transport = new Transport(options, () => this.identity.whoAmI().then((u) => u.username));
    this.provisioning = new Provisioning(options, this.transport, this.identity);
    this.roomsModule = new Rooms(this.transport, this.identity, this.provisioning);
    this.invitesModule = new Invites(options, this.transport, this.identity);
    this.syncModule = new Sync(this.roomsModule);
    this.membersModule = new Members(this.transport);
    this.rowsModule = new Rows(
      this.transport,
      this.roomsModule,
      options.schema,
      this,
      (child, parent) => this.parentsModule.add(child, parent),
    );
    this.parentsModule = new Parents(
      this.transport,
      this.roomsModule,
      options.schema,
      (row) => this.rowsModule.refreshFields(row),
    );
    this.queryModule = new Query(this.transport, this.rowsModule, options.schema, this);
  }

  async init(): Promise<void> {
    const puter = this.options.puter ?? (globalThis as { puter?: PuterFedRoomsOptions["puter"] }).puter;
    this.identity.setPuter(puter);
    this.transport.setPuter(puter);
    this.provisioning.setPuter(puter);

    await this.identity.whoAmI();
    await this.provisioning.init();
  }

  async whoAmI(): Promise<RoomUser> {
    return this.identity.whoAmI();
  }

  // Row CRUD

  async put(
    collection: keyof Schema & string,
    fields: Record<string, JsonValue>,
    options?: DbPutOptions,
  ): Promise<RowHandle> {
    return this.rowsModule.put(collection, fields, options);
  }

  async update(
    collection: keyof Schema & string,
    row: DbRowRef,
    fields: Record<string, JsonValue>,
  ): Promise<RowHandle> {
    return this.rowsModule.update(collection, row, fields);
  }

  async getRow(collection: keyof Schema & string, row: DbRowRef): Promise<RowHandle> {
    return this.rowsModule.getRow(collection, row);
  }

  async getRowByUrl(workerUrl: string): Promise<RowHandle> {
    const snapshot = await this.roomsModule.getRoom(workerUrl);
    const bareRef = {
      id: snapshot.id,
      owner: snapshot.owner,
      workerUrl: stripTrailingSlash(workerUrl),
    };
    const { fields, collection } = await this.rowsModule.fetchWithCollection(bareRef);
    const rowRef: DbRowRef = {
      ...bareRef,
      collection: collection ?? "unknown",
    };
    return new RowHandle(this, rowRef, fields);
  }

  async query(
    collection: keyof Schema & string,
    options: DbQueryOptions,
  ): Promise<RowHandle[]> {
    return this.queryModule.query(collection, options);
  }

  watchQuery(
    collection: keyof Schema & string,
    options: DbQueryOptions,
    callbacks: DbQueryWatchCallbacks<RowHandle>,
  ): DbQueryWatchHandle {
    return this.queryModule.watchQuery(collection, options, callbacks);
  }

  // Invites

  async getExistingInviteToken(row: DbRowRef): Promise<InviteToken | null> {
    return this.invitesModule.getExistingInviteToken(row);
  }

  async createInviteToken(row: DbRowRef): Promise<InviteToken> {
    return this.invitesModule.createInviteToken(row);
  }

  createInviteLink(row: Pick<DbRowRef, "workerUrl">, inviteToken: string): string {
    return this.invitesModule.createInviteLink(row, inviteToken);
  }

  parseInviteInput(input: string): ParsedInviteInput {
    return this.invitesModule.parseInviteInput(input);
  }

  async joinRow(
    workerUrl: string,
    options: { inviteToken?: string } = {},
  ): Promise<RowHandle> {
    await this.roomsModule.joinRoom(workerUrl, options);
    return this.getRowByUrl(workerUrl);
  }

  // Member listing at room level (raw usernames, not DB roles)

  async listMembers(row: DbRowRef): Promise<string[]> {
    return this.roomsModule.listMembers(row.workerUrl);
  }

  // RowHandleBackend implementation

  async addParent(child: DbRowRef, parent: DbRowRef): Promise<void> {
    return this.parentsModule.add(child, parent);
  }

  async removeParent(child: DbRowRef, parent: DbRowRef): Promise<void> {
    return this.parentsModule.remove(child, parent);
  }

  async listParents(child: DbRowRef): Promise<DbRowRef[]> {
    return this.parentsModule.list(child);
  }

  async addMember(row: DbRowRef, username: string, role: MemberRole): Promise<void> {
    return this.membersModule.add(row, username, role);
  }

  async removeMember(row: DbRowRef, username: string): Promise<void> {
    return this.membersModule.remove(row, username);
  }

  async listDirectMembers(row: DbRowRef): Promise<Array<{ username: string; role: MemberRole }>> {
    return this.membersModule.listDirect(row);
  }

  async listEffectiveMembers(row: DbRowRef): Promise<DbMemberInfo[]> {
    return this.membersModule.listEffective(row);
  }

  async refreshFields(row: DbRowRef): Promise<Record<string, JsonValue>> {
    return this.rowsModule.refreshFields(row);
  }

  connectCrdt(row: DbRowRef, callbacks: CrdtConnectCallbacks): CrdtConnection {
    return this.syncModule.connectCrdt(row, callbacks);
  }
}

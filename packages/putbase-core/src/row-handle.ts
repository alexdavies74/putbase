import type { CrdtConnectCallbacks, CrdtConnection, JsonValue } from "./types";
import type { MutationReceipt } from "./mutation-receipt";
import type {
  AllowedParentCollections,
  CollectionName,
  DbMemberInfo,
  DbRowFields,
  DbSchema,
  MemberRole,
  RowRef,
  RowTarget,
  RowFields,
} from "./schema";

export interface RowHandleBackend<Schema extends DbSchema = DbSchema> {
  addParent(child: RowTarget, parent: RowTarget): MutationReceipt<void>;
  removeParent(child: RowTarget, parent: RowTarget): MutationReceipt<void>;
  listParents<TParentCollection extends string>(child: RowTarget): Promise<Array<RowRef<TParentCollection>>>;
  addMember(row: RowTarget, username: string, role: MemberRole): MutationReceipt<void>;
  removeMember(row: RowTarget, username: string): MutationReceipt<void>;
  listDirectMembers(row: RowTarget): Promise<Array<{ username: string; role: MemberRole }>>;
  listEffectiveMembers(row: RowTarget): Promise<Array<DbMemberInfo<Schema>>>;
  refreshFields(row: RowTarget): Promise<Record<string, JsonValue>>;
  connectCrdt(row: RowTarget, callbacks: CrdtConnectCallbacks): CrdtConnection;
  listMembers(row: RowTarget): Promise<string[]>;
}

export type AnyRowHandle<Schema extends DbSchema> = {
  [TCollection in CollectionName<Schema>]: RowHandle<Schema, TCollection>;
}[CollectionName<Schema>];

export class RowHandle<
  TSchema extends DbSchema = DbSchema,
  TCollection extends CollectionName<TSchema> = CollectionName<TSchema>,
  TFields extends DbRowFields = RowFields<TSchema, TCollection>,
  TAllowedParentCollections extends string = AllowedParentCollections<TSchema, TCollection>,
> {
  readonly id: string;

  readonly collection: TCollection;

  readonly owner: string;

  readonly ref: RowRef<TCollection>;

  fields: TFields;

  readonly in: {
    add: (parent: RowTarget<TAllowedParentCollections>) => MutationReceipt<void>;
    remove: (parent: RowTarget<TAllowedParentCollections>) => MutationReceipt<void>;
    list: () => Promise<Array<RowRef<TAllowedParentCollections>>>;
  };

  readonly members: {
    add: (username: string, options: { role: MemberRole }) => MutationReceipt<void>;
    remove: (username: string) => MutationReceipt<void>;
    list: () => Promise<Array<{ username: string; role: MemberRole }>>;
    effective: () => Promise<Array<DbMemberInfo<TSchema>>>;
    listAll: () => Promise<string[]>;
  };

  constructor(
    private readonly backend: RowHandleBackend<TSchema>,
    row: RowRef<TCollection>,
    owner: string,
    fields: TFields,
  ) {
    this.id = row.id;
    this.collection = row.collection;
    this.owner = owner;
    this.ref = row;
    this.fields = fields;

    this.in = {
      add: (parent: RowTarget<TAllowedParentCollections>) => this.backend.addParent(this.ref, parent),
      remove: (parent: RowTarget<TAllowedParentCollections>) => this.backend.removeParent(this.ref, parent),
      list: async () => this.backend.listParents<TAllowedParentCollections>(this.ref),
    };

    this.members = {
      add: (username: string, options: { role: MemberRole }) => this.backend.addMember(this.ref, username, options.role),
      remove: (username: string) => this.backend.removeMember(this.ref, username),
      list: async () => this.backend.listDirectMembers(this.ref),
      effective: async () => this.backend.listEffectiveMembers(this.ref),
      listAll: async () => this.backend.listMembers(this.ref),
    };
  }

  connectCrdt(callbacks: CrdtConnectCallbacks): CrdtConnection {
    return this.backend.connectCrdt(this.ref, callbacks);
  }

  async refresh(): Promise<TFields> {
    this.fields = await this.backend.refreshFields(this.ref) as TFields;
    return this.fields;
  }
}

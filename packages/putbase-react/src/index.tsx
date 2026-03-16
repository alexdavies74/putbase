import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PutBase } from "puter-federation-sdk";
import type {
  AnyRowHandle,
  CollectionName,
  DbMemberInfo,
  DbQueryOptions,
  DbRowLocator,
  DbRowRef,
  DbSchema,
  MemberRole,
  RowFields,
  RoomUser,
} from "puter-federation-sdk";
import type { RowHandle } from "puter-federation-sdk";

import type { ActivitySubscriber } from "./polling";
import {
  getDefaultRuntime,
  getIdleSnapshot,
  makeInviteLinkKey,
  makeMembersKey,
  makeParentsKey,
  makeQueryKey,
  makeRowByUrlKey,
  makeRowKey,
  type LoadStatus,
  type PutBaseReactRuntime,
  type QueryRows,
  type ResourceController,
  type ResourceSnapshot,
  snapshots,
} from "./runtime";
import { PutBaseReactRuntime as Runtime } from "./runtime";

export type { ActivitySubscriber } from "./polling";
export type { LoadStatus } from "./runtime";

export interface UseResourceResult<TData> extends ResourceSnapshot<TData> {
  refresh(): Promise<void>;
}

export interface UseQueryResult<TRow> extends UseResourceResult<TRow[]> {
  rows: TRow[];
}

export interface UseHookOptions<Schema extends DbSchema> {
  client?: PutBase<Schema>;
  enabled?: boolean;
}

export interface PutBaseProviderProps<Schema extends DbSchema> {
  children: ReactNode;
  client: PutBase<Schema>;
  subscribeToActivity?: ActivitySubscriber;
}

const RuntimeContext = createContext<PutBaseReactRuntime<any> | null>(null);

const noopSubscribe = () => () => undefined;
const noopRefresh = async () => undefined;

function useRuntime<Schema extends DbSchema>(client?: PutBase<Schema>): PutBaseReactRuntime<Schema> {
  const contextRuntime = useContext(RuntimeContext);
  if (client) {
    return getDefaultRuntime(client);
  }

  if (!contextRuntime) {
    throw new Error("PutBaseProvider is missing and no client override was provided.");
  }

  return contextRuntime as PutBaseReactRuntime<Schema>;
}

function useResource<TData>(
  resource: ResourceController<TData> | null,
): UseResourceResult<TData> {
  const snapshot = useSyncExternalStore(
    resource ? resource.subscribe : noopSubscribe,
    resource ? resource.getSnapshot : () => getIdleSnapshot<TData>(),
    () => getIdleSnapshot<TData>(),
  );

  return {
    ...snapshot,
    refresh: resource ? resource.refresh : noopRefresh,
  };
}

function useOptionalResource<TData>(
  enabled: boolean,
  resourceKey: string | null,
  resourceOwner: object,
  resolve: () => ResourceController<TData>,
): UseResourceResult<TData> {
  const resource = useMemo(
    () => (enabled ? resolve() : null),
    [enabled, resourceKey, resourceOwner],
  );
  return useResource(resource);
}

export function PutBaseProvider<Schema extends DbSchema>({
  children,
  client,
  subscribeToActivity,
}: PutBaseProviderProps<Schema>) {
  const runtimeRef = useRef<PutBaseReactRuntime<Schema> | null>(null);
  if (
    runtimeRef.current === null ||
    runtimeRef.current.client !== client ||
    runtimeRef.current.subscribeToActivity !== subscribeToActivity
  ) {
    runtimeRef.current = new Runtime(client, subscribeToActivity);
  }

  return (
    <RuntimeContext.Provider value={runtimeRef.current}>
      {children}
    </RuntimeContext.Provider>
  );
}

export function usePutBase<Schema extends DbSchema>(): PutBase<Schema> {
  return useRuntime<Schema>().client;
}

export function usePutBaseReady<Schema extends DbSchema>(
  options: UseHookOptions<Schema> = {},
): UseResourceResult<void> {
  const runtime = useRuntime(options.client);
  return useOptionalResource(options.enabled ?? true, "ready", runtime, () =>
    runtime.getLoadOnce("ready", () => runtime.client.ensureReady()),
  );
}

export function useCurrentUser<Schema extends DbSchema>(
  options: UseHookOptions<Schema> = {},
): UseResourceResult<RoomUser> {
  const runtime = useRuntime(options.client);
  return useOptionalResource(options.enabled ?? true, "current-user", runtime, () =>
    runtime.getLoadOnce("current-user", () => runtime.client.whoAmI(), snapshots.currentUser),
  );
}

export function useQuery<
  Schema extends DbSchema,
  TCollection extends CollectionName<Schema>,
>(
  collection: TCollection,
  options: DbQueryOptions<Schema, TCollection> | null | undefined,
  hookOptions: UseHookOptions<Schema> = {},
): UseQueryResult<RowHandle<TCollection, RowFields<Schema, TCollection>, any, Schema>> {
  const runtime = useRuntime(hookOptions.client);
  const resourceKey = options ? makeQueryKey(collection, options) : null;
  const resource = useOptionalResource(
    (hookOptions.enabled ?? true) && !!options,
    resourceKey,
    runtime,
    () => runtime.getLive(
      resourceKey as string,
      () => runtime.client.query(collection, options as DbQueryOptions<Schema, TCollection>) as Promise<QueryRows<Schema, TCollection>>,
      snapshots.queryRows,
    ),
  );

  return {
    ...resource,
    rows: resource.data ?? [],
  };
}

export function useRow<
  Schema extends DbSchema,
  TCollection extends CollectionName<Schema>,
>(
  collection: TCollection,
  row: DbRowRef<TCollection> | null | undefined,
  options: UseHookOptions<Schema> = {},
): UseResourceResult<RowHandle<TCollection, RowFields<Schema, TCollection>, any, Schema>> {
  const runtime = useRuntime(options.client);
  const resourceKey = row ? makeRowKey(collection, row) : null;
  return useOptionalResource(
    (options.enabled ?? true) && !!row,
    resourceKey,
    runtime,
    () => runtime.getLive(
      resourceKey as string,
      () => runtime.client.getRow(collection, row as DbRowRef<TCollection>) as Promise<RowHandle<TCollection, RowFields<Schema, TCollection>, any, Schema>>,
      snapshots.row,
    ),
  );
}

export function useRowByUrl<Schema extends DbSchema>(
  workerUrl: string | null | undefined,
  options: UseHookOptions<Schema> = {},
): UseResourceResult<AnyRowHandle<Schema>> {
  const runtime = useRuntime(options.client);
  const resourceKey = workerUrl ? makeRowByUrlKey(workerUrl) : null;
  return useOptionalResource(
    (options.enabled ?? true) && !!workerUrl,
    resourceKey,
    runtime,
    () => runtime.getLive(
      resourceKey as string,
      () => runtime.client.getRowByUrl(workerUrl as string),
      snapshots.row,
    ),
  );
}

export function useParents<Schema extends DbSchema>(
  row: DbRowRef | null | undefined,
  options: UseHookOptions<Schema> = {},
): UseResourceResult<Array<DbRowRef>> {
  const runtime = useRuntime(options.client);
  const resourceKey = row ? makeParentsKey(row) : null;
  return useOptionalResource(
    (options.enabled ?? true) && !!row,
    resourceKey,
    runtime,
    () => runtime.getLive(
      resourceKey as string,
      () => runtime.client.listParents(row as DbRowRef),
      snapshots.rowRefs,
    ),
  );
}

export function useMemberUsernames<Schema extends DbSchema>(
  row: DbRowLocator | null | undefined,
  options: UseHookOptions<Schema> = {},
): UseResourceResult<string[]> {
  const runtime = useRuntime(options.client);
  const resourceKey = row ? makeMembersKey("usernames", row) : null;
  return useOptionalResource(
    (options.enabled ?? true) && !!row,
    resourceKey,
    runtime,
    () => runtime.getLive(
      resourceKey as string,
      () => runtime.client.listMembers(row as DbRowLocator),
      snapshots.memberUsernames,
    ),
  );
}

export function useDirectMembers<Schema extends DbSchema>(
  row: DbRowLocator | null | undefined,
  options: UseHookOptions<Schema> = {},
): UseResourceResult<Array<{ username: string; role: MemberRole }>> {
  const runtime = useRuntime(options.client);
  const resourceKey = row ? makeMembersKey("direct", row) : null;
  return useOptionalResource(
    (options.enabled ?? true) && !!row,
    resourceKey,
    runtime,
    () => runtime.getLive(
      resourceKey as string,
      () => runtime.client.listDirectMembers(row as DbRowLocator),
      snapshots.directMembers,
    ),
  );
}

export function useEffectiveMembers<Schema extends DbSchema>(
  row: DbRowLocator | null | undefined,
  options: UseHookOptions<Schema> = {},
): UseResourceResult<Array<DbMemberInfo<Schema>>> {
  const runtime = useRuntime(options.client);
  const resourceKey = row ? makeMembersKey("effective", row) : null;
  return useOptionalResource(
    (options.enabled ?? true) && !!row,
    resourceKey,
    runtime,
    () => runtime.getLive(
      resourceKey as string,
      () => runtime.client.listEffectiveMembers(row as DbRowLocator),
      snapshots.effectiveMembers,
    ),
  );
}

export function useInviteLink<Schema extends DbSchema>(
  row: DbRowRef | null | undefined,
  options: UseHookOptions<Schema> = {},
): UseResourceResult<string> {
  const runtime = useRuntime(options.client);
  const resourceKey = row ? makeInviteLinkKey(row as DbRowRef) : null;
  return useOptionalResource(
    (options.enabled ?? true) && !!row,
    resourceKey,
    runtime,
    () => runtime.getLoadOnce(
      resourceKey as string,
      async () => {
        const existing = await runtime.client.getExistingInviteToken(row as DbRowRef);
        const invite = existing ?? await runtime.client.createInviteToken(row as DbRowRef);
        return runtime.client.createInviteLink(row as DbRowRef, invite.token);
      },
    ),
  );
}

export interface MutationResult<TResult, TArgs extends unknown[]> {
  data: TResult | undefined;
  error: unknown;
  mutate: (...args: TArgs) => Promise<TResult>;
  reset(): void;
  status: Exclude<LoadStatus, "idle"> | "idle";
}

export function useMutation<TArgs extends unknown[], TResult>(
  mutation: (...args: TArgs) => Promise<TResult>,
): MutationResult<TResult, TArgs> {
  const mutationRef = useRef(mutation);
  mutationRef.current = mutation;

  const [state, setState] = useState<{
    data: TResult | undefined;
    error: unknown;
    status: Exclude<LoadStatus, "idle"> | "idle";
  }>({
    data: undefined,
    error: undefined,
    status: "idle",
  });

  return {
    ...state,
    async mutate(...args: TArgs): Promise<TResult> {
      setState((current) => ({
        data: current.data,
        error: undefined,
        status: "loading",
      }));

      try {
        const result = await mutationRef.current(...args);
        setState({
          data: result,
          error: undefined,
          status: "success",
        });
        return result;
      } catch (error) {
        setState((current) => ({
          data: current.data,
          error,
          status: "error",
        }));
        throw error;
      }
    },
    reset() {
      setState({
        data: undefined,
        error: undefined,
        status: "idle",
      });
    },
  };
}

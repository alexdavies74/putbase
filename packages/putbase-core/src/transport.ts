import type { AuthManager } from "./auth";
import { PutBaseError, toApiError } from "./errors";
import { resolveBackend } from "./backend";
import type { WorkersHandler } from "@heyputer/puter.js";
import type { PutBaseOptions } from "./putbase";
import type { BackendClient } from "./types";
import type { DbRowLocator } from "./schema";

type RoomAction =
  | "db/query"
  | "fields/get"
  | "fields/set"
  | "invite-token/create"
  | "invite-token/get"
  | "members/add"
  | "members/direct"
  | "members/effective"
  | "members/remove"
  | "parents/link-parent"
  | "parents/register-child"
  | "parents/unlink-parent"
  | "parents/unregister-child"
  | "room/get"
  | "room/join"
  | "room/message"
  | "room/messages";

interface RoomRequestOptions {
  includeRequestProof?: boolean;
}

function resolveBoundWorkersExec(
  workers: Partial<Pick<WorkersHandler, "exec">> | null | undefined,
): WorkersHandler["exec"] | null {
  if (!workers || typeof workers.exec !== "function") {
    return null;
  }

  return workers.exec.bind(workers);
}

export function stripTrailingSlash(input: string): string {
  return input.replace(/\/+$/g, "");
}

export function roomIdFromTarget(target: string): string {
  const parsed = new URL(target);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const roomsIndex = segments.indexOf("rooms");

  if (roomsIndex < 0 || roomsIndex + 1 >= segments.length) {
    throw new Error(
      `Unsupported room target: ${target}. Legacy non-federated room targets are no longer supported.`,
    );
  }

  return decodeURIComponent(segments[roomsIndex + 1]);
}

export function normalizeTarget(input: string): string {
  return stripTrailingSlash(input);
}

export function buildRoomTarget(federationWorkerBaseUrl: string, roomId: string): string {
  return `${stripTrailingSlash(federationWorkerBaseUrl)}/rooms/${encodeURIComponent(roomId)}`;
}

function roomEndpointUrl(
  target: string,
  roomId: string,
  endpoint: string,
): string {
  const targetUrl = new URL(normalizeTarget(target));
  const segments = targetUrl.pathname.split("/").filter(Boolean);
  const roomsIndex = segments.indexOf("rooms");

  if (roomsIndex < 0 || roomsIndex + 1 >= segments.length) {
    throw new Error(
      `Unsupported room target: ${target}. Legacy non-federated room targets are no longer supported.`,
    );
  }

  const routeRoomId = decodeURIComponent(segments[roomsIndex + 1]);
  if (routeRoomId !== roomId) {
    throw new Error(`Room target/id mismatch: ${target} does not match row id ${roomId}.`);
  }

  const prefix = segments.slice(0, roomsIndex + 2).join("/");
  targetUrl.pathname = `/${prefix}/${endpoint}`;

  targetUrl.search = "";
  targetUrl.hash = "";
  return targetUrl.toString();
}

export class Transport {
  private backend: BackendClient | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly auth: AuthManager;

  constructor(
    options: Pick<PutBaseOptions, "backend" | "fetchFn">,
    auth: AuthManager,
  ) {
    this.backend = resolveBackend(options.backend);
    this.fetchFn = options.fetchFn ?? fetch;
    this.auth = auth;
  }

  setBackend(backend: BackendClient | undefined): void {
    this.backend = backend;
  }

  async request<T, TPayload = unknown>(args: {
    url: string;
    action: string;
    roomId: string;
    payload: TPayload;
    includeRequestProof?: boolean;
  }): Promise<T> {
    const body = await this.auth.createProtectedRequest({
      action: args.action,
      roomId: args.roomId,
      payload: args.payload,
      includeRequestProof: args.includeRequestProof,
    });
    return this.postJson<T>(args.url, body);
  }

  room(rowOrTarget: string | Pick<DbRowLocator, "id" | "target">): {
    request<T, TPayload = unknown>(action: RoomAction, payload: TPayload, options?: RoomRequestOptions): Promise<T>;
    target: string;
    roomId: string;
  } {
    const target = typeof rowOrTarget === "string" ? normalizeTarget(rowOrTarget) : normalizeTarget(rowOrTarget.target);
    const roomId = typeof rowOrTarget === "string" ? roomIdFromTarget(target) : rowOrTarget.id;
    const parsedRoomId = roomIdFromTarget(target);

    if (parsedRoomId !== roomId) {
      throw new Error(`Room target/id mismatch: ${target} does not match row id ${roomId}.`);
    }

    return {
      request: <T, TPayload = unknown>(
        action: RoomAction,
        payload: TPayload,
        options?: RoomRequestOptions,
      ): Promise<T> => {
        return this.request<T, TPayload>({
          url: roomEndpointUrl(target, roomId, action),
          action,
          roomId,
          payload,
          includeRequestProof: options?.includeRequestProof,
        });
      },
      target,
      roomId,
    };
  }

  async postJson<T>(
    url: string,
    body: unknown,
  ): Promise<T> {
    const workersExec = this.resolveWorkersExec();
    const serialized = body !== undefined ? JSON.stringify(body) : undefined;

    const init: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-puter-no-auth": "1",
      },
      body: serialized,
    };

    const response = workersExec
      ? await workersExec(url, init)
      : await (() => {
        const fetchFn = this.fetchFn;
        return fetchFn(url, init);
      })();

    const payload = await response
      .json()
      .catch((): unknown => ({ code: "BAD_REQUEST", message: response.statusText }));

    if (!response.ok) {
      throw new PutBaseError(toApiError(payload), response.status);
    }

    return payload as T;
  }

  resolveWorkersExec(): WorkersHandler["exec"] | null {
    this.backend = resolveBackend(this.backend);
    return resolveBoundWorkersExec(this.backend?.workers)
      ?? resolveBoundWorkersExec(resolveBackend()?.workers);
  }

  createId(prefix: string): string {
    const random = crypto.randomUUID().replace(/-/g, "");
    return `${prefix}_${random}`;
  }
}

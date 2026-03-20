import type { AuthManager } from "./auth";
import { PutBaseError, toApiError } from "./errors";
import { resolveBackend } from "./backend";
import type { WorkersHandler } from "@heyputer/puter.js";
import type { PutBaseOptions } from "./putbase";
import type { BackendClient } from "./types";
import type { DbRowLocator } from "./schema";

type RowAction =
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
  | "parents/update-index"
  | "sync/poll"
  | "sync/send"
  | "parents/unlink-parent"
  | "parents/unregister-child"
  | "row/get"
  | "row/join"
  ;

interface RowRequestOptions {
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

export function rowIdFromTarget(target: string): string {
  const parsed = new URL(target);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const rowsIndex = segments.indexOf("rows");

  if (rowsIndex < 0 || rowsIndex + 1 >= segments.length) {
    throw new Error(
      `Unsupported row target: ${target}. Legacy non-federated row targets are no longer supported.`,
    );
  }

  return decodeURIComponent(segments[rowsIndex + 1]);
}

export function normalizeTarget(input: string): string {
  return stripTrailingSlash(input);
}

export function buildRowTarget(federationWorkerBaseUrl: string, rowId: string): string {
  return `${stripTrailingSlash(federationWorkerBaseUrl)}/rows/${encodeURIComponent(rowId)}`;
}

function rowEndpointUrl(
  target: string,
  rowId: string,
  endpoint: string,
): string {
  const targetUrl = new URL(normalizeTarget(target));
  const segments = targetUrl.pathname.split("/").filter(Boolean);
  const rowsIndex = segments.indexOf("rows");

  if (rowsIndex < 0 || rowsIndex + 1 >= segments.length) {
    throw new Error(
      `Unsupported row target: ${target}. Legacy non-federated row targets are no longer supported.`,
    );
  }

  const routeRowId = decodeURIComponent(segments[rowsIndex + 1]);
  if (routeRowId !== rowId) {
    throw new Error(`Row target/id mismatch: ${target} does not match row id ${rowId}.`);
  }

  const prefix = segments.slice(0, rowsIndex + 2).join("/");
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
    rowId: string;
    payload: TPayload;
    includeRequestProof?: boolean;
  }): Promise<T> {
    const body = await this.auth.createProtectedRequest({
      action: args.action,
      rowId: args.rowId,
      payload: args.payload,
      includeRequestProof: args.includeRequestProof,
    });
    return this.postJson<T>(args.url, body);
  }

  row(rowOrTarget: string | Pick<DbRowLocator, "id" | "target">): {
    request<T, TPayload = unknown>(action: RowAction, payload: TPayload, options?: RowRequestOptions): Promise<T>;
    target: string;
    rowId: string;
  } {
    const target = typeof rowOrTarget === "string" ? normalizeTarget(rowOrTarget) : normalizeTarget(rowOrTarget.target);
    const rowId = typeof rowOrTarget === "string" ? rowIdFromTarget(target) : rowOrTarget.id;
    const parsedRowId = rowIdFromTarget(target);

    if (parsedRowId !== rowId) {
      throw new Error(`Row target/id mismatch: ${target} does not match row id ${rowId}.`);
    }

    return {
      request: <T, TPayload = unknown>(
        action: RowAction,
        payload: TPayload,
        options?: RowRequestOptions,
      ): Promise<T> => {
        return this.request<T, TPayload>({
          url: rowEndpointUrl(target, rowId, action),
          action,
          rowId,
          payload,
          includeRequestProof: options?.includeRequestProof,
        });
      },
      target,
      rowId,
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

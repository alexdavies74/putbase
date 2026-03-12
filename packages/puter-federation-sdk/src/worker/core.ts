import type {
  ApiError,
  InviteToken,
  Message,
  Room,
  RoomSnapshot,
} from "../types";

interface KvEntry {
  key: string;
  value: unknown;
}

export interface WorkerKv {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  list(prefix: string): Promise<KvEntry[]>;
  incr(key: string, amount?: number): Promise<number>;
}

export interface RoomWorkerConfig {
  owner: string;
  workerUrl: string;
}

interface CreateRoomRequest {
  roomId: string;
  roomName: string;
}

interface JoinRequest {
  username: string;
  inviteToken?: string;
}

interface InvitePayload {
  token: string;
  roomId: string;
  invitedBy: string;
  createdAt: number;
}

interface MessagePayload {
  id: string;
  roomId: string;
  body: unknown;
  createdAt: number;
}

export interface RoomWorkerDeps {
  kv: WorkerKv;
  now?: () => number;
}

class WorkerApiError extends Error {
  readonly status: number;
  readonly apiError: ApiError;

  constructor(status: number, apiError: ApiError) {
    super(apiError.message);
    this.name = "WorkerApiError";
    this.status = status;
    this.apiError = apiError;
  }
}

const CORS_HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-puter-username,puter-auth",
};

const CORS_PREFLIGHT_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-puter-username,puter-auth",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS,
  });
}

function error(status: number, code: ApiError["code"], message: string): never {
  throw new WorkerApiError(status, {
    code,
    message,
  });
}

async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    error(400, "BAD_REQUEST", "Request body must be valid JSON");
  }
}

function requesterFromHeader(request: Request): string {
  const requester = request.headers.get("x-puter-username");
  if (!requester) {
    error(401, "UNAUTHORIZED", "Missing x-puter-username");
  }

  return requester;
}

function messageGlobalKey(roomId: string, message: Pick<Message, "createdAt" | "id">): string {
  return `room:${roomId}:global_message:${message.createdAt}:${message.id}`;
}

function tokenKey(roomId: string, token: string): string {
  return `room:${roomId}:invite_token:${token}`;
}

function roomMetaKey(roomId: string): string {
  return `room:${roomId}:meta`;
}

function roomMembersKey(roomId: string): string {
  return `room:${roomId}:members`;
}

function roomGlobalMessagePrefix(roomId: string): string {
  return `room:${roomId}:global_message:`;
}

function roomMessageSequenceKey(roomId: string): string {
  return `room:${roomId}:global_message_sequence`;
}

function roomParentRoomsKey(roomId: string): string {
  return `room:${roomId}:parent_rooms`;
}

function stripTrailingSlash(input: string): string {
  return input.replace(/\/+$/g, "");
}

function buildRoomWorkerUrl(workerBaseUrl: string, roomId: string): string {
  return `${stripTrailingSlash(workerBaseUrl)}/rooms/${encodeURIComponent(roomId)}`;
}

type WorkersExec = (url: string, init?: RequestInit) => Promise<Response>;

interface WorkerRequestContext {
  workersExec?: WorkersExec;
}

const DEFAULT_PARENT_ROOM_TTL = 5;

function parseRequiredNonNegativeInteger(value: string | null, name: string): number {
  if (value === null) {
    error(400, "BAD_REQUEST", `${name} is required`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    error(400, "BAD_REQUEST", `${name} must be a non-negative number`);
  }

  return Math.floor(parsed);
}

interface RoomRoute {
  roomId: string;
  endpoint: string;
  workerBasePath: string;
}

function parseRoomRoute(pathname: string): RoomRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  const roomsIndex = segments.indexOf("rooms");
  if (roomsIndex < 0 || roomsIndex + 2 >= segments.length || roomsIndex + 3 !== segments.length) {
    return null;
  }

  return {
    roomId: decodeURIComponent(segments[roomsIndex + 1]),
    endpoint: segments[roomsIndex + 2],
    workerBasePath: roomsIndex > 0 ? `/${segments.slice(0, roomsIndex).join("/")}` : "",
  };
}

function isRoomsCollectionPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  const roomsIndex = segments.indexOf("rooms");
  return roomsIndex >= 0 && roomsIndex === segments.length - 1;
}

function inferRoomWorkerUrlFromRequest(
  requestUrl: string,
  fallbackWorkerUrl: string,
  roomId: string,
): string {
  const url = new URL(requestUrl);
  const route = parseRoomRoute(url.pathname);
  if (!route) {
    return buildRoomWorkerUrl(fallbackWorkerUrl, roomId);
  }

  return buildRoomWorkerUrl(`${url.origin}${route.workerBasePath}`, route.roomId);
}

export class RoomWorker {
  private readonly kv: WorkerKv;

  private readonly now: () => number;

  constructor(
    private readonly config: RoomWorkerConfig,
    deps: RoomWorkerDeps,
  ) {
    this.kv = deps.kv;
    this.now = deps.now ?? (() => Date.now());
  }

  async handle(request: Request, ctx: WorkerRequestContext = {}): Promise<Response> {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: CORS_PREFLIGHT_HEADERS,
        });
      }

      const { pathname, searchParams } = new URL(request.url);

      if (request.method === "POST" && isRoomsCollectionPath(pathname)) {
        return await this.createRoom(request);
      }

      const roomRoute = parseRoomRoute(pathname);
      if (!roomRoute) {
        return jsonResponse(404, {
          code: "BAD_REQUEST",
          message: "Endpoint not found",
        });
      }

      if (request.method === "GET" && roomRoute.endpoint === "room") {
        return await this.getRoom(request, roomRoute.roomId, ctx);
      }

      if (request.method === "GET" && roomRoute.endpoint === "messages") {
        const sinceSequence = parseRequiredNonNegativeInteger(
          searchParams.get("sinceSequence"),
          "sinceSequence",
        );
        return await this.getMessages(request, roomRoute.roomId, sinceSequence, ctx);
      }

      if (request.method === "POST" && roomRoute.endpoint === "join") {
        return await this.join(request, roomRoute.roomId);
      }

      if (request.method === "POST" && roomRoute.endpoint === "invite-token") {
        return await this.createInviteToken(request, roomRoute.roomId, ctx);
      }

      if (request.method === "POST" && roomRoute.endpoint === "message") {
        return await this.postMessage(request, roomRoute.roomId, ctx);
      }

      if (request.method === "GET" && roomRoute.endpoint === "is-member") {
        return await this.isMember(request, roomRoute.roomId, ctx);
      }

      return jsonResponse(404, {
        code: "BAD_REQUEST",
        message: "Endpoint not found",
      });
    } catch (err) {
      if (err instanceof WorkerApiError) {
        return jsonResponse(err.status, err.apiError);
      }

      const message = err instanceof Error ? err.message : "Unknown server error";
      return jsonResponse(500, {
        code: "BAD_REQUEST",
        message,
      });
    }
  }

  private async createRoom(request: Request): Promise<Response> {
    const requester = requesterFromHeader(request);
    if (requester !== this.config.owner) {
      error(401, "UNAUTHORIZED", "Only owner can create rooms");
    }

    const body = await parseJson<CreateRoomRequest>(request);
    const roomId = body.roomId?.trim();
    const roomName = body.roomName?.trim();

    if (!roomId || !roomName) {
      error(400, "BAD_REQUEST", "roomId and roomName are required");
    }

    await this.ensureRoomMeta({
      roomId,
      roomName,
      requestUrl: request.url,
    });

    return jsonResponse(200, await this.snapshot(roomId, request.url));
  }

  private async getRoom(
    request: Request,
    roomId: string,
    ctx: WorkerRequestContext,
  ): Promise<Response> {
    const requester = requesterFromHeader(request);
    await this.assertMember(roomId, requester, ctx);

    const snapshot = await this.snapshot(roomId, request.url);
    return jsonResponse(200, snapshot);
  }

  private async getMessages(
    request: Request,
    roomId: string,
    sinceSequence: number,
    ctx: WorkerRequestContext,
  ): Promise<Response> {
    const requester = requesterFromHeader(request);
    await this.assertMember(roomId, requester, ctx);

    const currentSequence = await this.getMessageSequence(roomId);
    if (sinceSequence >= currentSequence) {
      return jsonResponse(200, {
        messages: [],
        latestSequence: currentSequence,
      });
    }

    const messageEntries = await this.kv.list(roomGlobalMessagePrefix(roomId));

    const messages = messageEntries
      .map((entry) => entry.value as Message)
      .filter((message) => message.sequence > sinceSequence)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));

    const latestSequence = messages.reduce(
      (highest, message) => Math.max(highest, message.sequence),
      sinceSequence,
    );

    return jsonResponse(200, {
      messages,
      latestSequence,
    });
  }

  private async join(request: Request, roomId: string): Promise<Response> {
    const requester = requesterFromHeader(request);
    const body = await parseJson<JoinRequest>(request);
    if (!body.username) {
      error(400, "BAD_REQUEST", "username is required");
    }

    if (body.username !== requester) {
      error(401, "UNAUTHORIZED", "Join username does not match authenticated requester");
    }

    await this.ensureRoomMeta({ roomId, requestUrl: request.url });

    const members = await this.getMembers(roomId);
    const isOwner = body.username === this.config.owner;
    const alreadyMember = members.includes(body.username);

    if (alreadyMember) {
      return jsonResponse(200, await this.snapshot(roomId, request.url));
    }

    if (!isOwner) {
      if (!body.inviteToken) {
        error(401, "INVITE_REQUIRED", "Invite token is required for non-owner first join");
      }

      const invite = await this.kv.get<InviteToken>(tokenKey(roomId, body.inviteToken));
      if (!invite || invite.roomId !== roomId) {
        error(401, "INVITE_REQUIRED", "Invite token is invalid");
      }
    }

    members.push(body.username);
    await this.kv.set(roomMembersKey(roomId), members);

    return jsonResponse(200, await this.snapshot(roomId, request.url));
  }

  private async createInviteToken(
    request: Request,
    roomId: string,
    ctx: WorkerRequestContext,
  ): Promise<Response> {
    const requester = requesterFromHeader(request);
    const payload = await parseJson<InvitePayload>(request);

    await this.assertMember(roomId, requester, ctx);

    if (payload.roomId !== roomId) {
      error(400, "BAD_REQUEST", "Payload roomId does not match route roomId");
    }

    const inviteToken: InviteToken = {
      token: payload.token,
      roomId: payload.roomId,
      invitedBy: requester,
      createdAt: payload.createdAt,
    };

    await this.kv.set(tokenKey(roomId, inviteToken.token), inviteToken);

    return jsonResponse(200, {
      inviteToken,
    });
  }

  private async postMessage(
    request: Request,
    roomId: string,
    ctx: WorkerRequestContext,
  ): Promise<Response> {
    const requester = requesterFromHeader(request);
    const payload = await parseJson<MessagePayload>(request);

    await this.assertMember(roomId, requester, ctx);

    if (payload.roomId !== roomId) {
      error(400, "BAD_REQUEST", "Payload roomId does not match route roomId");
    }

    const sequence = await this.nextMessageSequence(roomId);

    const message: Message = {
      ...payload,
      body: payload.body as Message["body"],
      signedBy: requester,
      sequence,
    };

    await this.kv.set(messageGlobalKey(roomId, message), message);

    return jsonResponse(200, {
      message,
    });
  }

  private async isMember(
    request: Request,
    roomId: string,
    ctx: WorkerRequestContext,
  ): Promise<Response> {
    const requester = requesterFromHeader(request);
    const ttlParam = new URL(request.url).searchParams.get("ttl");

    let ttl = DEFAULT_PARENT_ROOM_TTL;
    if (ttlParam !== null) {
      const parsed = Number(ttlParam);
      if (!Number.isFinite(parsed) || parsed < 0) {
        error(400, "BAD_REQUEST", "ttl must be a non-negative number");
      }
      ttl = Math.floor(parsed);
    }

    await this.assertMember(roomId, requester, ctx, ttl);
    return jsonResponse(200, { isMember: true });
  }

  private async getParentRoomUrls(roomId: string): Promise<string[]> {
    return (await this.kv.get<string[]>(roomParentRoomsKey(roomId))) ?? [];
  }

  private async assertMember(
    roomId: string,
    username: string,
    ctx: WorkerRequestContext,
    ttl: number = DEFAULT_PARENT_ROOM_TTL,
  ): Promise<void> {
    const members = await this.getMembers(roomId);
    if (members.includes(username)) return;

    const parentRoomUrls = await this.getParentRoomUrls(roomId);
    if (ttl === 0 || parentRoomUrls.length === 0 || !ctx.workersExec) {
      error(401, "UNAUTHORIZED", "Members only");
    }

    const checks = parentRoomUrls.map(async (parentUrl): Promise<boolean> => {
      try {
        const res = await ctx.workersExec!(
          `${stripTrailingSlash(parentUrl)}/is-member?ttl=${ttl - 1}`,
          { method: "GET" },
        );
        return res.ok;
      } catch {
        return false;
      }
    });

    if (!(await Promise.all(checks)).some(Boolean)) {
      error(401, "UNAUTHORIZED", "Members only");
    }
  }

  private async getMembers(roomId: string): Promise<string[]> {
    const stored = await this.kv.get<string[]>(roomMembersKey(roomId));
    return stored ?? [];
  }

  private async getMessageSequence(roomId: string): Promise<number> {
    const stored = await this.kv.get<number>(roomMessageSequenceKey(roomId));
    if (typeof stored !== "number" || !Number.isFinite(stored) || stored < 0) {
      return 0;
    }

    return Math.floor(stored);
  }

  private async nextMessageSequence(roomId: string): Promise<number> {
    const key = roomMessageSequenceKey(roomId);
    const sequence = await this.kv.incr(key, 1);
    if (!Number.isFinite(sequence) || sequence < 1) {
      error(500, "BAD_REQUEST", "kv.incr returned an invalid sequence");
    }

    return Math.floor(sequence);
  }

  private async ensureRoomMeta(args: {
    roomId: string;
    roomName?: string;
    requestUrl?: string;
  }): Promise<void> {
    const key = roomMetaKey(args.roomId);
    const inferredRoomUrl = args.requestUrl
      ? inferRoomWorkerUrlFromRequest(args.requestUrl, this.config.workerUrl, args.roomId)
      : undefined;
    const existing = await this.kv.get<Room>(key);

    if (existing) {
      if (inferredRoomUrl && existing.workerUrl !== inferredRoomUrl) {
        await this.kv.set(key, {
          ...existing,
          workerUrl: inferredRoomUrl,
        });
      }
      return;
    }

    if (!args.roomName) {
      error(404, "BAD_REQUEST", `Room ${args.roomId} does not exist`);
    }

    const room: Room = {
      id: args.roomId,
      name: args.roomName,
      owner: this.config.owner,
      workerUrl: inferredRoomUrl ?? buildRoomWorkerUrl(this.config.workerUrl, args.roomId),
      createdAt: this.now(),
    };

    await this.kv.set(key, room);
  }

  private async snapshot(roomId: string, requestUrl?: string): Promise<RoomSnapshot> {
    await this.ensureRoomMeta({ roomId, requestUrl });

    const room = await this.kv.get<Room>(roomMetaKey(roomId));
    if (!room) {
      error(400, "BAD_REQUEST", "Room metadata missing");
    }

    const members = await this.getMembers(roomId);
    return {
      ...room,
      members,
      parentRooms: await this.getParentRoomUrls(roomId),
    };
  }
}

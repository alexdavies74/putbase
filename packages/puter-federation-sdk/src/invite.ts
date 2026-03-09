import type { ParsedInviteInput, Room } from "./types";

const DEFAULT_WORKER_BASE_URL = "https://puter.work";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/g, "");
}

function normalizeWorkerUrl(workerUrl: string): string {
  return workerUrl.replace(/\/+$/g, "");
}

function workerName(owner: string, roomId: string): string {
  return `${owner}-room-${roomId}`.toLocaleLowerCase();
}

export function resolveWorkerUrl(
  owner: string,
  roomId: string,
  workerBaseUrl = DEFAULT_WORKER_BASE_URL,
): string {
  const normalized = normalizeBaseUrl(workerBaseUrl);
  const base = new URL(
    normalized.includes("://") ? normalized : `https://${normalized}`,
  );
  const host = `${workerName(owner, roomId)}.${base.host}`;
  return `${base.protocol}//${host}`;
}

export function createInviteLink(
  room: Pick<Room, "owner" | "id">,
  inviteToken: string,
  appBaseUrl: string,
): string {
  const url = new URL("/", appBaseUrl);
  url.searchParams.set("owner", room.owner);
  url.searchParams.set("room", room.id);
  url.searchParams.set("token", inviteToken);
  return url.toString();
}

export function parseInviteInput(
  input: string,
  workerResolver: (owner: string, roomId: string) => string = (owner, roomId) =>
    resolveWorkerUrl(owner, roomId),
): ParsedInviteInput {
  const trimmed = input.trim();
  const url = new URL(trimmed);

  const owner = url.searchParams.get("owner");
  const roomId = url.searchParams.get("room");
  const inviteToken = url.searchParams.get("token") ?? undefined;
  const workerUrl = url.searchParams.get("worker");

  if (workerUrl) {
    return {
      workerUrl: normalizeWorkerUrl(workerUrl),
      inviteToken,
      owner: owner ?? undefined,
      roomId: roomId ?? undefined,
    };
  }

  if (owner && roomId) {
    return {
      owner,
      roomId,
      inviteToken,
      workerUrl: normalizeWorkerUrl(workerResolver(owner, roomId)),
    };
  }

  if (inviteToken) {
    const workerUrl = new URL(url.toString());
    workerUrl.searchParams.delete("token");
    return {
      workerUrl: normalizeWorkerUrl(workerUrl.toString()),
      inviteToken,
    };
  }

  return {
    workerUrl: normalizeWorkerUrl(url.toString()),
  };
}

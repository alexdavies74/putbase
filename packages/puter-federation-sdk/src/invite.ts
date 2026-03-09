import type { ParsedInviteInput, Room } from "./types";

const DEFAULT_WORKER_BASE_URL = "https://workers.puter.site";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/g, "");
}

export function resolveWorkerUrl(
  owner: string,
  roomId: string,
  workerBaseUrl = DEFAULT_WORKER_BASE_URL,
): string {
  const normalized = normalizeBaseUrl(workerBaseUrl);
  return `${normalized}/${encodeURIComponent(owner)}/rooms/${encodeURIComponent(roomId)}`;
}

export function createInviteLink(
  room: Pick<Room, "owner" | "id">,
  inviteToken: string,
  appBaseUrl: string,
): string {
  const url = new URL("/join", appBaseUrl);
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

  if (owner && roomId) {
    return {
      owner,
      roomId,
      inviteToken,
      workerUrl: workerResolver(owner, roomId),
    };
  }

  if (inviteToken) {
    const workerUrl = new URL(url.toString());
    workerUrl.searchParams.delete("token");
    return {
      workerUrl: workerUrl.toString(),
      inviteToken,
    };
  }

  return {
    workerUrl: url.toString(),
  };
}

import type { ParsedInviteInput, Room } from "./types";

function normalizeWorkerUrl(workerUrl: string): string {
  return workerUrl.replace(/\/+$/g, "");
}

export function createInviteLink(
  room: Pick<Room, "workerUrl">,
  inviteToken: string,
  appBaseUrl: string,
): string {
  const url = new URL("/", appBaseUrl);
  url.searchParams.set("worker", normalizeWorkerUrl(room.workerUrl));
  url.searchParams.set("token", inviteToken);
  return url.toString();
}

function assertRoomWorkerUrl(workerUrl: string): void {
  const parsed = new URL(workerUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const roomsIndex = segments.indexOf("rooms");
  if (roomsIndex < 0 || roomsIndex + 1 >= segments.length) {
    throw new Error("Invite input must include a room worker URL.");
  }
}

export function parseInviteInput(input: string): ParsedInviteInput {
  const trimmed = input.trim();
  const url = new URL(trimmed);

  const inviteToken = url.searchParams.get("token") ?? undefined;
  const workerUrl = url.searchParams.get("worker");

  if (workerUrl) {
    assertRoomWorkerUrl(workerUrl);
    return {
      workerUrl: normalizeWorkerUrl(workerUrl),
      inviteToken,
    };
  }

  if (url.searchParams.has("owner") || url.searchParams.has("room")) {
    throw new Error(
      "Invite links with owner/room parameters are no longer supported. Use worker-based invite links.",
    );
  }

  const directWorkerUrl = new URL(url.toString());
  directWorkerUrl.searchParams.delete("token");
  assertRoomWorkerUrl(directWorkerUrl.toString());

  return {
    workerUrl: normalizeWorkerUrl(directWorkerUrl.toString()),
    inviteToken,
  };
}

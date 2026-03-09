import type { KV } from "@heyputer/puter.js";
import type { Room } from "puter-federation-sdk";

export interface DogProfile {
  room: Room;
}

const PROFILE_KEY = "woof:myDog";

type KvLike = Pick<KV, "get" | "set" | "del">;

export async function loadStoredWorkerUrl(kv: KvLike): Promise<string | null> {
  const value = await kv.get<unknown>(PROFILE_KEY);
  if (typeof value !== "string") {
    return null;
  }

  const workerUrl = value.trim();
  return workerUrl || null;
}

export async function saveStoredWorkerUrl(room: Pick<Room, "workerUrl">, kv: KvLike): Promise<void> {
  await kv.set(PROFILE_KEY, room.workerUrl);
}

export async function clearProfile(kv: KvLike): Promise<void> {
  await kv.del(PROFILE_KEY);
}

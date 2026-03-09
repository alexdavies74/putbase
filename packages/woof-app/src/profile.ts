import type { Room } from "puter-federation-sdk";

export interface DogProfile {
  dogName: string;
  room: Room;
}

const PROFILE_KEY = "woof:myDog";

export function loadProfile(storage: Storage = localStorage): DogProfile | null {
  const raw = storage.getItem(PROFILE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as DogProfile;
  } catch {
    return null;
  }
}

export function saveProfile(profile: DogProfile, storage: Storage = localStorage): void {
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearProfile(storage: Storage = localStorage): void {
  storage.removeItem(PROFILE_KEY);
}

import { describe, expect, it } from "vitest";

import { clearProfile, loadProfile, saveProfile, type DogProfile } from "../src/profile";

class MockStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("profile persistence", () => {
  it("saves, loads, and clears dog profile", () => {
    const storage = new MockStorage();

    const profile: DogProfile = {
      dogName: "Rex",
      room: {
        id: "room_1",
        name: "Rex",
        owner: "alex",
        workerUrl: "https://workers.puter.site/alex/rooms/room_1",
        createdAt: 1,
      },
    };

    saveProfile(profile, storage);
    expect(loadProfile(storage)).toEqual(profile);

    clearProfile(storage);
    expect(loadProfile(storage)).toBeNull();
  });
});

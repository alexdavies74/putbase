import { describe, expect, it } from "vitest";

import { clearProfile, loadStoredWorkerUrl, saveStoredWorkerUrl } from "../src/profile";

class MockKv {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<boolean> {
    this.map.set(key, value);
    return true;
  }

  async del(key: string): Promise<boolean> {
    this.map.delete(key);
    return true;
  }
}

describe("profile persistence", () => {
  it("saves, loads, and clears worker URL in puter kv", async () => {
    const kv = new MockKv();

    await saveStoredWorkerUrl(
      {
        workerUrl: "https://workers.puter.site/alex/rooms/room_1",
      },
      kv,
    );
    await expect(loadStoredWorkerUrl(kv)).resolves.toBe("https://workers.puter.site/alex/rooms/room_1");

    await clearProfile(kv);
    await expect(loadStoredWorkerUrl(kv)).resolves.toBeNull();
  });
});

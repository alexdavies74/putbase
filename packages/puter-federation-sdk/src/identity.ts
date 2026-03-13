import { resolveBackend } from "./backend";
import type { PutBaseOptions } from "./putbase";
import type { BackendClient, RoomUser } from "./types";

export class Identity {
  private cached: RoomUser | null = null;
  private backend: BackendClient | undefined;

  constructor(private readonly options: Pick<PutBaseOptions, "backend" | "identityProvider">) {
    this.backend = resolveBackend(options.backend);
  }

  setBackend(backend: BackendClient | undefined): void {
    this.backend = backend;
  }

  async whoAmI(): Promise<RoomUser> {
    if (this.cached) {
      return this.cached;
    }

    if (this.options.identityProvider) {
      this.cached = await this.options.identityProvider();
      return this.cached;
    }

    this.backend = resolveBackend(this.backend);

    const auth = this.backend?.auth;
    let candidate: { username?: string } | null = null;

    if (auth?.getUser) {
      candidate = await auth.getUser().catch(() => null);
    }

    if (!candidate?.username && auth?.whoami) {
      candidate = await auth.whoami().catch(() => candidate);
    }

    if (!candidate?.username && auth?.isSignedIn && auth?.signIn && !auth.isSignedIn()) {
      await auth.signIn().catch(() => null);
      candidate = await (auth.whoami?.() ?? auth.getUser?.() ?? Promise.resolve(null)).catch(
        () => candidate,
      );
    }

    if (!candidate && this.backend?.getUser) {
      candidate = await this.backend.getUser().catch(() => null);
    }

    const username = candidate?.username;
    if (!username) {
      throw new Error(
        "Unable to determine the current username. Provide a compatible backend via { backend }, ensure globalThis.puter is available, or supply identityProvider.",
      );
    }

    this.cached = { username };
    return this.cached;
  }
}

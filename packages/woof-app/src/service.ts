import type {
  PuterFedRooms,
  Room,
} from "puter-federation-sdk";
import type { AI, ChatResponse, KV } from "@heyputer/puter.js";

import {
  clearProfile,
  loadStoredWorkerUrl,
  saveStoredWorkerUrl,
  type DogProfile,
} from "./profile";

type PollHandle = number;

interface TimerLike {
  setInterval(handler: () => void, ms: number): PollHandle;
  clearInterval(handle: PollHandle): void;
}

type RoomsLike = Pick<
  PuterFedRooms,
  | "createRoom"
  | "getRoom"
  | "joinRoom"
  | "parseInviteInput"
  | "getPublicKeyUrl"
  | "sendMessage"
  | "createInviteToken"
  | "createInviteLink"
>;

type KvLike = Pick<KV, "get" | "set" | "del">;

type PuterAI = Pick<AI, "chat">;

export class WoofService {
  private pollHandle: PollHandle | null = null;

  constructor(
    private readonly rooms: RoomsLike,
    private readonly kv: KvLike,
    private readonly timer: TimerLike = {
      setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
      clearInterval: (handle) => globalThis.clearInterval(handle),
    },
  ) {}

  async restoreProfile(): Promise<DogProfile | null> {
    const workerUrl = await loadStoredWorkerUrl(this.kv);
    if (!workerUrl) {
      return null;
    }

    try {
      const room = await this.rooms.getRoom(workerUrl);
      return { room };
    } catch (error) {
      await clearProfile(this.kv);
      throw error;
    }
  }

  async enterChat(args: { dogName: string }): Promise<DogProfile> {
    const room = await this.rooms.createRoom(args.dogName);
    await saveStoredWorkerUrl(room, this.kv);
    return { room };
  }

  async joinFromInvite(inviteInput: string): Promise<DogProfile> {
    const parsed = this.rooms.parseInviteInput(inviteInput.trim());
    const room = await this.rooms.joinRoom(parsed.workerUrl, {
      inviteToken: parsed.inviteToken,
      publicKeyUrl: this.rooms.getPublicKeyUrl(),
    });

    await saveStoredWorkerUrl(room, this.kv);
    return { room };
  }

  async refreshProfileCanonical(profile: DogProfile): Promise<DogProfile> {
    try {
      const snapshot = await this.rooms.getRoom(profile.room.workerUrl);
      await saveStoredWorkerUrl(snapshot, this.kv);
      return { room: snapshot };
    } catch (error) {
      await clearProfile(this.kv);
      throw error;
    }
  }

  async generateInviteLink(room: Room): Promise<string> {
    const invite = await this.rooms.createInviteToken(room);
    return this.rooms.createInviteLink(room, invite.token);
  }

  async sendTurn(profile: DogProfile, content: string, puterAI?: PuterAI): Promise<void> {
    await this.rooms.sendMessage(profile.room, {
      userType: "user",
      content,
    });

    const dogReply = await this.getDogReply(content, profile.room.name, puterAI);

    await this.rooms.sendMessage(profile.room, {
      userType: "dog",
      content: dogReply,
    });
  }

  startPolling(callback: () => Promise<void>, intervalMs = 5000): void {
    this.stopPolling();
    this.pollHandle = this.timer.setInterval(() => {
      callback().catch(() => {
        // Keep polling alive across transient failures.
      });
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollHandle !== null) {
      this.timer.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  async relinquish(): Promise<void> {
    this.stopPolling();
    await clearProfile(this.kv);
  }

  private async getDogReply(
    userMessage: string,
    dogName: string,
    puterAI?: PuterAI,
  ): Promise<string> {
    if (!puterAI?.chat) {
      return `${dogName} tilts its head and wags.`;
    }

    try {
      const response = await puterAI.chat([
        {
          role: "system",
          content: `You are ${dogName}, a friendly dog replying in short playful lines.`,
        },
        {
          role: "user",
          content: userMessage,
        },
      ]);

      const extracted = extractAIText(response);
      if (extracted) {
        return extracted;
      }

      console.warn("[woof-app] AI response had no usable text", { response });
      return `${dogName} barks happily.`;
    } catch (error) {
      console.error("[woof-app] AI reply generation failed", {
        error,
        dogName,
      });
      return `${dogName} barks happily.`;
    }
  }

}

function extractAIText(response: ChatResponse): string | null {
  const content = response.message?.content;
  if (content == null) {
    return null;
  }

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (content && typeof content === "object") {
    const maybeText = (content as Record<string, unknown>).text;
    if (typeof maybeText === "string" && maybeText.trim()) {
      return maybeText.trim();
    }
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object") {
          const maybeText = (part as Record<string, unknown>).text;
          return typeof maybeText === "string" ? maybeText : "";
        }

        return "";
      })
      .filter((part) => part.length > 0)
      .join(" ")
      .trim();

    return joined || null;
  }

  return null;
}

import type { Identity } from "./identity";
import type { PutBaseOptions } from "./putbase";
import type { Transport } from "./transport";
import { normalizeTarget } from "./transport";
import type { InviteTarget, InviteToken } from "./types";
import type { DbRowLocator } from "./schema";

interface GetInviteResponse {
  inviteToken: InviteToken | null;
}

interface PostInviteResponse {
  inviteToken: InviteToken;
}

function normalizeInviteTarget(target: string): string {
  return normalizeTarget(target);
}

function assertRoomTarget(target: string): void {
  const parsed = new URL(target);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const roomsIndex = segments.indexOf("rooms");
  if (roomsIndex < 0 || roomsIndex + 1 >= segments.length) {
    throw new Error("Invite input must include a room target.");
  }
}

export class Invites {
  constructor(
    private readonly options: Pick<PutBaseOptions, "appBaseUrl">,
    private readonly transport: Transport,
    private readonly identity: Identity,
  ) {}

  async getExistingInviteToken(row: DbRowLocator): Promise<InviteToken | null> {
    const response = await this.transport.room(row).request<GetInviteResponse>("invite-token/get", {});
    return response.inviteToken;
  }

  async createInviteToken(row: DbRowLocator): Promise<InviteToken> {
    const user = await this.identity.whoAmI();

    const payload: InviteToken = {
      token: this.transport.createId("invite"),
      roomId: row.id,
      invitedBy: user.username,
      createdAt: Date.now(),
    };

    const response = await this.transport.room(row).request<PostInviteResponse>("invite-token/create", payload);

    return response.inviteToken;
  }

  createInviteLink(row: Pick<DbRowLocator, "target">, inviteToken: string): string {
    const appBaseUrl =
      this.options.appBaseUrl ??
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:5173");

    const url = new URL("/", appBaseUrl);
    url.searchParams.set("target", normalizeInviteTarget(row.target));
    url.searchParams.set("token", inviteToken);
    return url.toString();
  }

  parseInvite(input: string): InviteTarget {
    const trimmed = input.trim();
    const url = new URL(trimmed);

    const inviteToken = url.searchParams.get("token") ?? undefined;
    const target = url.searchParams.get("target") ?? url.searchParams.get("worker");

    if (target) {
      assertRoomTarget(target);
      return {
        target: normalizeInviteTarget(target),
        inviteToken,
      };
    }

    if (url.searchParams.has("owner") || url.searchParams.has("room")) {
      throw new Error(
        "Invite links with owner/room parameters are no longer supported. Use target-based invite links.",
      );
    }

    const directTarget = new URL(url.toString());
    directTarget.searchParams.delete("token");
    assertRoomTarget(directTarget.toString());

    return {
      target: normalizeInviteTarget(directTarget.toString()),
      inviteToken,
    };
  }
}

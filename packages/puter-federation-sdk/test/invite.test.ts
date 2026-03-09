import { describe, expect, it } from "vitest";

import {
  createInviteLink,
  parseInviteInput,
  resolveWorkerUrl,
} from "../src/invite";

describe("invite parsing", () => {
  it("creates and parses app invite links", () => {
    const link = createInviteLink(
      {
        owner: "alex",
        id: "room_abc",
      },
      "invite_xyz",
      "https://woof.example",
    );

    expect(link).toBe(
      "https://woof.example/join?owner=alex&room=room_abc&token=invite_xyz",
    );

    const parsed = parseInviteInput(link);

    expect(parsed.owner).toBe("alex");
    expect(parsed.roomId).toBe("room_abc");
    expect(parsed.inviteToken).toBe("invite_xyz");
    expect(parsed.workerUrl).toBe(resolveWorkerUrl("alex", "room_abc"));
  });

  it("supports worker URL input with token", () => {
    const parsed = parseInviteInput(
      "https://workers.puter.site/alex/rooms/room_abc?token=invite_xyz",
    );

    expect(parsed.workerUrl).toBe("https://workers.puter.site/alex/rooms/room_abc");
    expect(parsed.inviteToken).toBe("invite_xyz");
  });

  it("supports plain worker URL input", () => {
    const parsed = parseInviteInput("https://workers.puter.site/alex/rooms/room_abc");

    expect(parsed.workerUrl).toBe("https://workers.puter.site/alex/rooms/room_abc");
    expect(parsed.inviteToken).toBeUndefined();
  });
});

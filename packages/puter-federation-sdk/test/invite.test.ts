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

  it("parses worker-param invites for backwards compatibility", () => {
    const parsed = parseInviteInput(
      "https://woof.example/join?worker=https%3A%2F%2Falex-room-room_abc.puter.work&token=invite_xyz",
    );

    expect(parsed.workerUrl).toBe("https://alex-room-room_abc.puter.work");
    expect(parsed.inviteToken).toBe("invite_xyz");
    expect(parsed.owner).toBeUndefined();
    expect(parsed.roomId).toBeUndefined();
  });

  it("supports worker URL input with token", () => {
    const parsed = parseInviteInput(
      "https://alex-room-room_abc.puter.work?token=invite_xyz",
    );

    expect(parsed.workerUrl).toBe("https://alex-room-room_abc.puter.work");
    expect(parsed.inviteToken).toBe("invite_xyz");
  });

  it("supports plain worker URL input", () => {
    const parsed = parseInviteInput("https://alex-room-room_abc.puter.work");

    expect(parsed.workerUrl).toBe("https://alex-room-room_abc.puter.work");
    expect(parsed.inviteToken).toBeUndefined();
  });
});

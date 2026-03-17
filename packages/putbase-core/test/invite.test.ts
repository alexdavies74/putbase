import { describe, expect, it } from "vitest";

import { PutBase } from "../src/putbase";
import { defineSchema } from "../src/schema";

function buildDb(appBaseUrl = "https://woof.example") {
  return new PutBase({
    schema: defineSchema({}),
    identityProvider: async () => ({ username: "test" }),
    appBaseUrl,
  });
}

describe("invite parsing", () => {
  it("creates and parses target-based app invite links", () => {
    const db = buildDb("https://woof.example");
    const link = db.createInviteLink(
      { target: "https://workers.example/alex-1234abcd-federation/rows/row_abc" },
      "invite_xyz",
    );

    expect(link).toBe(
      "https://woof.example/?target=https%3A%2F%2Fworkers.example%2Falex-1234abcd-federation%2Frows%2Frow_abc&token=invite_xyz",
    );

    const parsed = db.parseInvite(link);
    expect(parsed).toEqual({
      target: "https://workers.example/alex-1234abcd-federation/rows/row_abc",
      inviteToken: "invite_xyz",
    });
  });

  it("supports row target input with token", () => {
    const db = buildDb();
    const parsed = db.parseInvite(
      "https://workers.example/alex-1234abcd-federation/rows/row_abc?token=invite_xyz",
    );

    expect(parsed.target).toBe("https://workers.example/alex-1234abcd-federation/rows/row_abc");
    expect(parsed.inviteToken).toBe("invite_xyz");
  });

  it("supports plain row target input", () => {
    const db = buildDb();
    const parsed = db.parseInvite("https://workers.example/alex-1234abcd-federation/rows/row_abc");

    expect(parsed.target).toBe("https://workers.example/alex-1234abcd-federation/rows/row_abc");
    expect(parsed.inviteToken).toBeUndefined();
  });

  it("parses legacy worker query params for old invite links", () => {
    const db = buildDb();
    const parsed = db.parseInvite(
      "https://woof.example/?worker=https%3A%2F%2Fworkers.example%2Falex-1234abcd-federation%2Frows%2Frow_abc&token=invite_xyz",
    );

    expect(parsed).toEqual({
      target: "https://workers.example/alex-1234abcd-federation/rows/row_abc",
      inviteToken: "invite_xyz",
    });
  });

  it("rejects owner+row legacy invites", () => {
    const db = buildDb();
    expect(() =>
      db.parseInvite("https://woof.example/?owner=alex&row=row_abc&token=invite_xyz"),
    ).toThrow("owner/row parameters are no longer supported");
  });
});

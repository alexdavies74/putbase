import { describe, expect, it } from "vitest";

import {
  exportPublicJwk,
  generateP256KeyPair,
  signEnvelope,
  verifyEnvelope,
} from "../src/crypto";

describe("crypto envelope signing", () => {
  it("round-trips canonical ECDSA signatures", async () => {
    const keyPair = await generateP256KeyPair();
    const publicKeyJwk = await exportPublicJwk(keyPair.publicKey);

    const envelope = await signEnvelope(
      "message",
      {
        id: "msg_a",
        roomId: "room_1",
        body: { userType: "user", content: "hello" },
        createdAt: 1,
        signedBy: "alex",
      },
      {
        username: "alex",
        publicKeyUrl: "https://keys.example/alex.json",
      },
      keyPair.privateKey,
      100,
    );

    expect(await verifyEnvelope(envelope, publicKeyJwk)).toBe(true);

    envelope.payload.body = { userType: "user", content: "tampered" };
    expect(await verifyEnvelope(envelope, publicKeyJwk)).toBe(false);
  });
});

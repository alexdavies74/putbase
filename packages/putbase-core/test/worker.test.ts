import { describe, expect, it } from "vitest";

import { createPrincipalProof, createRequestProof } from "../src/auth";
import { exportPublicJwk, generateP256KeyPair } from "../src/crypto";
import { RoomWorker } from "../src/worker/core";
import { InMemoryKv } from "../src/worker/in-memory-kv";

async function jsonBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function roomEndpoint(roomId: string, endpoint: string): string {
  return `https://worker.example/rooms/${encodeURIComponent(roomId)}/${endpoint}`;
}

const signerState = new Map<string, Promise<{ keyPair: CryptoKeyPair; publicKeyJwk: JsonWebKey }>>();

async function getSigner(username: string): Promise<{ keyPair: CryptoKeyPair; publicKeyJwk: JsonWebKey }> {
  const existing = signerState.get(username);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const keyPair = await generateP256KeyPair();
    const publicKeyJwk = await exportPublicJwk(keyPair.publicKey);
    return { keyPair, publicKeyJwk };
  })();
  signerState.set(username, promise);
  return promise;
}

async function authedRequest(args: {
  url: string;
  username: string;
  action: string;
  roomId: string;
  body?: object;
}): Promise<Request> {
  const signer = await getSigner(args.username);
  const principal = await createPrincipalProof({
    username: args.username,
    publicKeyJwk: signer.publicKeyJwk,
    privateKey: signer.keyPair.privateKey,
  });
  const requestProof = await createRequestProof({
    action: args.action,
    roomId: args.roomId,
    payload: args.body ?? {},
    principal,
    privateKey: signer.keyPair.privateKey,
  });

  return new Request(args.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      auth: {
        principal,
        request: requestProof,
      },
      payload: args.body ?? {},
    }),
  });
}

async function createRoom(worker: RoomWorker, roomId: string, roomName = "Rex"): Promise<Response> {
  return worker.handle(
    await authedRequest({
      url: "https://worker.example/rooms",
      username: "owner",
      action: "rooms/create",
      roomId,
      body: {
        roomId,
        roomName,
      },
    }),
  );
}

class CountingKv extends InMemoryKv {
  public listCalls = 0;

  override async list(prefix: string) {
    this.listCalls += 1;
    return super.list(prefix);
  }
}

class WorkerNetwork {
  private readonly workers = new Map<string, RoomWorker>();

  register(baseUrl: string, worker: RoomWorker): void {
    this.workers.set(baseUrl.replace(/\/+$/g, ""), worker);
  }

  async dispatch(
    mode: "full" | "local-only",
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init);
    const baseUrl = this.resolveBaseUrl(request.url);
    if (!baseUrl) {
      return new Response(JSON.stringify({ code: "BAD_REQUEST", message: `No worker for ${request.url}` }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    const worker = this.workers.get(baseUrl);
    if (!worker) {
      return new Response(JSON.stringify({ code: "BAD_REQUEST", message: `Worker missing for ${request.url}` }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    return worker.handle(request, {
      workersExec: (nextUrl, nextInit) => {
        if (mode === "local-only" && this.resolveBaseUrl(nextUrl) !== baseUrl) {
          return Promise.resolve(new Response(JSON.stringify({
            code: "EXEC_SCOPE",
            message: "cross-worker exec blocked",
          }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }));
        }

        return this.dispatch(mode, nextUrl, nextInit);
      },
    });
  }

  private resolveBaseUrl(requestUrl: string): string | null {
    let best: string | null = null;
    for (const candidate of this.workers.keys()) {
      if (!requestUrl.startsWith(candidate)) continue;
      if (!best || candidate.length > best.length) best = candidate;
    }
    return best;
  }
}

describe("RoomWorker", () => {
  it("enforces invite and members-only reads", async () => {
    const worker = new RoomWorker(
      {
        owner: "owner",
        workerUrl: "https://worker.example",
      },
      { kv: new InMemoryKv() },
    );

    const created = await createRoom(worker, "room_1");
    expect(created.status).toBe(200);

    const ownerJoin = await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_1", "room/join"),
        action: "room/join",
        roomId: "room_1",
        username: "owner",
        body: { username: "owner" },
      }),
    );
    expect(ownerJoin.status).toBe(200);
    expect((await jsonBody(ownerJoin)).target).toBe("https://worker.example/rooms/room_1");

    const guestJoinWithoutInvite = await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_1", "room/join"),
        action: "room/join",
        roomId: "room_1",
        username: "guest",
        body: { username: "guest" },
      }),
    );

    expect(guestJoinWithoutInvite.status).toBe(401);
    expect((await jsonBody(guestJoinWithoutInvite)).code).toBe("INVITE_REQUIRED");

    const inviteResponse = await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_1", "invite-token/create"),
        action: "invite-token/create",
        roomId: "room_1",
        username: "owner",
        body: {
          token: "invite_1",
          roomId: "room_1",
          invitedBy: "tampered",
          createdAt: 10,
        },
      }),
    );

    expect(inviteResponse.status).toBe(200);
    expect((await jsonBody(inviteResponse)).inviteToken).toMatchObject({
      token: "invite_1",
      roomId: "room_1",
      invitedBy: "owner",
    });

    const guestJoin = await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_1", "room/join"),
        action: "room/join",
        roomId: "room_1",
        username: "guest",
        body: {
          username: "guest",
          inviteToken: "invite_1",
        },
      }),
    );

    expect(guestJoin.status).toBe(200);

    const outsiderRead = await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_1", "room/messages"),
        action: "room/messages",
        roomId: "room_1",
        username: "outsider",
        body: { sinceSequence: 0 },
      }),
    );

    expect(outsiderRead.status).toBe(401);
    expect((await jsonBody(outsiderRead)).code).toBe("UNAUTHORIZED");
  });

  it("requires owner auth for room creation", async () => {
    const worker = new RoomWorker(
      {
        owner: "owner",
        workerUrl: "https://worker.example",
      },
      { kv: new InMemoryKv() },
    );

    const response = await worker.handle(
      await authedRequest({
        url: "https://worker.example/rooms",
        action: "rooms/create",
        roomId: "room_auth",
        username: "guest",
        body: {
          roomId: "room_auth",
          roomName: "Rex",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect((await jsonBody(response)).code).toBe("UNAUTHORIZED");
  });

  it("rejects join username spoofing", async () => {
    const worker = new RoomWorker(
      {
        owner: "owner",
        workerUrl: "https://worker.example",
      },
      { kv: new InMemoryKv() },
    );

    await createRoom(worker, "room_auth");

    const spoofedJoin = await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_auth", "room/join"),
        action: "room/join",
        roomId: "room_auth",
        username: "owner",
        body: { username: "guest" },
      }),
    );

    expect(spoofedJoin.status).toBe(401);
    expect((await jsonBody(spoofedJoin)).code).toBe("UNAUTHORIZED");
  });

  it("stores canonical parent refs in room snapshots and unlinks by full ref", async () => {
    const worker = new RoomWorker(
      {
        owner: "owner",
        workerUrl: "https://worker.example",
      },
      { kv: new InMemoryKv() },
    );

    await createRoom(worker, "project_1", "Project");
    await createRoom(worker, "task_1", "Task");

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("project_1", "room/join"),
        action: "room/join",
        roomId: "project_1",
        username: "owner",
        body: { username: "owner" },
      }),
    );
    await worker.handle(
      await authedRequest({
        url: roomEndpoint("task_1", "room/join"),
        action: "room/join",
        roomId: "task_1",
        username: "owner",
        body: { username: "owner" },
      }),
    );

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("project_1", "fields/set"),
        action: "fields/set",
        roomId: "project_1",
        username: "owner",
        body: {
          fields: { name: "Project" },
          collection: "projects",
        },
      }),
    );
    await worker.handle(
      await authedRequest({
        url: roomEndpoint("task_1", "fields/set"),
        action: "fields/set",
        roomId: "task_1",
        username: "owner",
        body: {
          fields: { title: "Task" },
          collection: "tasks",
        },
      }),
    );

    const parentRef = {
      id: "project_1",
      collection: "projects",
      owner: "owner",
      target: "https://worker.example/rooms/project_1",
    };

    const link = await worker.handle(
      await authedRequest({
        url: roomEndpoint("task_1", "parents/link-parent"),
        action: "parents/link-parent",
        roomId: "task_1",
        username: "owner",
        body: { parentRef },
      }),
    );

    expect(link.status).toBe(200);
    expect((await jsonBody(link)).parentRefs).toEqual([parentRef]);

    const snapshot = await worker.handle(
      await authedRequest({
        url: roomEndpoint("task_1", "room/get"),
        action: "room/get",
        roomId: "task_1",
        username: "owner",
      }),
    );

    expect(snapshot.status).toBe(200);
    expect((await jsonBody(snapshot))).toMatchObject({
      id: "task_1",
      collection: "tasks",
      parentRefs: [parentRef],
    });

    const unlink = await worker.handle(
      await authedRequest({
        url: roomEndpoint("task_1", "parents/unlink-parent"),
        action: "parents/unlink-parent",
        roomId: "task_1",
        username: "owner",
        body: { parentRef },
      }),
    );

    expect(unlink.status).toBe(200);
    expect((await jsonBody(unlink)).parentRefs).toEqual([]);
  });

  it("stamps message sender from authenticated requester", async () => {
    const worker = new RoomWorker(
      {
        owner: "owner",
        workerUrl: "https://worker.example",
      },
      { kv: new InMemoryKv() },
    );

    await createRoom(worker, "room_2");

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_2", "room/join"),
        action: "room/join",
        roomId: "room_2",
        username: "owner",
        body: { username: "owner" },
      }),
    );

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_2", "invite-token/create"),
        action: "invite-token/create",
        roomId: "room_2",
        username: "owner",
        body: {
          token: "invite_2",
          roomId: "room_2",
          invitedBy: "owner",
          createdAt: 10,
        },
      }),
    );

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_2", "room/join"),
        action: "room/join",
        roomId: "room_2",
        username: "guest",
        body: {
          username: "guest",
          inviteToken: "invite_2",
        },
      }),
    );

    const post = await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_2", "room/message"),
        action: "room/message",
        roomId: "room_2",
        username: "guest",
        body: {
          id: "msg_1",
          roomId: "room_2",
          body: { userType: "user", content: "hello" },
          createdAt: 100,
          signedBy: "owner",
        },
      }),
    );

    expect(post.status).toBe(200);
    expect((await jsonBody(post)).message).toMatchObject({
      id: "msg_1",
      roomId: "room_2",
      signedBy: "guest",
      sequence: 1,
    });
  });

  it("returns messages sorted by createdAt and id", async () => {
    const worker = new RoomWorker(
      {
        owner: "owner",
        workerUrl: "https://worker.example",
      },
      { kv: new InMemoryKv() },
    );

    await createRoom(worker, "room_3");

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_3", "room/join"),
        action: "room/join",
        roomId: "room_3",
        username: "owner",
        body: { username: "owner" },
      }),
    );

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_3", "room/message"),
        action: "room/message",
        roomId: "room_3",
        username: "owner",
        body: {
          id: "b",
          roomId: "room_3",
          body: { userType: "user", content: "b" },
          createdAt: 1000,
        },
      }),
    );

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_3", "room/message"),
        action: "room/message",
        roomId: "room_3",
        username: "owner",
        body: {
          id: "a",
          roomId: "room_3",
          body: { userType: "user", content: "a" },
          createdAt: 1000,
        },
      }),
    );

    const response = await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_3", "room/messages"),
        action: "room/messages",
        roomId: "room_3",
        username: "owner",
        body: { sinceSequence: 0 },
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { messages: Array<{ id: string }> };
    expect(payload.messages.map((message) => message.id)).toEqual(["a", "b"]);
  });

  it("requires sinceSequence for message polling", async () => {
    const worker = new RoomWorker(
      {
        owner: "owner",
        workerUrl: "https://worker.example",
      },
      { kv: new InMemoryKv() },
    );

    await createRoom(worker, "room_req_seq");

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_req_seq", "room/join"),
        action: "room/join",
        roomId: "room_req_seq",
        username: "owner",
        body: { username: "owner" },
      }),
    );

    const response = await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_req_seq", "room/messages"),
        action: "room/messages",
        roomId: "room_req_seq",
        username: "owner",
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("BAD_REQUEST");
  });

  it("uses room sequence to skip list reads when nothing changed", async () => {
    const kv = new CountingKv();
    const worker = new RoomWorker(
      {
        owner: "owner",
        workerUrl: "https://worker.example",
      },
      { kv },
    );

    await createRoom(worker, "room_seq");

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_seq", "room/join"),
        action: "room/join",
        roomId: "room_seq",
        username: "owner",
        body: { username: "owner" },
      }),
    );

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_seq", "room/message"),
        action: "room/message",
        roomId: "room_seq",
        username: "owner",
        body: {
          id: "msg_1",
          roomId: "room_seq",
          body: { userType: "user", content: "hello" },
          createdAt: 1000,
        },
      }),
    );

    const noChangeResponse = await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_seq", "room/messages"),
        action: "room/messages",
        roomId: "room_seq",
        username: "owner",
        body: { sinceSequence: 1 },
      }),
    );
    expect(noChangeResponse.status).toBe(200);
    const noChangePayload = (await noChangeResponse.json()) as {
      messages: Array<Record<string, unknown>>;
      latestSequence: number;
    };
    expect(noChangePayload.messages).toHaveLength(0);
    expect(noChangePayload.latestSequence).toBe(1);
    expect(kv.listCalls).toBe(0);

    const changedResponse = await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_seq", "room/messages"),
        action: "room/messages",
        roomId: "room_seq",
        username: "owner",
        body: { sinceSequence: 0 },
      }),
    );
    expect(changedResponse.status).toBe(200);
    expect(kv.listCalls).toBe(1);
  });

  it("all members see all messages globally", async () => {
    const worker = new RoomWorker(
      {
        owner: "owner",
        workerUrl: "https://worker.example",
      },
      { kv: new InMemoryKv() },
    );

    await createRoom(worker, "room_4");

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_4", "room/join"),
        action: "room/join",
        roomId: "room_4",
        username: "owner",
        body: { username: "owner" },
      }),
    );

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_4", "invite-token/create"),
        action: "invite-token/create",
        roomId: "room_4",
        username: "owner",
        body: {
          token: "invite_4",
          roomId: "room_4",
          invitedBy: "owner",
          createdAt: 10,
        },
      }),
    );

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_4", "room/join"),
        action: "room/join",
        roomId: "room_4",
        username: "guest",
        body: {
          username: "guest",
          inviteToken: "invite_4",
        },
      }),
    );

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_4", "room/message"),
        action: "room/message",
        roomId: "room_4",
        username: "guest",
        body: {
          id: "msg_guest",
          roomId: "room_4",
          body: { type: "yjs-update", data: "AAAA" },
          createdAt: 100,
        },
      }),
    );

    await worker.handle(
      await authedRequest({
        url: roomEndpoint("room_4", "room/message"),
        action: "room/message",
        roomId: "room_4",
        username: "owner",
        body: {
          id: "msg_owner",
          roomId: "room_4",
          body: { type: "yjs-update", data: "BBBB" },
          createdAt: 120,
        },
      }),
    );

    for (const username of ["guest", "owner"]) {
      const response = await worker.handle(
        await authedRequest({
          url: roomEndpoint("room_4", "room/messages"),
          action: "room/messages",
          roomId: "room_4",
          username,
          body: { sinceSequence: 0 },
        }),
      );
      const payload = (await response.json()) as { messages: Array<{ id: string }> };
      expect(payload.messages.map((message) => message.id)).toEqual(["msg_guest", "msg_owner"]);
    }
  });

  it("allows puter-auth in CORS preflight", async () => {
    const worker = new RoomWorker(
      {
        owner: "owner",
        workerUrl: "https://worker.example",
      },
      { kv: new InMemoryKv() },
    );

    const response = await worker.handle(
      new Request(roomEndpoint("room_cors", "room/join"), {
        method: "OPTIONS",
        headers: {
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,puter-auth",
        },
      }),
    );

    expect(response.status).toBe(204);
    const allowHeaders = response.headers.get("access-control-allow-headers");
    expect(allowHeaders).toContain("puter-auth");
  });

  it("reproduces inherited-membership failure when exec cannot cross worker boundaries", async () => {
    const network = new WorkerNetwork();
    const aliceBase = "https://alice.example";
    const bobBase = "https://bob.example";

    network.register(
      aliceBase,
      new RoomWorker(
        { owner: "alice", workerUrl: aliceBase },
        { kv: new InMemoryKv() },
      ),
    );
    network.register(
      bobBase,
      new RoomWorker(
        { owner: "bob", workerUrl: bobBase },
        { kv: new InMemoryKv() },
      ),
    );

    const run = async (mode: "full" | "local-only", args: Parameters<typeof authedRequest>[0]) =>
      network.dispatch(mode, await authedRequest(args));

    expect(await run("full", {
      url: `${aliceBase}/rooms`,
      action: "rooms/create",
      roomId: "dog_1",
      username: "alice",
      body: { roomId: "dog_1", roomName: "Rex" },
    })).toMatchObject({ status: 200 });

    expect(await run("full", {
      url: roomEndpoint("dog_1", "room/join").replace("https://worker.example", aliceBase),
      action: "room/join",
      roomId: "dog_1",
      username: "alice",
      body: { username: "alice" },
    })).toMatchObject({ status: 200 });

    expect(await run("full", {
      url: roomEndpoint("dog_1", "invite-token/create").replace("https://worker.example", aliceBase),
      action: "invite-token/create",
      roomId: "dog_1",
      username: "alice",
      body: { token: "invite_1", roomId: "dog_1", invitedBy: "alice", createdAt: 1 },
    })).toMatchObject({ status: 200 });

    expect(await run("full", {
      url: roomEndpoint("dog_1", "room/join").replace("https://worker.example", aliceBase),
      action: "room/join",
      roomId: "dog_1",
      username: "bob",
      body: { username: "bob", inviteToken: "invite_1" },
    })).toMatchObject({ status: 200 });

    expect(await run("full", {
      url: roomEndpoint("dog_1", "fields/set").replace("https://worker.example", aliceBase),
      action: "fields/set",
      roomId: "dog_1",
      username: "alice",
      body: { collection: "dogs", fields: { name: "Rex" } },
    })).toMatchObject({ status: 200 });

    expect(await run("full", {
      url: `${bobBase}/rooms`,
      action: "rooms/create",
      roomId: "tag_1",
      username: "bob",
      body: { roomId: "tag_1", roomName: "friendly" },
    })).toMatchObject({ status: 200 });

    expect(await run("full", {
      url: roomEndpoint("tag_1", "room/join").replace("https://worker.example", bobBase),
      action: "room/join",
      roomId: "tag_1",
      username: "bob",
      body: { username: "bob" },
    })).toMatchObject({ status: 200 });

    expect(await run("full", {
      url: roomEndpoint("tag_1", "fields/set").replace("https://worker.example", bobBase),
      action: "fields/set",
      roomId: "tag_1",
      username: "bob",
      body: {
        collection: "tags",
        fields: { label: "friendly", createdBy: "bob", createdAt: 1 },
      },
    })).toMatchObject({ status: 200 });

    expect(await run("full", {
      url: roomEndpoint("dog_1", "parents/register-child").replace("https://worker.example", aliceBase),
      action: "parents/register-child",
      roomId: "dog_1",
      username: "bob",
      body: {
        childRowId: "tag_1",
        childOwner: "bob",
        childTarget: `${bobBase}/rooms/tag_1`,
        collection: "tags",
        fields: { label: "friendly", createdBy: "bob", createdAt: 1 },
      },
    })).toMatchObject({ status: 200 });

    expect(await run("full", {
      url: roomEndpoint("tag_1", "parents/link-parent").replace("https://worker.example", bobBase),
      action: "parents/link-parent",
      roomId: "tag_1",
      username: "bob",
      body: {
        parentRef: {
          id: "dog_1",
          collection: "dogs",
          owner: "alice",
          target: `${aliceBase}/rooms/dog_1`,
        },
      },
    })).toMatchObject({ status: 200 });

    const parentQuery = await run("local-only", {
      url: roomEndpoint("dog_1", "db/query").replace("https://worker.example", aliceBase),
      action: "db/query",
      roomId: "dog_1",
      username: "alice",
      body: { collection: "tags" },
    });
    expect(parentQuery.status).toBe(200);
    expect((await jsonBody(parentQuery)).rows).toEqual([
      expect.objectContaining({
        rowId: "tag_1",
        owner: "bob",
        target: `${bobBase}/rooms/tag_1`,
      }),
    ]);

    const childFieldsWithLocalOnlyExec = await run("local-only", {
      url: roomEndpoint("tag_1", "fields/get").replace("https://worker.example", bobBase),
      action: "fields/get",
      roomId: "tag_1",
      username: "alice",
    });
    expect(childFieldsWithLocalOnlyExec.status).toBe(401);
    expect((await jsonBody(childFieldsWithLocalOnlyExec)).message).toBe("Members only");

    const childFieldsWithFullExec = await run("full", {
      url: roomEndpoint("tag_1", "fields/get").replace("https://worker.example", bobBase),
      action: "fields/get",
      roomId: "tag_1",
      username: "alice",
    });
    expect(childFieldsWithFullExec.status).toBe(200);
    expect((await jsonBody(childFieldsWithFullExec)).fields).toMatchObject({
      label: "friendly",
      createdBy: "bob",
    });
  });
});

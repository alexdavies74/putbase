import type { Identity } from "./identity";
import type { Provisioning } from "./provisioning";
import type { Transport } from "./transport";
import { buildRoomTarget } from "./transport";
import type { JoinOptions, Room, RoomSnapshot } from "./types";

interface PostMessageResponse {
  message: { sequence: number };
}

export class Rooms {
  constructor(
    private readonly transport: Transport,
    private readonly identity: Identity,
    private readonly provisioning: Provisioning,
    private readonly ensureReady: () => Promise<void>,
  ) {}

  async createRoom(name: string): Promise<Room> {
    await this.ensureReady();

    const user = await this.identity.whoAmI();
    const federationWorkerUrl = await this.provisioning.getFederationWorkerUrl(user.username);
    const roomId = this.transport.createId("room");
    const roomTarget = buildRoomTarget(federationWorkerUrl, roomId);

    await this.transport.request({
      url: `${federationWorkerUrl}/rooms`,
      action: "rooms/create",
      roomId,
      payload: {
        roomId,
        roomName: name,
      },
    });

    await this.joinRoom(roomTarget, {});

    const room = await this.getRoom(roomTarget);
    return {
      id: room.id,
      name: room.name,
      owner: room.owner,
      target: room.target,
      createdAt: room.createdAt,
    };
  }

  async joinRoom(target: string, options: JoinOptions = {}): Promise<Room> {
    const user = await this.identity.whoAmI();
    const room = this.transport.room(target);

    await room.request("room/join", {
      username: user.username,
      inviteToken: options.inviteToken,
    });

    const snapshot = await this.getRoom(target);
    return {
      id: snapshot.id,
      name: snapshot.name,
      owner: snapshot.owner,
      target: snapshot.target,
      createdAt: snapshot.createdAt,
    };
  }

  async getRoom(target: string): Promise<RoomSnapshot> {
    return this.transport.room(target).request<RoomSnapshot>("room/get", {});
  }

  async listMembers(target: string): Promise<string[]> {
    const snapshot = await this.getRoom(target);
    return snapshot.members;
  }

  async sendMessage(target: string, roomId: string, body: unknown): Promise<{ sequence: number }> {
    const payload = {
      id: this.transport.createId("msg"),
      roomId,
      body,
      createdAt: Date.now(),
    };

    const response = await this.transport.room({ id: roomId, target }).request<PostMessageResponse>("room/message", payload);

    return response.message;
  }

  async pollMessages(
    target: string,
    sinceSequence: number,
  ): Promise<{ messages: Array<{ body: unknown; sequence: number; createdAt: number; id: string }>; latestSequence: number }> {
    return this.transport.room(target).request("room/messages", { sinceSequence });
  }
}

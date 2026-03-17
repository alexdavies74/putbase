import type { Identity } from "./identity";
import type { Provisioning } from "./provisioning";
import type { Transport } from "./transport";
import { buildRowTarget } from "./transport";
import type { JoinOptions, Row, RowSnapshot } from "./types";

interface PostMessageResponse {
  message: { sequence: number };
}

export class RowRuntime {
  constructor(
    private readonly transport: Transport,
    private readonly identity: Identity,
    private readonly provisioning: Provisioning,
    private readonly ensureReady: () => Promise<void>,
  ) {}

  async createRow(name: string): Promise<Row> {
    await this.ensureReady();

    const user = await this.identity.whoAmI();
    const federationWorkerUrl = await this.provisioning.getFederationWorkerUrl(user.username);
    const rowId = this.transport.createId("row");
    const rowTarget = buildRowTarget(federationWorkerUrl, rowId);

    await this.transport.request({
      url: `${federationWorkerUrl}/rows`,
      action: "rows/create",
      rowId,
      payload: {
        rowId,
        rowName: name,
      },
    });

    await this.joinRow(rowTarget, {});

    const row = await this.getRow(rowTarget);
    return {
      id: row.id,
      name: row.name,
      owner: row.owner,
      target: row.target,
      createdAt: row.createdAt,
    };
  }

  async joinRow(target: string, options: JoinOptions = {}): Promise<Row> {
    const user = await this.identity.whoAmI();
    const row = this.transport.row(target);

    await row.request("row/join", {
      username: user.username,
      inviteToken: options.inviteToken,
    });

    const snapshot = await this.getRow(target);
    return {
      id: snapshot.id,
      name: snapshot.name,
      owner: snapshot.owner,
      target: snapshot.target,
      createdAt: snapshot.createdAt,
    };
  }

  async getRow(target: string): Promise<RowSnapshot> {
    return this.transport.row(target).request<RowSnapshot>("row/get", {});
  }

  async listMembers(target: string): Promise<string[]> {
    const snapshot = await this.getRow(target);
    return snapshot.members;
  }

  async sendSyncMessage(target: string, rowId: string, body: unknown): Promise<{ sequence: number }> {
    const payload = {
      id: this.transport.createId("msg"),
      rowId,
      body,
      createdAt: Date.now(),
    };

    const response = await this.transport.row({ id: rowId, target }).request<PostMessageResponse>("sync/send", payload);

    return response.message;
  }

  async pollSyncMessages(
    target: string,
    sinceSequence: number,
  ): Promise<{ messages: Array<{ body: unknown; sequence: number; createdAt: number; id: string }>; latestSequence: number }> {
    return this.transport.row(target).request("sync/poll", { sinceSequence });
  }
}

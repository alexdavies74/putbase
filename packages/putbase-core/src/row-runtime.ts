import type { Identity } from "./identity";
import type { Provisioning } from "./provisioning";
import type { Transport } from "./transport";
import { buildRowTarget } from "./transport";
import type { JoinOptions, PutBaseUser, Row, RowSnapshot } from "./types";

interface PostMessageResponse {
  message: { sequence: number };
}

export interface PlannedRowState {
  user: PutBaseUser;
  federationWorkerUrl: string;
}

export interface PlannedRow {
  row: Row;
}

export class RowRuntime {
  private plannedState: PlannedRowState | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly identity: Identity,
    private readonly provisioning: Provisioning,
    private readonly ensureReady: () => Promise<void>,
  ) {}

  setPlannedState(state: PlannedRowState): void {
    this.plannedState = state;
  }

  clearPlannedState(): void {
    this.plannedState = null;
  }

  assertPlannedState(): PlannedRowState {
    if (!this.plannedState) {
      throw new Error("PutBase client is not ready. Call ensureReady() before mutating.");
    }

    return this.plannedState;
  }

  planRow(name: string): PlannedRow {
    const state = this.assertPlannedState();
    const rowId = this.transport.createId("row");
    const rowTarget = buildRowTarget(state.federationWorkerUrl, rowId);

    return {
      row: {
        id: rowId,
        name,
        owner: state.user.username,
        target: rowTarget,
        createdAt: Date.now(),
      },
    };
  }

  async commitPlannedRow(plan: PlannedRow): Promise<Row> {
    const state = this.assertPlannedState();
    await this.transport.request({
      url: `${state.federationWorkerUrl}/rows`,
      action: "rows/create",
      rowId: plan.row.id,
      payload: {
        rowId: plan.row.id,
        rowName: plan.row.name,
      },
    });

    await this.joinRow(plan.row.target, {});

    const row = await this.getRow(plan.row.target);
    return {
      id: row.id,
      name: row.name,
      owner: row.owner,
      target: row.target,
      createdAt: row.createdAt,
    };
  }

  async createRow(name: string): Promise<Row> {
    await this.ensureReady();
    const user = await this.identity.whoAmI();
    const federationWorkerUrl = await this.provisioning.getFederationWorkerUrl(user.username);
    this.setPlannedState({ user, federationWorkerUrl });
    return this.commitPlannedRow(this.planRow(name));
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

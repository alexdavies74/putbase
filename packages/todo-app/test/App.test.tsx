// @vitest-environment jsdom

import type { ReactElement, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const boardHandle = {
  id: "board_1",
  collection: "boards",
  owner: "alex",
  target: "https://worker.example/rows/board_1",
  fields: { title: "Shared board" },
} as const;

const openInviteMock = vi.fn(async () => boardHandle);

vi.mock("../src/db", () => ({
  db: {
    openInvite: openInviteMock,
    put: vi.fn(),
  },
}));

vi.mock("@putbase/react", async () => {
  const React = await import("react");

  return {
    PutBaseProvider({ children }: { children: ReactNode }) {
      return <>{children}</>;
    },
    useSession() {
      const [session, setSession] = React.useState<
        | {
          status: "loading";
          data: undefined;
          session: { state: "loading" };
        }
        | {
          status: "success";
          data: { state: "signed-in"; user: { username: string } };
          session: { state: "signed-in"; user: { username: string } };
        }
      >({
        status: "loading",
        data: undefined,
        session: { state: "loading" },
      });

      React.useEffect(() => {
        void Promise.resolve().then(() => {
          setSession({
            status: "success",
            data: { state: "signed-in", user: { username: "alex" } },
            session: { state: "signed-in", user: { username: "alex" } },
          });
        });
      }, []);

      return {
        ...session,
        error: undefined,
        refresh: async () => undefined,
        signIn: async () => ({ username: "alex" }),
      };
    },
    useMutation<TArgs, TResult>(fn: (arg: TArgs) => Promise<TResult>) {
      return {
        status: "idle" as const,
        error: null,
        mutate: fn,
      };
    },
    useQuery() {
      return {
        rows: [],
        data: [],
        error: undefined,
        status: "success" as const,
        refresh: async () => undefined,
      };
    },
    useInviteLink() {
      return {
        data: null,
        error: undefined,
        status: "idle" as const,
        refresh: async () => undefined,
      };
    },
  };
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(check: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await flushMicrotasks();
      });
    }
  }

  throw lastError;
}

async function renderApp(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
    await flushMicrotasks();
  });

  return {
    container,
    async unmount() {
      await act(async () => {
        root.unmount();
        await flushMicrotasks();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  openInviteMock.mockClear();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("todo app invite handling", () => {
  it("opens the shared board after session resolution on invite reload", async () => {
    const inviteUrl = "/?target=https%3A%2F%2Fworker.example%2Frows%2Fboard_1&token=invite_1";

    window.history.replaceState(
      {},
      "",
      inviteUrl,
    );

    const { default: App } = await import("../src/App");
    const app = await renderApp(<App />);

    await waitFor(() => {
      expect(openInviteMock).toHaveBeenCalledWith(`http://localhost:3000${inviteUrl}`);
      expect(app.container.textContent).toContain("Shared board");
    });

    expect(window.location.search).toBe("");
    await app.unmount();
  });
});

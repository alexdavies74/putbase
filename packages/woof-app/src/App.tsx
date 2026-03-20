import { puter } from "@heyputer/puter.js";
import { useInviteFromLocation, useInviteLink, useMutation, usePutBase, useQuery, useRowTarget, useSession } from "@putbase/react";
import { useEffect, useRef, useState } from "react";

import type { ChatEntry } from "./service";
import { useChatEntries, useRowConnection } from "./app-hooks";
import type { DogRowHandle, WoofSchema } from "./schema";
import { TagsPanel } from "./tags-panel";
import { getErrorMessage } from "./utils";
import { service } from "./services";

function SetupPanel(props: {
  busyMessage?: string;
  disabled: boolean;
  initialError: string;
  onEnter(row: DogRowHandle): Promise<void>;
}) {
  const [dogName, setDogName] = useState("");
  const enterChat = useMutation(async (nextDogName: string) => service.enterChat({ dogName: nextDogName }));
  const isSubmitting = enterChat.status === "loading";

  const errorMessage = enterChat.error
    ? getErrorMessage(enterChat.error, "Failed to enter chat.")
    : props.disabled
      ? props.busyMessage ?? "Initializing app…"
      : props.initialError;

  return (
    <section className="panel">
      <h1>Adopt a dog</h1>
      <p className="muted">Create a room for your dog, or join an existing room via invite link.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = dogName.trim();
          if (!trimmed) {
            return;
          }

          void enterChat.mutate(trimmed).then((row) => {
            setDogName("");
            return props.onEnter(row);
          }).catch((error) => {
            console.error("[woof-app] enterChat failed", {
              error,
              dogName: trimmed,
            });
          });
        }}
      >
        <label htmlFor="dog-name">Dog name</label>
        <input
          id="dog-name"
          name="dogName"
          placeholder="Rex"
          required
          value={dogName}
          onChange={(event) => setDogName(event.target.value)}
        />
        <button className="primary" type="submit" disabled={props.disabled || isSubmitting}>
          {isSubmitting ? "Loading…" : "Enter chat"}
        </button>
      </form>
      <p className="muted">{errorMessage}</p>
    </section>
  );
}

function SignInPanel(props: {
  busy: boolean;
  errorMessage: string;
  hasInvite: boolean;
  onSignIn(): void;
}) {
  const description = props.hasInvite
    ? "Log in with Puter to join this shared dog room."
    : "Log in with Puter before creating or restoring a dog room.";

  return (
    <section className="panel">
      <h1>Adopt a dog</h1>
      <p className="muted">{description}</p>
      <button className="primary" type="button" disabled={props.busy} onClick={props.onSignIn}>
        {props.busy ? "Opening Puter…" : props.hasInvite ? "Log in to join invite" : "Log in with Puter"}
      </button>
      <p className="muted">{props.errorMessage}</p>
    </section>
  );
}

function ChatPanel(props: {
  currentUsername: string | null;
  entries: ChatEntry[];
  row: DogRowHandle;
}) {
  const [message, setMessage] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sendTurn = useMutation(async (content: string) => {
    await service.sendTurn(props.row, content, puter.ai);
  });

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [props.entries]);

  return (
    <>
      <div ref={containerRef} id="messages">
        {props.entries.map((entry) => (
          <div key={entry.id} className={`message ${entry.userType === "dog" ? "dog" : "user"}`}>
            {entry.userType === "dog" ? String(props.row.fields.name ?? "") : "You"}: {entry.content}
          </div>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = message.trim();
          if (!trimmed) {
            return;
          }

          void sendTurn.mutate(trimmed).then(() => {
            setMessage("");
          }).catch(() => undefined);
        }}
      >
        <label htmlFor="message-input">Message</label>
        <textarea
          id="message-input"
          rows={3}
          placeholder="Say hello"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button className="primary" type="submit" disabled={sendTurn.status === "loading" || !props.currentUsername}>
          {sendTurn.status === "loading" ? "Sending…" : "Send"}
        </button>
      </form>
      <p className="muted">{sendTurn.error ? getErrorMessage(sendTurn.error, "Failed to send message.") : ""}</p>
    </>
  );
}

function RoomScreen(props: {
  currentUsername: string | null;
  onRelinquished(): Promise<void>;
  row: DogRowHandle;
}) {
  const db = usePutBase<WoofSchema>();
  const [copyStatus, setCopyStatus] = useState("");
  const inviteLink = useInviteLink(db, props.row);
  const relinquish = useMutation(async () => {
    await service.relinquish();
    await props.onRelinquished();
  });
  useRowConnection(service, props.row);
  const entries = useChatEntries(service, props.row, props.currentUsername);

  return (
    <section className="panel">
      <h1>{String(props.row.fields.name ?? "")}&apos;s Room</h1>
      <div className="toolbar">
        <button
          id="copy-link"
          className="secondary"
          type="button"
          disabled={!inviteLink.data}
          onClick={() => {
            if (!inviteLink.data) {
              return;
            }

            void navigator.clipboard.writeText(inviteLink.data).then(() => {
              setCopyStatus("Invite link copied.");
            }).catch(() => {
              setCopyStatus("Could not copy invite link.");
            });
          }}
        >
          Copy link
        </button>
        <button
          id="relinquish"
          className="secondary"
          type="button"
          onClick={() => {
            void relinquish.mutate().catch(() => undefined);
          }}
        >
          Relinquish Dog
        </button>
      </div>
      <p className="muted">
        {inviteLink.data ? <a id="invite-link" href={inviteLink.data}>{inviteLink.data}</a> : "Could not create invite link yet."}
        {" "}
        <span id="invite-status">
          {copyStatus || (inviteLink.error ? getErrorMessage(inviteLink.error, "Could not create invite link yet.") : "")}
        </span>
      </p>
      <TagsPanel
        row={props.row}
        onCreateTag={(label) => service.createTag(props.row, label)}
      />
      <ChatPanel currentUsername={props.currentUsername} entries={entries} row={props.row} />
      <p className="muted">{relinquish.error ? getErrorMessage(relinquish.error, "Failed to relinquish dog.") : ""}</p>
    </section>
  );
}

export function App() {
  const db = usePutBase<WoofSchema>();
  const session = useSession(db);
  const signedInUser =
    session.status === "success" && session.data?.state === "signed-in"
      ? session.data.user
      : null;
  const [loginError, setLoginError] = useState("");
  const [loginStatus, setLoginStatus] = useState<"idle" | "loading">("idle");
  const [dismissedDogTarget, setDismissedDogTarget] = useState<string | null>(null);
  const invite = useInviteFromLocation<WoofSchema, DogRowHandle>(db, {
    clearLocation: (url) => {
      url.pathname = url.pathname === "/join" ? "/" : url.pathname;
      url.search = "";
      url.hash = "";
      return url.toString();
    },
    open: async (inviteInput, client) => service.expectDogRow(await client.openInvite(inviteInput)),
    onOpen: (nextRow) => {
      setDismissedDogTarget(null);
      void service.activateHistory(nextRow).catch((error) => {
        console.error("[woof-app] failed to activate dog history after invite", {
          error,
          target: nextRow.target,
        });
      });
    },
  });
  const invitePending = invite.hasInvite;
  const inviteRow = invite.status === "success" ? invite.data ?? null : null;
  const dogHistory = useQuery(
    db,
    "dogHistory",
    signedInUser
      ? {
        where: { status: "active" },
        limit: 1,
      }
      : null,
  );
  const activeHistoryRow = dogHistory.rows.find((historyRow) => historyRow.fields.dogTarget !== dismissedDogTarget) ?? null;
  const activeRowTarget = inviteRow ? null : activeHistoryRow?.fields.dogTarget ?? null;
  const openedActiveRow = useRowTarget(db, activeRowTarget, {
    enabled: !!activeRowTarget,
  });
  const restoredRow = openedActiveRow.data && openedActiveRow.data.collection === "dogs"
    ? openedActiveRow.data
    : null;
  const row = inviteRow ?? restoredRow;
  const bootError = invite.status === "error"
    ? getErrorMessage(invite.error, "Failed to join invite link.")
    : dogHistory.status === "error"
      ? getErrorMessage(dogHistory.error, "Could not restore saved room.")
      : openedActiveRow.status === "error"
        ? getErrorMessage(openedActiveRow.error, "Could not reopen saved room.")
        : openedActiveRow.data && openedActiveRow.data.collection !== "dogs"
          ? "Saved room did not point to a dog row."
          : "";
  const bootLoading =
    invite.status === "loading"
    || dogHistory.status === "loading"
    || (!!activeRowTarget && openedActiveRow.status === "loading");

  if (session.status === "loading") {
    return <SignInPanel busy errorMessage="" hasInvite={invitePending} onSignIn={() => undefined} />;
  }

  if (session.status === "error") {
    return (
      <SignInPanel
        busy={loginStatus === "loading"}
        errorMessage={getErrorMessage(session.error, "Could not initialize app.")}
        hasInvite={invitePending}
        onSignIn={() => undefined}
      />
    );
  }

  if (session.data?.state !== "signed-in") {
    return (
      <SignInPanel
        busy={loginStatus === "loading"}
        errorMessage={loginError}
        hasInvite={invitePending}
        onSignIn={() => {
          setLoginError("");
          setLoginStatus("loading");
          void session.signIn()
            .catch((error) => {
              setLoginError(getErrorMessage(error, "Could not sign in."));
            })
            .finally(() => {
              setLoginStatus("idle");
            });
        }}
      />
    );
  }

  if (bootLoading) {
    return (
      <SetupPanel
        busyMessage={invitePending ? "Opening shared dog room…" : "Initializing app…"}
        disabled
        initialError=""
        onEnter={async (nextRow) => {
          setDismissedDogTarget(null);
          void nextRow;
        }}
      />
    );
  }

  if (!row) {
    return (
      <SetupPanel
        disabled={false}
        initialError={bootError}
        onEnter={async (nextRow) => {
          setDismissedDogTarget(null);
          void nextRow;
        }}
      />
    );
  }

  return (
    <RoomScreen
      currentUsername={signedInUser?.username ?? null}
      row={row}
      onRelinquished={async () => {
        setDismissedDogTarget(row.target);
      }}
    />
  );
}

import { useEffect, useRef, useSyncExternalStore } from "react";

import type { DogProfile } from "./profile";
import type { ChatEntry, WoofService } from "./service";

function emptyEntries(): ChatEntry[] {
  return [];
}

export function useRowConnection(service: WoofService, profile: DogProfile | null): void {
  useEffect(() => {
    if (!profile) {
      service.disconnectRow();
      return;
    }

    service.connectToRow(profile);
    return () => {
      service.disconnectRow();
    };
  }, [profile, service]);
}

export function useChatEntries(
  service: WoofService,
  profile: DogProfile | null,
  username: string | null,
): ChatEntry[] {
  const cacheRef = useRef<{ key: string; value: ChatEntry[] }>({
    key: "",
    value: [],
  });

  return useSyncExternalStore(
    (notify) => {
      const observer = () => notify();
      service.chatArray.observe(observer);
      return () => {
        service.chatArray.unobserve(observer);
      };
    },
    () => {
      if (!profile || !username) {
        return emptyEntries();
      }

      const nextEntries = service.chatArray.toArray().filter((entry) => entry.threadUser === username);
      const nextKey = JSON.stringify(
        nextEntries.map((entry) => [entry.id, entry.content, entry.userType, entry.threadUser, entry.createdAt, entry.signedBy]),
      );
      if (cacheRef.current.key === nextKey) {
        return cacheRef.current.value;
      }

      cacheRef.current = {
        key: nextKey,
        value: nextEntries,
      };
      return nextEntries;
    },
    emptyEntries,
  );
}

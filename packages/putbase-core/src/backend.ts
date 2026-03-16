import type { BackendClient } from "./types";

export function resolveBackend(explicitBackend?: BackendClient): BackendClient | undefined {
  return explicitBackend ?? (globalThis as { puter?: BackendClient }).puter;
}

import { resolveBackendAsync } from "./backend.js";
import type { RowInput, RowRef } from "./schema.js";
import { normalizeRowRef } from "./row-reference.js";
import type { BackendClient, BackendKv } from "./types.js";

const SAVED_ROW_PREFIX = "vennbase:saved-row:v2";

export interface SavedRowEntry {
  key: string;
  ref: RowRef;
}

function normalizeStorageKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) {
    throw new Error("Saved row key is required");
  }
  return normalized;
}

function savedRowKey(key: string): string {
  return `${SAVED_ROW_PREFIX}:${normalizeStorageKey(key)}`;
}

function resolveStoredRow(row: RowInput): string {
  return JSON.stringify(normalizeRowRef(row));
}

async function resolveSavedRowsKv(backend?: BackendClient): Promise<BackendKv | null> {
  return (await resolveBackendAsync(backend))?.kv ?? null;
}

function parseSavedRowValue(value: unknown): RowRef | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as RowRef;
    return normalizeRowRef(parsed);
  } catch {
    return null;
  }
}

async function deleteStoredRow(
  backend: BackendClient | undefined,
  entryKey: string,
): Promise<void> {
  const kv = await resolveSavedRowsKv(backend);
  if (!kv) {
    return;
  }

  await kv.del(entryKey).catch(() => undefined);
}

export async function loadSavedRow(
  backend: BackendClient | undefined,
  key: string,
): Promise<RowRef | null> {
  const entryKey = savedRowKey(key);
  const kv = await resolveSavedRowsKv(backend);
  if (!kv) {
    return null;
  }

  const stored = await kv.get<unknown>(entryKey).catch(() => undefined);
  if (typeof stored !== "string") {
    return null;
  }

  const parsed = parseSavedRowValue(stored);
  if (!parsed) {
    await deleteStoredRow(backend, entryKey);
    return null;
  }

  return parsed;
}

export async function listSavedRows(
  backend: BackendClient | undefined,
): Promise<SavedRowEntry[]> {
  const kv = await resolveSavedRowsKv(backend);
  if (!kv?.list) {
    return [];
  }

  const listed = await kv.list(`${SAVED_ROW_PREFIX}:`, true).catch(() => []);
  const entries = Array.isArray(listed) ? listed : [];
  const results: SavedRowEntry[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !("key" in entry) || typeof entry.key !== "string") {
      continue;
    }

    const key = entry.key.startsWith(`${SAVED_ROW_PREFIX}:`)
      ? entry.key.slice(`${SAVED_ROW_PREFIX}:`.length)
      : entry.key;
    const ref = "value" in entry ? parseSavedRowValue(entry.value) : null;
    if (!ref) {
      continue;
    }

    results.push({ key, ref });
  }

  results.sort((left, right) => left.key.localeCompare(right.key));
  return results;
}

export async function saveRow(
  backend: BackendClient | undefined,
  key: string,
  row: RowInput,
): Promise<void> {
  const kv = await resolveSavedRowsKv(backend);
  if (!kv) {
    return;
  }

  await kv.set(savedRowKey(key), resolveStoredRow(row)).catch(() => undefined);
}

export async function clearSavedRow(
  backend: BackendClient | undefined,
  key: string,
): Promise<void> {
  await deleteStoredRow(backend, savedRowKey(key));
}

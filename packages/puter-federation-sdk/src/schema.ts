import { encodeFieldValue } from "./key-encoding";
import type { JsonValue } from "./types";

export type FieldType = "string" | "number" | "boolean" | "date" | "json";

export interface DbFieldSpec {
  type: FieldType;
  optional?: boolean;
  default?: JsonValue;
}

export interface DbIndexSpec {
  fields: string[];
}

export interface DbCollectionSpec {
  in?: string[];
  fields: Record<string, DbFieldSpec>;
  indexes?: Record<string, DbIndexSpec>;
}

export type DbSchema = Record<string, DbCollectionSpec>;

export type MemberRole = "admin" | "writer" | "reader";

export interface DbRowRef {
  id: string;
  collection: string;
  owner: string;
  workerUrl: string;
}

export interface DbRow<TFields extends Record<string, JsonValue> = Record<string, JsonValue>>
  extends DbRowRef {
  fields: TFields;
}

export interface DbPutOptions {
  in?: DbRowRef | DbRowRef[];
  name?: string;
}

export interface DbQueryOptions {
  in: DbRowRef | DbRowRef[];
  where?: Record<string, JsonValue>;
  index?: string;
  value?: JsonValue;
  order?: "asc" | "desc";
  limit?: number;
}

export interface DbQueryWatchCallbacks<TRow> {
  onChange(rows: TRow[]): void;
  onError?(error: unknown): void;
}

export interface DbQueryWatchHandle {
  disconnect(): void;
  refresh(): Promise<void>;
}

export interface DbMemberInfo {
  username: string;
  role: MemberRole;
  via: "direct" | DbRowRef;
}

// Pure schema validation functions

export function getCollectionSpec(schema: DbSchema, collection: string): DbCollectionSpec {
  const spec = schema[collection];
  if (!spec) {
    throw new Error(`Unknown collection: ${collection}`);
  }
  return spec;
}

export function applyDefaults(
  collectionSpec: DbCollectionSpec,
  fields: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const next: Record<string, JsonValue> = { ...fields };

  for (const [fieldName, fieldSpec] of Object.entries(collectionSpec.fields)) {
    if (next[fieldName] !== undefined) {
      continue;
    }

    if (fieldSpec.default !== undefined) {
      next[fieldName] = fieldSpec.default;
    }
  }

  return next;
}

export function assertPutParents(
  collection: string,
  collectionSpec: DbCollectionSpec,
  parents: DbRowRef[],
): void {
  const allowedParents = collectionSpec.in ?? [];
  if (allowedParents.length === 0 && parents.length > 0) {
    throw new Error(`Collection ${collection} does not allow parent links`);
  }

  if (allowedParents.length > 0 && parents.length === 0) {
    throw new Error(`Collection ${collection} requires an in parent`);
  }

  for (const parent of parents) {
    if (!allowedParents.includes(parent.collection)) {
      throw new Error(`Collection ${collection} cannot be in ${parent.collection}`);
    }
  }
}

export function assertParentAllowed(
  schema: DbSchema,
  childCollection: string,
  parentCollection: string,
): void {
  const childSpec = getCollectionSpec(schema, childCollection);
  const allowedParents = childSpec.in ?? [];
  if (!allowedParents.includes(parentCollection)) {
    throw new Error(`Collection ${childCollection} cannot be in ${parentCollection}`);
  }
}

export function pickIndex(
  collectionSpec: DbCollectionSpec,
  options: DbQueryOptions,
): { name: string; encodedValue: string | null } | null {
  if (options.index) {
    const explicit = collectionSpec.indexes?.[options.index];
    if (!explicit) {
      throw new Error(`Unknown index: ${options.index}`);
    }

    if (options.value === undefined || options.value === null) {
      return { name: options.index, encodedValue: null };
    }

    return {
      name: options.index,
      encodedValue: encodeFieldValue(options.value),
    };
  }

  if (!options.where || !collectionSpec.indexes) {
    return null;
  }

  const whereEntries = Object.entries(options.where);
  if (whereEntries.length !== 1) {
    return null;
  }

  const [whereField, whereValue] = whereEntries[0];
  for (const [indexName, indexSpec] of Object.entries(collectionSpec.indexes)) {
    if (indexSpec.fields.length === 1 && indexSpec.fields[0] === whereField) {
      return {
        name: indexName,
        encodedValue: encodeFieldValue(whereValue),
      };
    }
  }

  return null;
}

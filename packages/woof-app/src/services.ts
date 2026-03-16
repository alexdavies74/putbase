import { puter } from "@heyputer/puter.js";
import * as Y from "yjs";
import { PutBase } from "@putbase/core";

import { woofSchema } from "./schema";
import { WoofService } from "./service";

export const db = new PutBase({
  appBaseUrl: window.location.origin,
  schema: woofSchema,
});

const doc = new Y.Doc();

export const service = new WoofService(db, puter.kv, doc);

import { Vennbase } from "@vennbase/core";

import { woofSchema, type WoofDb } from "./schema";
import { WoofService } from "./service";

export const db: WoofDb = new Vennbase({
  appBaseUrl: window.location.origin,
  schema: woofSchema,
});

export const service = new WoofService(db);

import { PutBase } from "@putbase/core";
import { schema } from "./schema";

export const db = new PutBase({ schema, appBaseUrl: window.location.origin });

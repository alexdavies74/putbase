import { Vennbase } from "@vennbase/core";
import { schema } from "./schema";

export const db = new Vennbase({ schema, appBaseUrl: window.location.origin });

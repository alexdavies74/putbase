import { puter } from "@heyputer/puter.js";
import { Vennbase, VennbaseInspector, defineSchema } from "@vennbase/core";

const emptySchema = defineSchema({});

const provisioningDb = new Vennbase({
  schema: emptySchema,
  backend: puter,
  appBaseUrl: window.location.origin,
});

export const inspector = new VennbaseInspector({
  backend: puter,
});

export async function getInspectorSession() {
  const session = await provisioningDb.getSession();
  if (session.signedIn) {
    await provisioningDb.getSession();
  }
  return session;
}

export async function signInInspector() {
  await provisioningDb.signIn();
  await provisioningDb.getSession();
}

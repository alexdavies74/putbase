import { describe, expect, it } from "vitest";

import { buildClassicWorkerScript } from "../src/worker/template";

describe("buildClassicWorkerScript", () => {
  it("uses documented Puter worker globals", () => {
    const script = buildClassicWorkerScript({
      owner: "owner",
      workerUrl: "https://workers.puter.site/owner-federation",
    });

    expect(script).toMatch(/router\.post\((\"|')\/rooms(\"|')/);
    expect(script).toMatch(/router\.get\((\"|')\/rooms\/:roomId\/room(\"|')/);
    expect(script).toMatch(/router\.post\((\"|')\/rooms\/:roomId\/message(\"|')/);
    expect(script).toContain("me.puter.kv.get(");
    expect(script).toContain("me.puter.kv.set(");
    expect(script).toContain("me.puter.kv.incr(");
    expect(script).toContain("me.puter.kv.list(");
    expect(script).toContain("content-type,x-puter-username,puter-auth");
    expect(script).toContain("\"owner\"");
    expect(script).toContain("\"https://workers.puter.site/owner-federation\"");
    expect(script).not.toContain("__PUTER_FED_ROOM_OWNER__");
    expect(script).not.toContain("__PUTER_FED_ROOM_WORKER_URL__");

    expect(script).not.toMatch(/(^|[^\w.])puter\.router\./);
    expect(script).not.toMatch(/(^|[^\w.])puter\.kv\./);
  });
});

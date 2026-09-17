import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSessionCache } from "./session-cache.js";

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true });
});
function stateDirectory() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "composio-cache-"));
  temporary.push(dir);
  return dir;
}
const session = { sessionId: "trs-1", mcpUrl: "https://mcp.example.test/mcp" };

describe("session cache", () => {
  it("keeps per-sender sessions through close/reopen and persists deletion", async () => {
    const dir = stateDirectory();
    let cache = openSessionCache(dir);
    try {
      await cache.register("U1", session, { ttlMs: 10000 });
      await cache.register("U2", { ...session, sessionId: "trs-2" });
      cache.close();
      cache = openSessionCache(dir);
      expect(await cache.lookup("U1")).toEqual(session);
      expect((await cache.lookup("U2"))?.sessionId).toBe("trs-2");
      expect(await cache.delete("U1")).toBe(true);
      expect(await cache.delete("missing")).toBe(false);
      cache.close();
      cache = openSessionCache(dir);
      expect(await cache.lookup("U1")).toBeUndefined();
      expect(statSync(path.join(dir, "plugins/composio/sessions.sqlite")).mode & 0o777).toBe(0o600);
    } finally {
      cache.close();
    }
  });

  it("expires sessions and keeps the original insertion order when replacing at capacity", async () => {
    const cache = openSessionCache(stateDirectory());
    try {
      await cache.register("expired", session, { ttlMs: -1 });
      expect(await cache.lookup("expired")).toBeUndefined();
      for (let index = 0; index < 10000; index++) await cache.register(`U${index}`, session);
      await cache.register("U0", { ...session, sessionId: "replacement" });
      expect((await cache.lookup("U0"))?.sessionId).toBe("replacement");
      await cache.register("overflow", session);
      expect(await cache.lookup("U0")).toBeUndefined();
      expect(await cache.lookup("U1")).toEqual(session);
      expect(await cache.lookup("overflow")).toEqual(session);
    } finally {
      cache.close();
    }
  });
});

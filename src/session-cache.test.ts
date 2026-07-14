/** Session cache: persistent store when granted, in-memory fallback otherwise. */
import { describe, expect, it, vi } from "vitest";
import { openSessionCache } from "./session-cache.js";
import type { ToolRouterSession } from "./tool-router.js";

const session: ToolRouterSession = { sessionId: "trs-1", mcpUrl: "https://mcp.example.test/mcp" };

describe("openSessionCache", () => {
  it("uses the persistent store when the host grants it", () => {
    const store = { register: vi.fn(), lookup: vi.fn(), delete: vi.fn() };
    const onFallback = vi.fn();
    const cache = openSessionCache(() => store, onFallback);
    expect(cache).toBe(store);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("falls back to an in-memory cache and signals once when the store is denied", async () => {
    const onFallback = vi.fn();
    const cache = openSessionCache(() => {
      throw new Error("openKeyedStore is only available for trusted plugins in this release.");
    }, onFallback);

    expect(onFallback).toHaveBeenCalledTimes(1);
    await cache.register("U1", session);
    await expect(cache.lookup("U1")).resolves.toEqual(session);
    await expect(cache.delete("U1")).resolves.toBe(true);
    await expect(cache.lookup("U1")).resolves.toBeUndefined();
  });

  it("expires in-memory entries past their ttl", async () => {
    const cache = openSessionCache(() => {
      throw new Error("denied");
    });
    await cache.register("U1", session, { ttlMs: -1 });
    await expect(cache.lookup("U1")).resolves.toBeUndefined();
  });
});

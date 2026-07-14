import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
/** Behavior tests for the Composio requester-scoped connection resolver. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createComposioConnectionResolver } from "./resolver.js";
import type { ToolRouterSession } from "./tool-router.js";

function makeStore() {
  const entries = new Map<string, ToolRouterSession>();
  return {
    entries,
    register: vi.fn(async (key: string, value: ToolRouterSession) => {
      entries.set(key, value);
    }),
    lookup: vi.fn(async (key: string) => entries.get(key)),
    delete: vi.fn(async (key: string) => entries.delete(key)),
  };
}

const cfgWithKey = {
  plugins: { entries: { composio: { enabled: true, config: { apiKey: "test-auth-token" } } } },
} as OpenClawConfig;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("composio connection resolver", () => {
  it("fails closed without an API key", async () => {
    vi.stubEnv("COMPOSIO_API_KEY", "");
    const store = makeStore();
    const resolver = createComposioConnectionResolver({
      getConfig: () => ({}) as OpenClawConfig,
      openSessionStore: () => store,
      createSession: vi.fn(),
      probeSession: vi.fn(),
    });
    await expect(resolver.resolve({ requesterSenderId: "U1" })).resolves.toBeNull();
    expect(store.lookup).not.toHaveBeenCalled();
  });

  it("mints one session per sender and caches it", async () => {
    const store = makeStore();
    const createSession = vi.fn(async (_key: string, uid: string) => ({
      sessionId: `trs-${uid}`,
      mcpUrl: `https://backend.composio.dev/tool_router/trs-${uid}/mcp`,
    }));
    const probeSession = vi.fn(async () => "alive" as const);
    const onResolve = vi.fn();
    const resolver = createComposioConnectionResolver({
      getConfig: () => cfgWithKey,
      openSessionStore: () => store,
      onResolve,
      createSession,
      probeSession,
    });

    const first = await resolver.resolve({ requesterSenderId: "U1" });
    expect(first).toEqual({
      url: "https://backend.composio.dev/tool_router/trs-U1/mcp",
      headers: { "x-api-key": "test-auth-token" },
    });
    const second = await resolver.resolve({ requesterSenderId: "U2" });
    expect(second?.url).toBe("https://backend.composio.dev/tool_router/trs-U2/mcp");
    expect(createSession).toHaveBeenCalledTimes(2);

    // Cached path: no new session, one liveness probe.
    const again = await resolver.resolve({ requesterSenderId: "U1" });
    expect(again?.url).toBe(first?.url);
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(probeSession).toHaveBeenCalledWith("test-auth-token", "trs-U1");
    expect(onResolve.mock.calls.map(([e]) => e.outcome)).toEqual(["minted", "minted", "reused"]);
  });

  it("re-mints when the cached session expired server-side", async () => {
    const store = makeStore();
    store.entries.set("U1", { sessionId: "trs-old", mcpUrl: "https://old.example.test/mcp" });
    let minted = 0;
    const resolver = createComposioConnectionResolver({
      getConfig: () => cfgWithKey,
      openSessionStore: () => store,
      createSession: async () => {
        minted += 1;
        return { sessionId: "trs-new", mcpUrl: "https://new.example.test/mcp" };
      },
      probeSession: async () => "missing" as const,
    });

    const resolved = await resolver.resolve({ requesterSenderId: "U1" });
    expect(resolved?.url).toBe("https://new.example.test/mcp");
    expect(minted).toBe(1);
    expect(store.delete).toHaveBeenCalledWith("U1");
    expect(store.entries.get("U1")?.sessionId).toBe("trs-new");
  });

  it("returns null when session creation yields nothing", async () => {
    const store = makeStore();
    const resolver = createComposioConnectionResolver({
      getConfig: () => cfgWithKey,
      openSessionStore: () => store,
      createSession: async () => undefined,
      probeSession: async () => "alive" as const,
    });
    await expect(resolver.resolve({ requesterSenderId: "U1" })).resolves.toBeNull();
  });
});

// Requester-scoped MCP connection resolver: one Composio Tool Router session
// per trusted message sender. Per-user account auth happens inside the session
// (OAuth links delivered in chat by the router's manage-connections tool).
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { COMPOSIO_MCP_SERVER_NAME, resolveComposioApiKey } from "./config.js";
import {
  createToolRouterSession,
  probeToolRouterSession,
  type ToolRouterSession,
} from "./tool-router.js";

type KeyedStore<T> = {
  register(key: string, value: T, opts?: { ttlMs?: number }): Promise<void>;
  lookup(key: string): Promise<T | undefined>;
  delete(key: string): Promise<boolean>;
};

export type ComposioResolverDeps = {
  getConfig: () => OpenClawConfig | undefined;
  /** Lazy: registration can run in discovery modes without a live state runtime. */
  openSessionStore: () => KeyedStore<ToolRouterSession>;
  /** Structured ops signal only — never receives credentials or URLs. */
  onResolve?: (event: {
    requesterSenderId: string;
    outcome: "reused" | "minted" | "skipped";
  }) => void;
  createSession?: typeof createToolRouterSession;
  probeSession?: typeof probeToolRouterSession;
};

// Sessions are routing containers; connected accounts live at the user level,
// so an expired/lost session only costs a re-mint, never a user re-auth.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createComposioConnectionResolver(deps: ComposioResolverDeps) {
  const createSession = deps.createSession ?? createToolRouterSession;
  const probeSession = deps.probeSession ?? probeToolRouterSession;
  let store: KeyedStore<ToolRouterSession> | undefined;
  const sessionStore = () => (store ??= deps.openSessionStore());
  return {
    serverName: COMPOSIO_MCP_SERVER_NAME,
    resolve: async (ctx: { requesterSenderId: string }) => {
      const apiKey = resolveComposioApiKey(deps.getConfig());
      const uid = ctx.requesterSenderId;
      if (!apiKey) {
        deps.onResolve?.({ requesterSenderId: uid, outcome: "skipped" });
        return null;
      }
      const cached = await sessionStore().lookup(uid);
      if (cached) {
        // Resolve only runs on core's revalidation cadence, so one liveness
        // probe per resolve keeps stale server-side expiries self-healing.
        if ((await probeSession(apiKey, cached.sessionId)) === "alive") {
          deps.onResolve?.({ requesterSenderId: uid, outcome: "reused" });
          return { url: cached.mcpUrl, headers: { "x-api-key": apiKey } };
        }
        await sessionStore().delete(uid);
      }
      const session = await createSession(apiKey, uid);
      if (!session) {
        deps.onResolve?.({ requesterSenderId: uid, outcome: "skipped" });
        return null;
      }
      await sessionStore().register(uid, session, { ttlMs: SESSION_TTL_MS });
      deps.onResolve?.({ requesterSenderId: uid, outcome: "minted" });
      return { url: session.mcpUrl, headers: { "x-api-key": apiKey } };
    },
  };
}

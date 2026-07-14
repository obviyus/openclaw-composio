// index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// src/config.ts
import {
  normalizeResolvedSecretInputString,
  normalizeSecretInput
} from "openclaw/plugin-sdk/secret-input";
var COMPOSIO_API_BASE_URL = "https://backend.composio.dev";
var COMPOSIO_CREDENTIAL_PATH = "plugins.entries.composio.config.apiKey";
var COMPOSIO_MCP_SERVER_NAME = "composio";
function resolveComposioApiKey(cfg) {
  const pluginConfig = cfg?.plugins?.entries?.composio?.config;
  return normalizeSecretInput(normalizeResolvedSecretInputString({
    value: pluginConfig?.apiKey,
    path: COMPOSIO_CREDENTIAL_PATH
  })) || normalizeSecretInput(process.env.COMPOSIO_API_KEY) || undefined;
}

// src/tool-router.ts
var REQUEST_TIMEOUT_MS = 8000;
function requestInit(apiKey, body) {
  return {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-api-key": apiKey,
      ...body === undefined ? {} : { "content-type": "application/json" }
    },
    ...body === undefined ? {} : { body: JSON.stringify(body) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  };
}
function parseSession(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const record = payload;
  const sessionId = typeof record.session_id === "string" ? record.session_id : undefined;
  const mcpUrl = typeof record.mcp?.url === "string" ? record.mcp.url : undefined;
  return sessionId && mcpUrl ? { sessionId, mcpUrl } : undefined;
}
async function createToolRouterSession(apiKey, userId, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl ?? COMPOSIO_API_BASE_URL;
  const response = await fetchImpl(`${base}/api/v3.1/tool_router/session`, requestInit(apiKey, { user_id: userId }));
  if (!response.ok) {
    throw new Error(`Composio tool-router session create failed (${response.status})`);
  }
  return parseSession(await response.json());
}
async function probeToolRouterSession(apiKey, sessionId, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl ?? COMPOSIO_API_BASE_URL;
  const response = await fetchImpl(`${base}/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}`, requestInit(apiKey));
  if (response.status === 404 || response.status === 410) {
    return "missing";
  }
  if (!response.ok) {
    throw new Error(`Composio tool-router session probe failed (${response.status})`);
  }
  return "alive";
}

// src/resolver.ts
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function createComposioConnectionResolver(deps) {
  const createSession = deps.createSession ?? createToolRouterSession;
  const probeSession = deps.probeSession ?? probeToolRouterSession;
  let store;
  const sessionStore = () => store ??= deps.openSessionStore();
  return {
    serverName: COMPOSIO_MCP_SERVER_NAME,
    resolve: async (ctx) => {
      const apiKey = resolveComposioApiKey(deps.getConfig());
      const uid = ctx.requesterSenderId;
      if (!apiKey) {
        deps.onResolve?.({ requesterSenderId: uid, outcome: "skipped" });
        return null;
      }
      const cached = await sessionStore().lookup(uid);
      if (cached) {
        if (await probeSession(apiKey, cached.sessionId) === "alive") {
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
    }
  };
}

// src/session-cache.ts
var STORE_NAMESPACE = "composio-tool-router-sessions";
var MAX_ENTRIES = 1e4;
function createInMemorySessionCache() {
  const entries = new Map;
  const isLive = (entry, nowMs) => entry.expiresAt === undefined || entry.expiresAt > nowMs;
  return {
    async register(key, value, opts) {
      if (entries.size >= MAX_ENTRIES && !entries.has(key)) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
          entries.delete(oldest);
        }
      }
      entries.set(key, {
        value,
        ...opts?.ttlMs ? { expiresAt: Date.now() + opts.ttlMs } : {}
      });
    },
    async lookup(key) {
      const entry = entries.get(key);
      if (!entry) {
        return;
      }
      if (!isLive(entry, Date.now())) {
        entries.delete(key);
        return;
      }
      return entry.value;
    },
    async delete(key) {
      return entries.delete(key);
    }
  };
}
function openSessionCache(openKeyedStore, onFallback) {
  try {
    return openKeyedStore({
      namespace: STORE_NAMESPACE,
      maxEntries: MAX_ENTRIES,
      overflowPolicy: "evict-oldest"
    });
  } catch (error) {
    onFallback?.(`composio: persistent session store unavailable (${error instanceof Error ? error.message : "unknown"}); using in-memory cache`);
    return createInMemorySessionCache();
  }
}

// index.ts
var openclaw_composio_plugin_default = definePluginEntry({
  id: "composio",
  name: "Composio Plugin",
  description: "Per-user Composio Tool Router sessions as a requester-scoped MCP server (per-user OAuth in chat)",
  register(api) {
    api.registerMcpServerConnectionResolver(createComposioConnectionResolver({
      getConfig: () => api.config,
      openSessionStore: () => openSessionCache((options) => api.runtime.state.openKeyedStore(options), (message) => api.logger.info(message)),
      onResolve: (event) => api.logger.debug?.(`composio: connection ${event.outcome} for sender ${event.requesterSenderId}`)
    }));
  }
});
export {
  openclaw_composio_plugin_default as default
};

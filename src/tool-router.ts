// Minimal Composio Tool Router REST client (create/retrieve per-user sessions).
import { COMPOSIO_API_BASE_URL } from "./config.js";

export type ToolRouterSession = {
  sessionId: string;
  mcpUrl: string;
};

const REQUEST_TIMEOUT_MS = 8_000;

type ToolRouterDeps = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

function requestInit(apiKey: string, body?: unknown): RequestInit {
  return {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-api-key": apiKey,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

function parseSession(payload: unknown): ToolRouterSession | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as { session_id?: unknown; mcp?: { url?: unknown } };
  const sessionId = typeof record.session_id === "string" ? record.session_id : undefined;
  const mcpUrl = typeof record.mcp?.url === "string" ? record.mcp.url : undefined;
  return sessionId && mcpUrl ? { sessionId, mcpUrl } : undefined;
}

/** Creates a Tool Router session bound to one end user id. */
export async function createToolRouterSession(
  apiKey: string,
  userId: string,
  deps: ToolRouterDeps = {},
): Promise<ToolRouterSession | undefined> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl ?? COMPOSIO_API_BASE_URL;
  const response = await fetchImpl(
    `${base}/api/v3.1/tool_router/session`,
    requestInit(apiKey, { user_id: userId }),
  );
  if (!response.ok) {
    throw new Error(`Composio tool-router session create failed (${response.status})`);
  }
  return parseSession(await response.json());
}

/**
 * Liveness probe for a cached session. Only existence matters — the cached MCP
 * URL stays authoritative — so no response-shape assumptions beyond the status.
 */
export async function probeToolRouterSession(
  apiKey: string,
  sessionId: string,
  deps: ToolRouterDeps = {},
): Promise<"alive" | "missing"> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl ?? COMPOSIO_API_BASE_URL;
  const response = await fetchImpl(
    `${base}/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}`,
    requestInit(apiKey),
  );
  if (response.status === 404 || response.status === 410) {
    return "missing";
  }
  if (!response.ok) {
    throw new Error(`Composio tool-router session probe failed (${response.status})`);
  }
  return "alive";
}

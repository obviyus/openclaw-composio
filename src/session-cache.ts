// Session cache abstraction. The persistent keyed store is only available to
// trusted (bundled/official-installed) plugins; when it is not, fall back to a
// bounded in-memory cache. Sessions are routing containers — losing the cache
// only costs a re-mint, never a user re-auth — so the fallback is safe.
import type { ToolRouterSession } from "./tool-router.js";

export type SessionCache = {
  register(key: string, value: ToolRouterSession, opts?: { ttlMs?: number }): Promise<void>;
  lookup(key: string): Promise<ToolRouterSession | undefined>;
  delete(key: string): Promise<boolean>;
};

type OpenKeyedStore = (options: {
  namespace: string;
  maxEntries: number;
  overflowPolicy?: "evict-oldest" | "reject-new";
}) => SessionCache;

const STORE_NAMESPACE = "composio-tool-router-sessions";
const MAX_ENTRIES = 10_000;

function createInMemorySessionCache(): SessionCache {
  const entries = new Map<string, { value: ToolRouterSession; expiresAt?: number }>();
  const isLive = (entry: { expiresAt?: number }, nowMs: number) =>
    entry.expiresAt === undefined || entry.expiresAt > nowMs;
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
        ...(opts?.ttlMs ? { expiresAt: Date.now() + opts.ttlMs } : {}),
      });
    },
    async lookup(key) {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      if (!isLive(entry, Date.now())) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    async delete(key) {
      return entries.delete(key);
    },
  };
}

/**
 * Opens the persistent keyed store when the host grants it; otherwise degrades
 * to an in-memory cache and invokes onFallback once for an ops signal.
 */
export function openSessionCache(
  openKeyedStore: OpenKeyedStore,
  onFallback?: (message: string) => void,
): SessionCache {
  try {
    return openKeyedStore({
      namespace: STORE_NAMESPACE,
      maxEntries: MAX_ENTRIES,
      overflowPolicy: "evict-oldest",
    });
  } catch (error) {
    onFallback?.(
      `composio: persistent session store unavailable (${error instanceof Error ? error.message : "unknown"}); using in-memory cache`,
    );
    return createInMemorySessionCache();
  }
}

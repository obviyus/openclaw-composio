// Composio plugin entrypoint: registers the requester-scoped MCP connection resolver.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createComposioFileResultMiddleware } from "./src/file-results.js";
import { createComposioConnectionResolver } from "./src/resolver.js";
import { openSessionCache } from "./src/session-cache.js";

export default definePluginEntry({
  id: "composio",
  name: "Composio Plugin",
  description:
    "Per-user Composio Tool Router sessions as a requester-scoped MCP server (per-user OAuth in chat)",
  register(api) {
    let cache: ReturnType<typeof openSessionCache> | undefined;
    let stopped = false;
    const pending = new Set<Promise<unknown>>();
    api.registerService({
      id: "composio-session-cache",
      start() {
        stopped = false;
      },
      async stop() {
        stopped = true;
        await Promise.allSettled(pending);
        cache?.close();
        cache = undefined;
      },
    });
    api.registerAgentToolResultMiddleware(
      createComposioFileResultMiddleware({
        onSaveFailure: () => api.logger.warn("composio: failed to save MCP file result"),
      }),
      { runtimes: ["openclaw", "codex"] },
    );
    const resolver = createComposioConnectionResolver({
      getConfig: () => api.config,
      openSessionStore: () => (cache ??= openSessionCache(api.runtime.state.resolveStateDir())),
      onResolve: (event) =>
        api.logger.debug?.(
          `composio: connection ${event.outcome} for sender ${event.requesterSenderId}`,
        ),
    });
    api.registerMcpServerConnectionResolver({
      serverName: resolver.serverName,
      async resolve(ctx) {
        if (stopped) return null;
        const operation = resolver.resolve(ctx);
        pending.add(operation);
        try {
          const connection = await operation;
          return stopped ? null : connection;
        } finally {
          pending.delete(operation);
        }
      },
    });
  },
});

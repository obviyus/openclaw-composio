// Composio plugin entrypoint: registers the requester-scoped MCP connection resolver.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createComposioConnectionResolver } from "./src/resolver.js";
import { openSessionCache } from "./src/session-cache.js";

export default definePluginEntry({
  id: "composio",
  name: "Composio Plugin",
  description:
    "Per-user Composio Tool Router sessions as a requester-scoped MCP server (per-user OAuth in chat)",
  register(api) {
    api.registerMcpServerConnectionResolver(
      createComposioConnectionResolver({
        getConfig: () => api.config,
        openSessionStore: () =>
          openSessionCache(
            (options) => api.runtime.state.openKeyedStore(options),
            (message) => api.logger.info(message),
          ),
        onResolve: (event) =>
          api.logger.debug?.(
            `composio: connection ${event.outcome} for sender ${event.requesterSenderId}`,
          ),
      }),
    );
  },
});

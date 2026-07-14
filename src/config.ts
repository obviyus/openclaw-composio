// Composio plugin config resolution (org API key; per-user auth stays in Composio).
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  normalizeResolvedSecretInputString,
  normalizeSecretInput,
} from "openclaw/plugin-sdk/secret-input";

export const COMPOSIO_API_BASE_URL = "https://backend.composio.dev";
export const COMPOSIO_CREDENTIAL_PATH = "plugins.entries.composio.config.apiKey";
export const COMPOSIO_MCP_SERVER_NAME = "composio";

type PluginEntryConfig = {
  apiKey?: unknown;
};

export function resolveComposioApiKey(cfg?: OpenClawConfig): string | undefined {
  const pluginConfig = cfg?.plugins?.entries?.composio?.config as PluginEntryConfig | undefined;
  return (
    normalizeSecretInput(
      normalizeResolvedSecretInputString({
        value: pluginConfig?.apiKey,
        path: COMPOSIO_CREDENTIAL_PATH,
      }),
    ) ||
    normalizeSecretInput(process.env.COMPOSIO_API_KEY) ||
    undefined
  );
}

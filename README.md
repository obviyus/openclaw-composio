# OpenClaw Composio Plugin

Give every user in a shared channel their **own** authenticated tools (Gmail,
Outlook, Notion, GitHub, Sentry, …) through [Composio](https://composio.dev)'s
Tool Router — with per-user OAuth handled entirely in chat.

Each trusted message sender gets a dedicated Composio Tool Router session,
delivered to the agent as a requester-scoped MCP server. One user's connected
accounts are never reachable from another user's turns; runs without a verified
sender (cron, subagents, heartbeats) get no Composio tools at all.

> Community plugin — not an official `@openclaw/*` package. Published to ClawHub
> under the `obviyus` owner scope.

## Install (workspace admin, one time)

```sh
openclaw plugins install clawhub:@obviyus/composio
```

For local development, side-load instead: point `plugins.load.paths` at a clone
of this repo and enable `composio`.

Then provide your org-level Composio API key (from the
   [Composio dashboard](https://app.composio.dev)) either as the
   `COMPOSIO_API_KEY` environment variable or in config:

```jsonc
{
  "plugins": {
    "entries": {
      "composio": { "enabled": true, "config": { "apiKey": "ak_..." } }
    }
  },
  "mcp": {
    "servers": {
      // Identity declaration; the connection is resolved per user at run time.
      "composio": { "transport": "streamable-http", "url": "https://composio.invalid/unresolved" }
    }
  }
}
```

## Usage (end users, zero config)

Ask the agent for anything Composio can reach: "check my Gmail", "what's in my
Sentry queue?". On first use the agent replies with a personal OAuth link;
after connecting, the tools work — bound to that user only. Disconnecting an
account (Composio dashboard or in chat) takes effect within about five minutes.

## Notes

- The org API key never reaches end users or chat; per-user credentials live in
  Composio and never touch OpenClaw config, logs, or transcripts.
- Requires an OpenClaw release with requester-scoped MCP connections
  (`registerMcpServerConnectionResolver`).
- Per-user sessions persist across restarts only when the host grants the plugin
  keyed store (bundled or trusted-official install). Side-loaded, it falls back
  to an in-memory cache — sessions re-mint on restart, users never re-auth.

## Development & release

Source lives in `index.ts` + `src/`. Tests are colocated (`*.test.ts`).
`dist/` is build output — gitignored; the npm `files` whitelist ships it in the
published artifact. ClawHub requires that compiled output (raw `.ts` is
rejected) with `openclaw/*` imports left external (the host provides the plugin
SDK at runtime).

**Releasing is a tag push.** Bump the version, tag, push — GitHub Actions
(`.github/workflows/publish.yml`) builds `dist/` and publishes to ClawHub:

```sh
# bump "version" in package.json, commit
git tag v0.1.2 && git push origin v0.1.2
```

One-time setup: add a `CLAWHUB_TOKEN` repo secret (a ClawHub API token —
generate one in ClawHub settings, or `clawhub token` prints your current one):

```sh
gh secret set CLAWHUB_TOKEN --repo obviyus/openclaw-composio
```

To publish by hand instead (also builds locally):

```sh
bun build ./index.ts --outdir ./dist --target node --format esm --external 'openclaw/*'
clawhub package publish . --source-repo obviyus/openclaw-composio --source-commit "$(git rev-parse HEAD)" --dry-run
clawhub package publish . --source-repo obviyus/openclaw-composio --source-commit "$(git rev-parse HEAD)"
```

Notes for maintainers:

- `openclaw.compat.pluginApi` gates the minimum host version — keep it at the
  first OpenClaw release that shipped `registerMcpServerConnectionResolver`.
- `openclaw.build.openclawVersion` and the compiled `dist/` are required by
  ClawHub publish validation.
- The Composio Tool Router API is versioned (`/api/v3.1/...`); watch for
  breaking changes in `src/tool-router.ts` when Composio bumps it.

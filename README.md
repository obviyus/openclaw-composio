# OpenClaw Composio Plugin

Give every user in a shared channel their **own** authenticated tools (Gmail,
Outlook, Notion, GitHub, Sentry, …) through [Composio](https://composio.dev)'s
Tool Router — with per-user OAuth handled entirely in chat.

Each trusted message sender gets a dedicated Composio Tool Router session,
delivered to the agent as a requester-scoped MCP server. One user's connected
accounts are never reachable from another user's turns; runs without a verified
sender (cron, subagents, heartbeats) get no Composio tools at all.

> Community plugin — not an official `@openclaw/*` package. Side-load it (a
> directory in `plugins.load.paths`) or publish it to ClawHub under your own
> owner scope.

## Setup (workspace admin, one time)

1. Point `plugins.load.paths` at this directory and enable `composio`.
2. Provide your org-level Composio API key (from the
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

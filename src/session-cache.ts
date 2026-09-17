import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
  openNodeSqliteDatabase,
  runSqliteImmediateTransactionSync,
  type Generated,
} from "openclaw/plugin-sdk/sqlite-runtime";
import type { ToolRouterSession } from "./tool-router.js";

export type SessionCache = {
  register(key: string, value: ToolRouterSession, opts?: { ttlMs?: number }): Promise<void>;
  lookup(key: string): Promise<ToolRouterSession | undefined>;
  delete(key: string): Promise<boolean>;
  close(): void;
};

type SessionDatabase = {
  sessions: {
    sequence: Generated<number>;
    sender: string;
    session_id: string;
    mcp_url: string;
    expires_at: number | null;
  };
};

const MAX_ENTRIES = 10_000;

export function openSessionCache(stateDir: string): SessionCache {
  const directory = path.join(stateDir, "plugins", "composio");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, "sessions.sqlite");
  const db = openNodeSqliteDatabase(filename);
  try {
    chmodSync(filename, 0o600);
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    mcp_url TEXT NOT NULL,
    expires_at INTEGER
  ) STRICT`);
  } catch (error) {
    db.close();
    throw error;
  }
  const sql = getNodeSqliteKysely<SessionDatabase>(db);
  const find = (sender: string) =>
    executeSqliteQueryTakeFirstSync(
      db,
      sql.selectFrom("sessions").selectAll().where("sender", "=", sender),
    );
  const remove = (sender: string) =>
    executeSqliteQuerySync(db, sql.deleteFrom("sessions").where("sender", "=", sender))
      .numAffectedRows !== 0n;
  return {
    async register(sender, value, opts) {
      runSqliteImmediateTransactionSync(db, () => {
        if (!find(sender)) {
          const count = executeSqliteQueryTakeFirstSync(
            db,
            sql.selectFrom("sessions").select(sql.fn.countAll<number>().as("count")),
          )!;
          if (count.count >= MAX_ENTRIES) {
            executeSqliteQuerySync(
              db,
              sql
                .deleteFrom("sessions")
                .where(
                  "sequence",
                  "in",
                  sql.selectFrom("sessions").select("sequence").orderBy("sequence").limit(1),
                ),
            );
          }
        }
        const fields = {
          session_id: value.sessionId,
          mcp_url: value.mcpUrl,
          expires_at: opts?.ttlMs ? Date.now() + opts.ttlMs : null,
        };
        executeSqliteQuerySync(
          db,
          sql
            .insertInto("sessions")
            .values({ sender, ...fields })
            .onConflict((conflict) => conflict.column("sender").doUpdateSet(fields)),
        );
      });
    },
    async lookup(sender) {
      return runSqliteImmediateTransactionSync(db, () => {
        const row = find(sender);
        if (!row) return undefined;
        if (row.expires_at !== null && row.expires_at <= Date.now()) {
          remove(sender);
          return undefined;
        }
        return { sessionId: row.session_id, mcpUrl: row.mcp_url };
      });
    },
    async delete(sender) {
      return remove(sender);
    },
    close() {
      db.close();
    },
  };
}

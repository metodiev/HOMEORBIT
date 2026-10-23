import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./schema";

export type Db = Database.Database;

type DbGlobal = {
  db: Db | null;
  path: string | null;
};

const globalForDb = globalThis as unknown as { __homeorbitDb?: DbGlobal };

function store(): DbGlobal {
  if (!globalForDb.__homeorbitDb) globalForDb.__homeorbitDb = { db: null, path: null };
  return globalForDb.__homeorbitDb;
}

export function defaultDbPath(): string {
  return process.env.HOMEORBIT_DB_PATH
    ? path.resolve(process.env.HOMEORBIT_DB_PATH)
    : path.join(process.cwd(), "data", "homeorbit.db");
}

function open(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => (row as { id: number }).id),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      );
    });
    apply();
  }
}

export function getDb(): Db {
  const state = store();
  const dbPath = defaultDbPath();
  if (!state.db || state.path !== dbPath) {
    state.db?.close();
    state.db = open(dbPath);
    state.path = dbPath;
  }
  return state.db;
}

/** Test helper: drops the cached handle so the next getDb() re-opens the configured path. */
export function resetDbCache(): void {
  const state = store();
  try {
    state.db?.close();
  } catch {
    // already closed
  }
  state.db = null;
  state.path = null;
}

export function newDatabase(dbPath: string): Db {
  return open(dbPath);
}

export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

export function all<T>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}

export function get<T>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): Database.RunResult {
  return getDb().prepare(sql).run(...(params as never[]));
}

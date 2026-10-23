import { get, run } from "@/lib/db";
import { nowIso } from "@/lib/util/ids";
import { ValidationError } from "@/lib/errors";

/**
 * Small fixed-window limiter backed by SQLite. Good enough for a single-node
 * family deployment; swap for a shared store when scaling horizontally.
 */
export function checkRateLimit(key: string, limit: number, windowSeconds: number): void {
  const now = Date.now();
  const row = get<{ key: string; window_start: string; count: number }>(
    "SELECT * FROM rate_limits WHERE key = ?",
    [key],
  );
  if (!row) {
    run("INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)", [key, nowIso()]);
    return;
  }
  const windowStart = new Date(row.window_start).getTime();
  if (now - windowStart > windowSeconds * 1000) {
    run("UPDATE rate_limits SET window_start = ?, count = 1 WHERE key = ?", [nowIso(), key]);
    return;
  }
  if (row.count >= limit) {
    throw new ValidationError("Too many attempts. Please wait a moment and try again.");
  }
  run("UPDATE rate_limits SET count = count + 1 WHERE key = ?", [key]);
}

export function resetRateLimit(key: string): void {
  run("DELETE FROM rate_limits WHERE key = ?", [key]);
}

import "server-only";
import { sql } from "drizzle-orm";
import { db, hasDb } from "./db";

/* THE LINE FOR THE FREE MODELS.
 *
 * GPT and Gemini run on Vercel AI Gateway's free tier. Measured on day 12:
 *   - the limit is 5 calls in any rolling 5 minutes, shared by every model on
 *     the team. Five calls 30 s apart went through and the sixth was refused;
 *     a later burst of five into a window holding one call gave exactly four
 *     200s and one 429;
 *   - it is team-wide: models the team had never called were refused too.
 *
 * A reading makes two gateway calls, so the site can start two new readings
 * every five minutes. The turns are handed out by take_gateway_turn() in
 * sql/pacer.sql, one row locked for every instance, with a limit of 4 — one
 * short of what was measured, as margin. A turn is taken BEFORE any model is
 * called: a reading that cannot get GPT and Gemini costs nothing, Claude
 * included. */
const CALLS_PER_READING = 2;
const LIMIT = 4;
const WINDOW_MS = 305_000;
export const MAX_WAIT_MS = 40_000;

export type Turn = { ok: true; waitMs: number } | { ok: false; retryMs: number };

let memo: number[] = []; // no database: one process, same rule

export async function takeTurn(): Promise<Turn> {
  if (!hasDb()) {
    const now = Date.now();
    memo = memo.filter((t) => t > now - WINDOW_MS).sort((a, b) => b - a);
    const k = LIMIT - CALLS_PER_READING;
    let start = Math.max(now, memo[0] ?? 0);
    if (memo.length > k) start = Math.max(start, memo[k] + WINDOW_MS);
    if (start - now > MAX_WAIT_MS) return { ok: false, retryMs: start - now };
    memo.push(...Array(CALLS_PER_READING).fill(start));
    return { ok: true, waitMs: start - now };
  }
  const res = await db().execute(
    sql`select reserved, wait_ms from take_gateway_turn(${CALLS_PER_READING}, ${LIMIT}, ${WINDOW_MS}, ${MAX_WAIT_MS})`,
  );
  const row = res.rows[0] as { reserved: boolean; wait_ms: number } | undefined;
  if (!row) throw new Error("take_gateway_turn returned nothing — was sql/pacer.sql applied?");
  return row.reserved ? { ok: true, waitMs: Number(row.wait_ms) } : { ok: false, retryMs: Number(row.wait_ms) };
}

/** A 429 got through anyway: fill the window so nobody calls for five minutes. */
export async function blockGateway(): Promise<void> {
  if (!hasDb()) {
    memo.push(...Array(LIMIT).fill(Date.now()));
    return;
  }
  await db().execute(sql`select block_gateway(${LIMIT})`);
}

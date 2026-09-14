import { sql } from "drizzle-orm";
import { db, hasDb, schema } from "./db";

/* `Number("")` is 0, and `Number("abc")` is NaN — so an env var that exists
   but is empty silently sets the ceiling to zero and rejects every request
   with "come back tomorrow". The site looks broken and nothing logs. Anything
   that is not a positive number falls back to the default. */
function positive(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const IP_LIMIT = positive(process.env.IP_DAILY_LIMIT, 3);
const CEILING = positive(process.env.DAILY_GENERATION_CEILING, 2000);

/* Counters are day-scoped, so yesterday's entries are dead weight. Without
   this the map gained one entry per IP per day and never shed any. */
const memo = new Map<string, number>();
let memoDay = "";
const today = () => new Date().toISOString().slice(0, 10);

export async function ipHash(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "0.0.0.0";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + today()));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

async function bump(bucket: string): Promise<number> {
  const day = today();
  if (!hasDb()) {
    if (memoDay !== day) { memo.clear(); memoDay = day; }
    const n = (memo.get(bucket) ?? 0) + 1;
    memo.set(bucket, n);
    return n;
  }
  // One atomic statement. Two statements would race under concurrency and
  // under-count exactly when the ceiling matters most.
  const rows = await db()
    .insert(schema.events)
    .values({ bucket, day, n: 1 })
    .onConflictDoUpdate({
      target: schema.events.bucket,
      set: { n: sql`${schema.events.n} + 1` },
    })
    .returning({ n: schema.events.n });
  return rows[0]?.n ?? 1;
}

export type Gate =
  | { ok: true }
  | { ok: false; reason: "ip"; limit: number }
  | { ok: false; reason: "ceiling" };

/**
 * Call BEFORE any generation. Two layers:
 *  - per IP per day, so one person cannot drain the budget
 *  - a global daily ceiling, so a front-page day cannot become a surprise bill
 *
 * Past the ceiling the site serves cache only. Build that state now - you will
 * not have time to design it on a viral day.
 */
export async function checkGate(req: Request): Promise<Gate> {
  const day = today();
  const total = await bump(`gen:${day}`);
  if (total > CEILING) return { ok: false, reason: "ceiling" };
  const h = await ipHash(req);
  const mine = await bump(`gen:${day}:${h}`);
  if (mine > IP_LIMIT) return { ok: false, reason: "ip", limit: IP_LIMIT };
  return { ok: true };
}

/** Honeypot plus a minimum time-on-form. Cheap, no captcha, no third party. */
export function looksLikeBot(form: { trap?: string; startedAt?: number }) {
  if (form.trap) return true;
  if (form.startedAt && Date.now() - form.startedAt < 2000) return true;
  return false;
}

/** Give back the go a request was charged, when it produced nothing.
 *
 *  An incomplete reading — one model busy or down — used to cost the visitor
 *  one of their three. Three provider hiccups in a row and the day was over
 *  with nothing to show for it. The counters only ever go down to zero.
 *
 *  Only the visitor's own bucket is refunded. The site-wide ceiling stays
 *  charged: the models that DID answer were paid for, so a gateway outage
 *  must not turn into unlimited spend on the one provider that still works. */
export async function refundGate(req: Request): Promise<void> {
  const day = today();
  const h = await ipHash(req);
  for (const bucket of [`gen:${day}:${h}`]) {
    if (!hasDb()) {
      memo.set(bucket, Math.max(0, (memo.get(bucket) ?? 0) - 1));
      continue;
    }
    await db()
      .update(schema.events)
      .set({ n: sql`greatest(${schema.events.n} - 1, 0)` })
      .where(sql`${schema.events.bucket} = ${bucket}`);
  }
}

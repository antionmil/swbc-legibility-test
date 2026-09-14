import { eq, lt } from "drizzle-orm";
import { db, hasDb, schema } from "./db";

/* In-memory fallback used when there is no database. It had NO eviction:
   every key ever computed stayed forever, so a long-running process grew
   without bound. Expired entries are now dropped on access, and the map is
   capped so a pathological key space cannot exhaust the heap. */
const MEM_MAX = 500;
const mem = new Map<string, { v: unknown; exp: number }>();

function memSet(key: string, v: unknown, exp: number) {
  const now = Date.now();
  for (const [k, e] of mem) if (e.exp <= now) mem.delete(k);
  while (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value as string);
  mem.set(key, { v, exp });
}

function memGet(key: string) {
  const hit = mem.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) { mem.delete(key); return null; }
  return hit;
}

/**
 * The function that makes "no LLM in the request path" true rather than
 * aspirational. Wrap every expensive call in it.
 *
 *   const data = await getOrCompute(`teardown:${urlHash}`, 86400, () => run(url));
 *
 * Falls back to an in-process map when there is no database, so local work
 * before Neon is provisioned still behaves the same way.
 */
export async function getOrCompute<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();

  if (!hasDb()) {
    const hit = memGet(key);
    if (hit) return hit.v as T;
    const v = await fn();
    memSet(key, v, now + ttlSeconds * 1000);
    return v;
  }

  const d = db();
  const rows = await d.select().from(schema.cache).where(eq(schema.cache.key, key)).limit(1);
  const row = rows[0];
  if (row && row.expires_at.getTime() > now) return row.value as T;

  const value = await fn();
  const expires_at = new Date(now + ttlSeconds * 1000);
  await d.insert(schema.cache).values({ key, value: value as object, expires_at })
    .onConflictDoUpdate({ target: schema.cache.key, set: { value: value as object, expires_at } });
  return value;
}

/** Read-only cache peek. Use on the read path when the ceiling is hit: serve
 *  what exists, never compute. */
export async function peek<T>(key: string): Promise<T | null> {
  if (!hasDb()) {
    return (memGet(key)?.v as T) ?? null;
  }
  const rows = await db().select().from(schema.cache).where(eq(schema.cache.key, key)).limit(1);
  const row = rows[0];
  return row && row.expires_at.getTime() > Date.now() ? (row.value as T) : null;
}

export async function sweepExpired() {
  if (!hasDb()) return 0;
  await db().delete(schema.cache).where(lt(schema.cache.expires_at, new Date()));
  return 1;
}

/** Stable key from arbitrary input. URL-input tools dedupe for free because
 *  everyone pastes the same famous pages. */
export async function hashKey(prefix: string, input: string) {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}:${hex.slice(0, 32)}`;
}

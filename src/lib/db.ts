import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * The connection string, under whichever name it arrived.
 *
 * Vercel's Neon integration sets several — `DATABASE_URL`, `POSTGRES_URL`,
 * `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING` — and which ones appear
 * depends on how the project was linked. Reading only `DATABASE_URL` meant a
 * correctly-connected database looked like no database at all, and the symptom
 * was an empty wall rather than an error.
 *
 * Pooled first: these run in serverless functions, where a direct connection
 * exhausts Postgres' connection slots under any real traffic.
 */
const NAMES = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
] as const;

function url(): string | undefined {
  for (const n of NAMES) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

/** Missing config is NOT fatal at import time. A build day starts by writing
 *  UI, often before the database is provisioned — a hard throw here would
 *  block that. Callers that need it get a clear error instead. */
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (_db) return _db;
  const u = url();
  if (!u) {
    throw new Error(
      `No connection string. Set one of: ${NAMES.join(", ")}.`,
    );
  }
  _db = drizzle(neon(u), { schema });
  return _db;
}

export const hasDb = () => Boolean(url());
export { schema };

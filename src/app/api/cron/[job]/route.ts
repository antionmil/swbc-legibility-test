import { NextResponse } from "next/server";
import { and, like, lt } from "drizzle-orm";
import { sweepExpired } from "@/lib/cache";
import { db, hasDb, schema } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/* Cron entry point, wired in vercel.json: /api/cron/sweep at 04:00 UTC.
 *
 * One job, two tables. Cached readings expire after a week. Rate-limit
 * buckets are named `gen:YYYY-MM-DD` and `gen:YYYY-MM-DD:<hash>`, so they
 * sort by date as plain strings; anything before yesterday can no longer
 * refuse anyone and is deleted. Yesterday is kept so a request that straddles
 * midnight UTC still finds its row. */
const JOBS: Record<string, () => Promise<unknown>> = {
  sweep: async () => ({ swept: await sweepExpired(), buckets: await sweepBuckets() }),
};

async function sweepBuckets() {
  if (!hasDb()) return 0;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const gone = await db()
    .delete(schema.events)
    .where(and(like(schema.events.bucket, "gen:%"), lt(schema.events.bucket, `gen:${yesterday}`)))
    .returning({ bucket: schema.events.bucket });
  return gone.length;
}

export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job } = await params;
  const fn = JOBS[job];
  if (!fn) return NextResponse.json({ error: `Unknown job "${job}"` }, { status: 404 });

  const started = Date.now();
  try {
    const result = await fn();
    return NextResponse.json({ ok: true, job, ms: Date.now() - started, result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, job, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

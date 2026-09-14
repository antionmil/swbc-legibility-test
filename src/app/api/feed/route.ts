import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, hasDb, schema } from "@/lib/db";

export const runtime = "nodejs";

/* The public feed: URL readings only, newest first, and ONLY the columns the
   list draws. Day 10 of this challenge spent a whole month's database egress in
   ten days on one query that read everything to render a fiftieth of it. */
export async function GET() {
  if (!hasDb()) return NextResponse.json({ items: [] });
  const items = await db()
    .select({ id: schema.readings.id, host: schema.readings.host, verdict: schema.readings.verdict, at: schema.readings.updated_at })
    .from(schema.readings)
    .orderBy(desc(schema.readings.updated_at))
    .limit(12);
  return NextResponse.json({ items }, { headers: { "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" } });
}

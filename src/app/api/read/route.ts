import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { getOrCompute, hashKey, peek } from "@/lib/cache";
import { checkGate, looksLikeBot, refundGate } from "@/lib/ratelimit";
import { db, hasDb, schema } from "@/lib/db";
import { readAll } from "@/lib/models";
import { judge, type Verdict } from "@/lib/verdict";
import { MAX_COPY, readUrl, Refused } from "@/lib/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_COPY = 80;
const TTL = 7 * 86_400;

export type Reading = {
  answers: { key: string; company: string; label: string; model: string; text: string | null; reason?: "busy" | "error" }[];
  verdict: Verdict | "incomplete";
  why: string;
  id?: string;
  host?: string;
  cached?: boolean;
};

/** Store a URL reading publicly. Pasted copy never reaches this function. */
async function publish(url: URL, r: Reading) {
  if (!hasDb()) return undefined;
  const normalised = `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  const answers = r.answers.map(({ key, label, model, text }) => ({ key, label, model, text: text ?? "" }));
  const rows = await db()
    .insert(schema.readings)
    .values({ id: randomBytes(5).toString("base64url"), url: normalised, host: url.hostname.replace(/^www\./, ""), answers, verdict: r.verdict, why: r.why })
    .onConflictDoUpdate({
      target: schema.readings.url,
      set: { answers, verdict: r.verdict, why: r.why, updated_at: sql`now()` },
    })
    .returning({ id: schema.readings.id });
  return rows[0]?.id;
}

export async function POST(req: Request) {
  let body: { copy?: string; url?: string; trap?: string; startedAt?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  if (looksLikeBot({ trap: body.trap, startedAt: body.startedAt })) {
    return NextResponse.json({ error: "That looked automated." }, { status: 400 });
  }

  /* One input or the other, never both — the privacy rules differ. */
  const pasted = (body.copy ?? "").trim();
  const rawUrl = (body.url ?? "").trim();
  if (!pasted === !rawUrl) {
    return NextResponse.json({ error: "Paste your copy, or give a web address — one of the two." }, { status: 400 });
  }

  let text: string;
  let url: URL | null = null;
  if (pasted) {
    if (pasted.length < MIN_COPY) {
      return NextResponse.json({ error: `That is ${pasted.length} characters. Paste at least the headline and the first paragraph — ${MIN_COPY} characters or more.` }, { status: 400 });
    }
    text = pasted.replace(/\s+/g, " ").slice(0, MAX_COPY);
  } else {
    try {
      const got = await readUrl(rawUrl);
      text = got.text;
      url = got.url;
    } catch (err) {
      const message = err instanceof Refused ? err.message : "That page could not be read.";
      return NextResponse.json({ error: message, reason: "url" }, { status: 422 });
    }
  }

  const key = await hashKey("reading", text);

  /* Read before? Serve it without spending one of the visitor's goes. */
  const hit = await peek<Reading>(key);
  if (hit) {
    const id = url ? await publish(url, hit) : undefined;
    return NextResponse.json({ ...hit, id, host: url?.hostname.replace(/^www\./, ""), cached: true } satisfies Reading);
  }

  const gate = await checkGate(req);
  if (!gate.ok) {
    return NextResponse.json(
      gate.reason === "ip"
        ? { error: `That is ${gate.limit} readings today from this connection. It resets at midnight UTC.`, reason: "ip" }
        : { error: "Today's budget for new readings is spent. Pages read before still come back instantly — try again tomorrow for a new one.", reason: "ceiling" },
      { status: 429 },
    );
  }

  const results = await readAll(text);
  const answers: Reading["answers"] = results.map((r) => ({
    key: r.reader.key,
    company: r.reader.company,
    label: r.reader.label,
    model: r.reader.model,
    text: r.ok ? r.text : null,
    ...(r.ok ? {} : { reason: r.reason }),
  }));

  /* A verdict from two answers is not a verdict about three. If any reader
     failed, say which and why, and do not cache or publish a partial result. */
  if (results.some((r) => !r.ok)) {
    await refundGate(req);
    return NextResponse.json({
      answers,
      verdict: "incomplete",
      why: "One of the three did not answer, so there is no verdict. Nothing was saved, and this did not count toward your three a day.",
    } satisfies Reading);
  }

  let reading: Reading;
  try {
    const { verdict, why } = await judge(answers.map((a) => a.text as string));
    reading = { answers, verdict, why };
  } catch {
    await refundGate(req);
    return NextResponse.json({ answers, verdict: "incomplete", why: "The three answered, but comparing them failed. Nothing was saved — try again." } satisfies Reading);
  }

  await getOrCompute(key, TTL, async () => reading);
  const id = url ? await publish(url, reading) : undefined;
  return NextResponse.json({ ...reading, id, host: url?.hostname.replace(/^www\./, ""), cached: false } satisfies Reading);
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, hasDb, schema } from "@/lib/db";
import { Panel } from "@/components/Panel";
import { Footer } from "@/components/Chrome";
import type { Reading } from "@/app/api/read/route";

/* A dynamic segment caches NOTHING on revalidate alone: it also needs
   generateStaticParams, even an empty one. Day 2 shipped a shared-link route
   without it and served no-store to every link for a whole day. */
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

async function load(id: string) {
  if (!hasDb() || !/^[A-Za-z0-9_-]{4,16}$/.test(id)) return null;
  const rows = await db()
    .select({ id: schema.readings.id, url: schema.readings.url, host: schema.readings.host, answers: schema.readings.answers, verdict: schema.readings.verdict, why: schema.readings.why, at: schema.readings.updated_at })
    .from(schema.readings)
    .where(eq(schema.readings.id, id))
    .limit(1);
  return rows[0] ?? null;
}

const COMPANY: Record<string, string> = { gpt: "OpenAI", gemini: "Google", claude: "Anthropic" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const r = await load((await params).id);
  if (!r) return { title: "Not found" };
  const verb: Record<string, string> = { agree: "agree on", partial: "partly agree on", disagree: "disagree on", unclear: "cannot tell" };
  const title = r.verdict === "unclear" ? `Three AIs cannot tell what ${r.host} sells` : `Three AIs ${verb[r.verdict] ?? "read"} what ${r.host} sells`;
  const og = `/api/og?id=${r.id}`;
  return { title, description: r.why, openGraph: { title, description: r.why, images: [{ url: og, width: 1200, height: 630 }] }, twitter: { card: "summary_large_image", title, images: [og] } };
}

export default async function ReadingPage({ params }: { params: Promise<{ id: string }> }) {
  const r = await load((await params).id);
  if (!r) notFound();
  const reading: Reading = {
    answers: r.answers.map((a) => ({ ...a, company: COMPANY[a.key] ?? "", text: a.text || null })),
    verdict: r.verdict as Reading["verdict"],
    why: r.why,
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-10 px-5 py-12 sm:px-8 sm:py-16">
      <header className="flex flex-col gap-3">
        <Link href="/" className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase hover:text-ink">Legibility test</Link>
        <h1 className="font-display text-[34px] leading-[1.05] font-extrabold tracking-[-0.02em] sm:text-[46px]">
          What three AIs think <span className="text-accent">{r.host}</span> sells
        </h1>
        <p className="text-[14px] text-muted">
          Read from {r.url} on {r.at.toISOString().slice(0, 10)}. The page may have changed since.
        </p>
      </header>
      <Panel reading={reading} />
      <p className="text-[15px]">
        <Link href="/" className="font-semibold text-accent underline underline-offset-4">Test your own page</Link>
      </p>
      <Footer />
    </main>
  );
}

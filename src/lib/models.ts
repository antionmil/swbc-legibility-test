import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getVercelOidcToken } from "@vercel/oidc";

/* THE PROMPT. Byte-identical for all three models, from prep/prompts.md.
 * Any difference between what the three are asked turns their disagreement
 * into an artefact of the prompt instead of a property of the copy. */
export const PROMPT = `Here is the visible text of a landing page. In one sentence, say what this company sells and who it is for. If you cannot tell, say "I cannot tell" and name the single missing fact. Do not hedge, do not list possibilities, do not explain your reasoning. One sentence.`;

export type Reader = {
  key: "gpt" | "gemini" | "claude";
  company: string;
  label: string;
  model: string;
  via: "gateway" | "anthropic";
  /** dollars per million tokens, from the published price lists */
  rate: { in: number; out: number };
  /** the lowest thinking setting this model accepts (gateway readers only) */
  effort?: "none" | "minimal";
};

/* THREE COMPANIES, on purpose. Three sizes of one model family agree more
 * often than three families do, and a test built to find disagreement should
 * not start with a shared blind spot.
 *
 * OpenAI and Google go through Vercel AI Gateway, authenticated with the
 * project's own OIDC token — no provider accounts, no provider keys. Claude
 * goes direct, on the Anthropic key the rest of this challenge already uses. */
export const READERS: Reader[] = [
  { key: "gpt", company: "OpenAI", label: "GPT-5 mini", model: "openai/gpt-5-mini", via: "gateway", rate: { in: 0.25, out: 2 }, effort: "minimal" },
  { key: "gemini", company: "Google", label: "Gemini 2.5 Flash", model: "google/gemini-2.5-flash", via: "gateway", rate: { in: 0.3, out: 2.5 }, effort: "none" },
  { key: "claude", company: "Anthropic", label: "Claude Haiku 4.5", model: "claude-haiku-4-5", via: "anthropic", rate: { in: 1, out: 5 } },
];

export type Answer =
  | { ok: true; reader: Reader; text: string }
  | { ok: false; reader: Reader; reason: "busy" | "error" };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let anthropic: Anthropic | null = null;

function logUsage(reader: Reader, input: number, output: number) {
  const cost = (input / 1e6) * reader.rate.in + (output / 1e6) * reader.rate.out;
  console.log(`[llm] ${reader.model} in=${input} out=${output} cost=$${cost.toFixed(5)}`);
}

/** One sentence, tidied but never rewritten: quotes and runaway length only. */
function tidy(text: string) {
  const t = text.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
  return t.length > 420 ? `${t.slice(0, 417).trimEnd()}…` : t;
}

class Busy extends Error {}

async function viaGateway(reader: Reader, content: string, signal: AbortSignal) {
  const token = await getVercelOidcToken();
  const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    /* Thinking is turned all the way down, on purpose and not only for cost.
       The test is a first read: what does a stranger take away from the words
       on the page? A model that deliberates for 2,000 hidden tokens is doing
       something no visitor does. Claude Haiku 4.5 does not think by default,
       so this also keeps the three reading the page the same way.

       Measured on 14 Sept 2026, same prompt, same copy:
         Gemini 2.5 Flash, default thinking   1,928 out   $0.0055   29 s
         Gemini 2.5 Flash, effort "none"         22 out   $0.0001    1 s
         GPT-5 mini, effort "minimal"            36 out   $0.0001    1.5 s
       GPT-5 mini does not accept "none"; "minimal" is its floor.
       max_tokens stays generous so a model that ignores the setting returns a
       sentence rather than an empty answer cut off mid-thought. */
    body: JSON.stringify({ model: reader.model, max_tokens: 2000, reasoning: { effort: reader.effort ?? "minimal" }, messages: [{ role: "user", content }] }),
  });
  if (res.status === 429) throw new Busy();
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (!res.ok || !json.choices) throw new Error(json.error?.message ?? `gateway ${res.status}`);
  logUsage(reader, json.usage?.prompt_tokens ?? 0, json.usage?.completion_tokens ?? 0);
  return json.choices[0]?.message?.content ?? "";
}

async function viaAnthropic(reader: Reader, content: string, signal: AbortSignal) {
  anthropic ??= new Anthropic();
  try {
    const res = await anthropic.messages.create(
      { model: reader.model, max_tokens: 400, messages: [{ role: "user", content }] },
      { signal },
    );
    logUsage(reader, res.usage.input_tokens, res.usage.output_tokens);
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new Busy();
    throw err;
  }
}

/* One reader, with a timeout and ONE retry on a rate limit. A column that says
   "busy" is better than a spinner that never ends, and far better than a
   verdict computed from two answers and presented as if it were three. */
export async function read(reader: Reader, copy: string): Promise<Answer> {
  const content = `${PROMPT}\n\n---\n${copy}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const raw = reader.via === "gateway"
        ? await viaGateway(reader, content, controller.signal)
        : await viaAnthropic(reader, content, controller.signal);
      const text = tidy(raw);
      if (!text) return { ok: false, reader, reason: "error" };
      return { ok: true, reader, text };
    } catch (err) {
      if (err instanceof Busy && attempt === 0) {
        await wait(1600);
        continue;
      }
      console.error(`[llm] ${reader.model} failed:`, err instanceof Busy ? "rate limited" : (err as Error).message);
      return { ok: false, reader, reason: err instanceof Busy ? "busy" : "error" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reader, reason: "busy" };
}

export const readAll = (copy: string) => Promise.all(READERS.map((r) => read(r, copy)));

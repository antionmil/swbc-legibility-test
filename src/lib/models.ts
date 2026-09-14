import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getVercelOidcToken } from "@vercel/oidc";
import { blockGateway, takeTurn } from "./pacer";

/* THE PROMPT. Byte-identical for every model, from prep/prompts.md.
 * Any difference between what the three are asked turns their disagreement
 * into an artefact of the prompt instead of a property of the copy. */
export const PROMPT = `Here is the visible text of a landing page. In one sentence, say what this company sells and who it is for. If you cannot tell, say "I cannot tell" and name the single missing fact. Do not hedge, do not list possibilities, do not explain your reasoning. One sentence.`;

type Route = "gateway" | "anthropic";

export type Reader = {
  key: "gpt" | "gemini" | "claude";
  company: string;
  label: string;
  model: string;
  route: Route;
  /** dollars per million tokens, Anthropic's list price. Gateway calls are
   *  covered by the team's monthly free credit and log tokens only. */
  rate?: { in: number; out: number };
};

/* THREE COMPANIES, on purpose. Three sizes of one model family agree more
 * often than three families do, and a test built to find disagreement should
 * not start with a shared blind spot.
 *
 * One model per company — this is the MVP. GPT and Gemini go through Vercel
 * AI Gateway on the project's own OIDC token, so there is no OpenAI or Google
 * key anywhere. Claude goes direct on the Anthropic key, because the gateway's
 * free tier does not serve Anthropic models.
 *
 * Tried and removed on day 12: a chain per column (Groq's and Google AI
 * Studio's free plans first, the gateway after). It needed two more accounts
 * and keys, and Google's free plan keeps what it reads. One model each is
 * simpler and was the decision. */
export const READERS: Reader[] = [
  { key: "gpt", company: "OpenAI", label: "GPT-5 mini", model: "openai/gpt-5-mini", route: "gateway" },
  { key: "gemini", company: "Google", label: "Gemini 2.5 Flash", model: "google/gemini-2.5-flash", route: "gateway" },
  { key: "claude", company: "Anthropic", label: "Claude Haiku 4.5", model: "claude-haiku-4-5", route: "anthropic", rate: { in: 1, out: 5 } },
];

export type Answer =
  | { ok: true; reader: Reader; text: string }
  | { ok: false; reader: Reader; reason: "busy" | "error" };

let anthropic: Anthropic | null = null;

function logUsage(reader: Reader, input: number, output: number) {
  const cost = reader.rate ? `cost=$${((input / 1e6) * reader.rate.in + (output / 1e6) * reader.rate.out).toFixed(5)}` : "cost=free";
  console.log(`[llm] ${reader.route}:${reader.model} in=${input} out=${output} ${cost}`);
}

/** One sentence, tidied but never rewritten: quotes and runaway length only. */
function tidy(text: string) {
  const t = text.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
  return t.length > 420 ? `${t.slice(0, 417).trimEnd()}…` : t;
}

/** Rate limited, or refused by the plan. */
class Unavailable extends Error {
  constructor(readonly busy: boolean, message: string, readonly retryAfter = 0) { super(message); }
}

/* Thinking is turned all the way down, on purpose and not only for cost.
   The test is a first read: what does a stranger take away from the words on
   the page? A model that deliberates for 2,000 hidden tokens is doing
   something no visitor does. Claude Haiku 4.5 does not think by default.

   Measured on 14 Sept 2026 through the gateway, same prompt, same copy:
     Gemini 2.5 Flash, default thinking   1,928 out   $0.0055   29 s
     Gemini 2.5 Flash, effort "none"         22 out   $0.0001    1 s
     GPT-5 mini, effort "minimal"            36 out   $0.0001    1.5 s
   Each model has its own floor: GPT-5 mini accepts "minimal", Gemini "none".
   max_tokens stays generous so a model that ignores the setting returns a
   sentence rather than an answer cut off mid-thought. */
async function viaGateway(reader: Reader, content: string, signal: AbortSignal) {
  const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${await getVercelOidcToken()}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: reader.model,
      max_tokens: 1500,
      reasoning: { effort: reader.model.startsWith("google/") ? "none" : "minimal" },
      messages: [{ role: "user", content }],
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string } | { message?: string }[];
  };
  const message = (Array.isArray(json.error) ? json.error[0]?.message : json.error?.message) ?? `${reader.route} ${res.status}`;
  // 429 rate limit; 401/402/403 a missing plan, spent allowance or model the
  // plan does not include. None of them will fix itself within this request.
  if (res.status === 429) throw new Unavailable(true, "rate limited", Number(res.headers.get("retry-after")) || 0);
  if ([401, 402, 403].includes(res.status)) throw new Unavailable(false, message.slice(0, 120));
  if (!res.ok || !json.choices) throw new Error(message.slice(0, 200));
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
    if (err instanceof Anthropic.RateLimitError) throw new Unavailable(true, "rate limited");
    throw err;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* One reader, one call, a timeout. No retry on a 429: on the gateway's free
   tier a refused call keeps the block in place, so the reader moves the whole
   line back (pacer.backOff) and says "busy" instead. A column that says busy
   is better than a spinner that never ends, and far better than a verdict
   computed from two answers and presented as if it were three. */
async function readOne(reader: Reader, content: string, waitMs = 0): Promise<Answer> {
  if (waitMs > 0) await wait(waitMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const raw = reader.route === "anthropic"
      ? await viaAnthropic(reader, content, controller.signal)
      : await viaGateway(reader, content, controller.signal);
    const text = tidy(raw);
    if (text) return { ok: true, reader, text };
    console.error(`[llm] ${reader.route}:${reader.model} returned an empty answer`);
    return { ok: false, reader, reason: "error" };
  } catch (err) {
    const busy = err instanceof Unavailable && err.busy;
    if (busy && reader.route === "gateway") await blockGateway();
    console.error(`[llm] ${reader.route}:${reader.model} failed:`, (err as Error).message);
    return { ok: false, reader, reason: busy ? "busy" : "error" };
  } finally {
    clearTimeout(timer);
  }
}

/* One turn covers the reading's two gateway calls, and it is taken BEFORE
   anything is called. No turn within the wait limit means no model is called
   at all — not even Claude — so a reading that cannot get a verdict costs
   nothing. GPT and Gemini start together at the turn; Claude starts at once. */
export async function readAll(copy: string): Promise<Answer[] | { line: number }> {
  const content = `${PROMPT}\n\n---\n${copy}`;
  const turn = await takeTurn();
  if (!turn.ok) return { line: turn.retryMs };
  return Promise.all(READERS.map((r) => readOne(r, content, r.route === "gateway" ? turn.waitMs : 0)));
}

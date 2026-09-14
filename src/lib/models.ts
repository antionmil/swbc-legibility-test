import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getVercelOidcToken } from "@vercel/oidc";

/* THE PROMPT. Byte-identical for every model, from prep/prompts.md.
 * Any difference between what the three are asked turns their disagreement
 * into an artefact of the prompt instead of a property of the copy. */
export const PROMPT = `Here is the visible text of a landing page. In one sentence, say what this company sells and who it is for. If you cannot tell, say "I cannot tell" and name the single missing fact. Do not hedge, do not list possibilities, do not explain your reasoning. One sentence.`;

type Route = "groq" | "google" | "gateway" | "anthropic";

export type Reader = {
  key: "gpt" | "gemini" | "claude";
  company: string;
  label: string;
  model: string;
  route: Route;
  /** dollars per million tokens. Only the Anthropic route is billed; the
   *  others run on free plans and log their tokens, not a cost. */
  rate?: { in: number; out: number };
};

/* THREE COMPANIES, on purpose. Three sizes of one model family agree more
 * often than three families do, and a test built to find disagreement should
 * not start with a shared blind spot.
 *
 * Each column is a CHAIN, tried in order until one answers. Nothing here is
 * paid for except Claude:
 *
 *   OpenAI   Groq free plan (gpt-oss, OpenAI's open-weight model)
 *            then Vercel AI Gateway's free tier
 *   Google   Google AI Studio free plan
 *            then Vercel AI Gateway's free tier
 *   Claude   Anthropic API, direct — about $0.001 a reading
 *
 * Why chains: day 12 launched on the gateway free tier alone, and it held for
 * about five readings. After that EVERY model on the team answered 429 for
 * many minutes — the limit is shared across models, so a pool of gateway
 * models buys nothing. Groq's and Google's free plans have their own,
 * separate daily allowances (gpt-oss-120b: 30 a minute, 1,000 a day, 200K
 * tokens a day, per Groq's published table, 14 Sept 2026).
 *
 * The column shows the model that actually answered, so a fallback is never
 * presented as the first choice. Order is most reliable first, so most
 * readings use the same model and stay comparable. */
const CHAINS: Record<Reader["key"], Reader[]> = {
  gpt: [
    { key: "gpt", company: "OpenAI", label: "GPT-OSS 120B", model: "openai/gpt-oss-120b", route: "groq" },
    { key: "gpt", company: "OpenAI", label: "GPT-OSS 20B", model: "openai/gpt-oss-20b", route: "groq" },
    { key: "gpt", company: "OpenAI", label: "GPT-5 mini", model: "openai/gpt-5-mini", route: "gateway" },
  ],
  gemini: [
    { key: "gemini", company: "Google", label: "Gemini 2.5 Flash", model: "gemini-2.5-flash", route: "google" },
    { key: "gemini", company: "Google", label: "Gemini 2.5 Flash-Lite", model: "gemini-2.5-flash-lite", route: "google" },
    { key: "gemini", company: "Google", label: "Gemini 2.5 Flash", model: "google/gemini-2.5-flash", route: "gateway" },
  ],
  claude: [
    { key: "claude", company: "Anthropic", label: "Claude Haiku 4.5", model: "claude-haiku-4-5", route: "anthropic", rate: { in: 1, out: 5 } },
  ],
};

export const READERS: Reader[] = [CHAINS.gpt[0], CHAINS.gemini[0], CHAINS.claude[0]];

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

/** Rate limited, out of allowance, or no key: try the next model in the chain. */
class Skip extends Error {
  constructor(readonly busy: boolean, message: string) { super(message); }
}

/* Thinking is turned all the way down, on purpose and not only for cost.
   The test is a first read: what does a stranger take away from the words on
   the page? A model that deliberates for 2,000 hidden tokens is doing
   something no visitor does. Claude Haiku 4.5 does not think by default.

   Measured on 14 Sept 2026 through the gateway, same prompt, same copy:
     Gemini 2.5 Flash, default thinking   1,928 out   $0.0055   29 s
     Gemini 2.5 Flash, effort "none"         22 out   $0.0001    1 s
     GPT-5 mini, effort "minimal"            36 out   $0.0001    1.5 s
   Each route spells it differently, and each model has its own floor:
   gpt-oss accepts "low" at the lowest, GPT-5 mini "minimal", Gemini "none".
   max_tokens stays generous so a model that ignores the setting returns a
   sentence rather than an answer cut off mid-thought. */
function request(reader: Reader, content: string): { url: string; token: () => Promise<string | undefined>; body: object } {
  const messages = [{ role: "user", content }];
  switch (reader.route) {
    case "groq":
      return {
        url: "https://api.groq.com/openai/v1/chat/completions",
        token: async () => process.env.GROQ_API_KEY,
        body: { model: reader.model, max_completion_tokens: 1500, reasoning_effort: "low", include_reasoning: false, messages },
      };
    case "google":
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        token: async () => process.env.GEMINI_API_KEY,
        body: { model: reader.model, max_tokens: 1500, reasoning_effort: "none", messages },
      };
    default:
      return {
        url: "https://ai-gateway.vercel.sh/v1/chat/completions",
        token: () => getVercelOidcToken(),
        body: { model: reader.model, max_tokens: 1500, reasoning: { effort: reader.model.startsWith("google/") ? "none" : "minimal" }, messages },
      };
  }
}

async function viaOpenAICompatible(reader: Reader, content: string, signal: AbortSignal) {
  const { url, token, body } = request(reader, content);
  const secret = await token().catch(() => undefined);
  if (!secret) throw new Skip(false, "no key configured");
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string } | { message?: string }[];
  };
  const message = (Array.isArray(json.error) ? json.error[0]?.message : json.error?.message) ?? `${reader.route} ${res.status}`;
  // 429 rate limit; 401/402/403 a missing plan, spent allowance or model the
  // plan does not include. None of them will fix itself within this request.
  if (res.status === 429) throw new Skip(true, "rate limited");
  if ([401, 402, 403].includes(res.status)) throw new Skip(false, message.slice(0, 120));
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
    if (err instanceof Anthropic.RateLimitError) throw new Skip(true, "rate limited");
    throw err;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* One column. Each model in the chain gets a short timeout, and the whole
   column shares a deadline that keeps the request inside the function's
   60 seconds with room left for the judge. When every link was only rate
   limited, the chain is walked once more after a pause — a free-plan minute
   limit is often clear again two seconds later. A column that says "busy" is
   better than a spinner that never ends, and far better than a verdict
   computed from two answers and presented as if it were three. */
async function readColumn(chain: Reader[], copy: string): Promise<Answer> {
  const content = `${PROMPT}\n\n---\n${copy}`;
  const deadline = Date.now() + 38_000;
  let busy = true;
  for (let pass = 0; pass < 2; pass++) {
    for (const reader of chain) {
      const left = deadline - Date.now();
      if (left < 2_000) break;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(15_000, left));
      try {
        const raw = reader.route === "anthropic"
          ? await viaAnthropic(reader, content, controller.signal)
          : await viaOpenAICompatible(reader, content, controller.signal);
        const text = tidy(raw);
        if (text) return { ok: true, reader, text };
        busy = false;
        console.error(`[llm] ${reader.route}:${reader.model} returned an empty answer`);
      } catch (err) {
        const unconfigured = err instanceof Skip && err.message === "no key configured";
        // Only a real failure ends the retry. A link with no key says nothing
        // about whether the others will clear, so it does not count.
        if (!unconfigured && !(err instanceof Skip && err.busy)) busy = false;
        if (!unconfigured) {
          console.error(`[llm] ${reader.route}:${reader.model} failed:`, (err as Error).message);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    if (!busy) break;
    await wait(2_000);
  }
  return { ok: false, reader: chain[0], reason: busy ? "busy" : "error" };
}

export const readAll = (copy: string) => Promise.all([CHAINS.gpt, CHAINS.gemini, CHAINS.claude].map((c) => readColumn(c, copy)));

import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export type Verdict = "agree" | "partial" | "disagree" | "unclear";

export const VERDICT_LABEL: Record<Verdict, string> = {
  agree: "Agree",
  partial: "Partly agree",
  disagree: "Disagree",
  unclear: "None can tell",
};

/* COMPARING THE THREE.
 *
 * A model is used for one narrow job only: to say whether three sentences
 * name the same product category and the same buyer. It sees them as A, B
 * and C with no provider names attached, so it cannot favour its own family's
 * phrasing — and it never reads the page, only the answers.
 *
 * The verdict and the sentence explaining it are then computed HERE, from
 * those yes/no facts, so the headline is auditable and never a free-text
 * opinion from the judge. */
const JUDGE = `You compare three one-sentence answers to the question "what does this company sell, and who is it for?". Labels are A, B, C.

Decide only:
- same_product: do all answers that name a product put it in the same category? Wording can differ; the category cannot.
- same_buyer: do all answers that name a buyer describe the same kind of buyer?
- cannot_tell: which labels say they cannot tell, or name no product at all.

Return ONLY minified JSON: {"same_product":boolean,"same_buyer":boolean,"cannot_tell":["A"|"B"|"C"]}`;

let client: Anthropic | null = null;

export async function judge(texts: string[]): Promise<{ verdict: Verdict; why: string }> {
  const letters = ["A", "B", "C"];
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    system: JUDGE,
    messages: [{ role: "user", content: texts.map((t, i) => `${letters[i]}: ${t}`).join("\n") }],
  });
  const raw = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  console.log(`[llm] judge claude-haiku-4-5 in=${res.usage.input_tokens} out=${res.usage.output_tokens} cost=$${((res.usage.input_tokens / 1e6) * 1 + (res.usage.output_tokens / 1e6) * 5).toFixed(5)}`);

  let flags: { same_product?: boolean; same_buyer?: boolean; cannot_tell?: string[] };
  try {
    flags = JSON.parse(raw);
  } catch {
    throw new Error("The comparison did not come back in a usable shape.");
  }

  const blind = new Set((flags.cannot_tell ?? []).filter((l) => letters.includes(l)));
  const named = texts.length - blind.size;

  if (named === 0) return { verdict: "unclear", why: "None of the three could tell what this page sells." };
  if (blind.size > 0) {
    return {
      verdict: "disagree",
      why: blind.size === 1
        ? "Two of them name a product. One could not tell what is for sale."
        : "One of them names a product. The other two could not tell what is for sale.",
    };
  }
  const product = Boolean(flags.same_product);
  const buyer = Boolean(flags.same_buyer);
  if (product && buyer) return { verdict: "agree", why: "All three describe the same product for the same buyer." };
  if (product) return { verdict: "partial", why: "They agree on what you sell, not on who it is for." };
  if (buyer) return { verdict: "partial", why: "They agree on who it is for, not on what you sell." };
  return { verdict: "disagree", why: "They describe different products for different buyers." };
}

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

Decide three things.

same_product: would a buyer see all the named products as the same kind of thing?
- TRUE when they differ only in wording, detail, or a slightly broader or narrower label for the same thing. "bookkeeping services" and "bookkeeping and accounting services" are the same. "project management software" and "a team collaboration workspace" are the same.
- FALSE only when they name different kinds of thing: a service versus software to do it yourself, a marketplace versus a tool, a course versus an agency, or unrelated categories.

same_buyer: would the same person be the buyer in all of them?
- TRUE when they differ only in detail or precision. "Shopify store owners" and "Shopify stores doing $20k to $2M a month" are the same.
- FALSE only when they name different kinds of buyer: consumers versus businesses, freelancers versus enterprise teams, developers versus marketers.

cannot_tell: the labels that say they cannot tell, or that name no product at all.

Judge categories, not wording. Most answers about the same clear page differ in wording.`;

let client: Anthropic | null = null;

export async function judge(texts: string[]): Promise<{ verdict: Verdict; why: string }> {
  const letters = ["A", "B", "C"];
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    system: JUDGE,
    messages: [{ role: "user", content: texts.map((t, i) => `${letters[i]}: ${t}`).join("\n") }],
    /* Structured output, so the reply IS the JSON. Asking for "ONLY minified
       JSON" in the prompt was not enough: on day 12 the judge wrote the JSON
       and then 120 tokens explaining it, the parse failed, and a reading where
       all three models had answered was thrown away as incomplete. */
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            same_product: { type: "boolean" },
            same_buyer: { type: "boolean" },
            cannot_tell: { type: "array", items: { type: "string", enum: ["A", "B", "C"] } },
          },
          required: ["same_product", "same_buyer", "cannot_tell"],
          additionalProperties: false,
        },
      },
    },
  });
  const raw = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  console.log(`[llm] judge claude-haiku-4-5 in=${res.usage.input_tokens} out=${res.usage.output_tokens} cost=$${((res.usage.input_tokens / 1e6) * 1 + (res.usage.output_tokens / 1e6) * 5).toFixed(5)}`);

  let flags: { same_product?: boolean; same_buyer?: boolean; cannot_tell?: string[] };
  try {
    flags = JSON.parse(raw);
  } catch {
    console.error(`[llm] judge returned unparseable output: ${raw.slice(0, 200)}`);
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

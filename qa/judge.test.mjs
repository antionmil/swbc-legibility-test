/* The judge, attacked with fixed cases. Run from the site folder:
 *   node qa/judge.test.mjs
 * Needs ANTHROPIC_API_KEY in .env.local. Costs about $0.007 a run (16 calls).
 * Reads the JUDGE prompt out of src/lib/verdict.ts, so it tests the prompt that
 * ships, not a copy of it. Day 12: the first prompt called three answers that
 * all said "bookkeeping services for Shopify stores" different products. */
import fs from "node:fs";
let wrong = 0;
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,"")]}));
const src = fs.readFileSync("src/lib/verdict.ts","utf8");
const JUDGE = src.slice(src.indexOf("const JUDGE = `")+15, src.indexOf("`;", src.indexOf("const JUDGE")));
const schema = {type:"object",properties:{same_product:{type:"boolean"},same_buyer:{type:"boolean"},cannot_tell:{type:"array",items:{type:"string",enum:["A","B","C"]}}},required:["same_product","same_buyer","cannot_tell"],additionalProperties:false};
const cases = [
 ["agree", ["They sell bookkeeping services (including reconciliation and P&L preparation) for Shopify-based e-commerce stores with monthly revenue of $20,000 to $2,000,000.","This company sells bookkeeping services for Shopify stores generating $20k to $2M a month.","This company provides bookkeeping and accounting services for Shopify store owners generating $20k to $2M in monthly revenue."]],
 ["agree", ["They sell Basecamp, a simple, reliable project management and team collaboration software for teams, companies, and organizations of all sizes.","Basecamp sells a refreshingly straightforward project management system for people, teams, companies, and non-profits worldwide.","Basecamp sells project management software for teams, companies, and non-profits of any size across all industries."]],
 ["agree", ["This company sells a collaborative workspace platform to teams who want to streamline their planning, building, and launching processes.","This company sells project management software to teams who want to streamline their workflow.","This company sells a collaborative product development workspace (software) for engineering and cross-functional teams."]],
 ["partial-product", ["They sell bookkeeping software that Shopify merchants use to do their own books.","This company sells done-for-you bookkeeping by accountants for Shopify stores.","This company sells outsourced bookkeeping services for Shopify store owners."]],
 ["partial-buyer", ["They sell an email marketing tool for solo creators and newsletter writers.","This company sells email marketing software for enterprise marketing teams.","This company sells an email marketing platform for large companies' marketing departments."]],
 ["disagree", ["They sell a website technology survey data product for web developers.","This company sells SEO consulting for small businesses.","This company sells a hosting platform for agencies."]],
 ["cannot-tell-1", ["They sell aggregated, daily-updated website technology-usage data for web developers and technical product teams.","I cannot tell because its business model is not stated.","This company sells technology stack intelligence reports to web developers and businesses."]],
 ["unclear", ["I cannot tell; the page never names a product.","I cannot tell — the missing fact is what is for sale.","I cannot tell what this company sells; the page does not say."]],
];
for (const run of [1,2]) for (const [expect, texts] of cases) {
  const r = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:"claude-haiku-4-5",max_tokens:200,system:JUDGE,messages:[{role:"user",content:texts.map((t,i)=>`${"ABC"[i]}: ${t}`).join("\n")}],output_config:{format:{type:"json_schema",schema}}})});
  const j = await r.json();
  const f = j.content ? JSON.parse(j.content[0].text) : j;
  const got = f.cannot_tell?.length === 3 ? "unclear" : f.cannot_tell?.length ? `cannot-tell-${f.cannot_tell.length}` : f.same_product && f.same_buyer ? "agree" : f.same_product ? "partial-buyer" : f.same_buyer ? "partial-product" : "disagree";
  console.log(run, expect.padEnd(16), got.padEnd(16), (got===expect ? "ok" : (wrong++, "WRONG")), JSON.stringify(f).slice(0,90), j.usage?.output_tokens);
}
console.log(wrong ? `${wrong} wrong` : "all cases judged correctly");
process.exit(wrong ? 1 : 0);

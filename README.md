# Legibility test — day 12 of 26

Paste a landing page, or give its address. Three AI models from three
different companies read the words and each says, in one sentence, what the
company sells and who it is for. If they disagree, the copy is unclear.

Live at **legibilitytest.onedaybuilt.com**.

## The one decision everything follows from

Three readers from ONE model family agree with each other more often than
three families do. A test built to find disagreement cannot start with a
shared blind spot, so the panel is deliberately mixed: one model from OpenAI,
one from Google, one from Anthropic.

The page says what this is and is not: a consistency test, not a simulation of
real visitors. It shows whether the copy says one thing or several.

## Only Claude is paid for

The brief for the build: live, and no reading may cost much. So each column is
a **chain** of models, tried in order until one answers, and every link except
Claude runs on a free plan.

| Column | Tried in order | Plan |
|---|---|---|
| OpenAI | `openai/gpt-oss-120b`, then `openai/gpt-oss-20b` on Groq | Groq free plan (`GROQ_API_KEY`) |
| | `openai/gpt-5-mini` on Vercel AI Gateway | gateway free tier (OIDC, no key) |
| Google | `gemini-2.5-flash`, then `gemini-2.5-flash-lite` on Google AI Studio | Gemini API free plan (`GEMINI_API_KEY`) |
| | `google/gemini-2.5-flash` on Vercel AI Gateway | gateway free tier |
| Anthropic | `claude-haiku-4-5` | Anthropic API, paid |

The column shows the model that actually answered, so a fallback is never
passed off as the first choice. A link with no key is skipped quietly, so the
site runs on the gateway alone until the keys are added.

**Why chains, and why not a pool of gateway models.** Day 12 launched on the
gateway free tier alone. It held for about five readings; then every model on
the team answered 429 for many minutes. That was tested, not assumed: ten
models the team had never called, one call each two seconds apart, all 429 —
the limit is shared across the team, so more gateway models buy nothing.
Groq's and Google's free plans are separate allowances. Groq publishes
gpt-oss-120b at 30 requests a minute, 1,000 a day and 200,000 tokens a day
(checked 14 September 2026). Google shows its free limits only inside AI
Studio; they were not verified from the public docs.

**The price of Google's free plan is the data.** Google's Gemini API terms say
that on unpaid services it uses what is submitted to improve its products, and
that human reviewers may read it. The paste box and the footer say so and ask
people not to paste anything confidential. Groq says it does not retain
inference data by default.

## How the verdict is made

A fourth call — `claude-haiku-4-5` again — compares the three sentences
**blind**. It sees them as A, B and C with no model names, and answers three
questions: same kind of product, same kind of buyer, and which could not tell.
The verdict itself is decided in code, not by the model:

| Judge said | Verdict |
|---|---|
| all three "cannot tell" | unclear |
| some "cannot tell" | disagree |
| same product AND same buyer | agree |
| one of the two | partial |
| neither | disagree |

The judge answers through Anthropic's structured output (`output_config` with
a JSON schema). Asking for "only JSON" in the prompt was not enough: it wrote
the JSON and then explained it, the parse failed, and a reading where all three
models had answered was thrown away. The first prompt was also too strict — it
called "bookkeeping services" and "bookkeeping and accounting services"
different products. The prompt now says to judge categories, not wording, and
`qa/judge.test.mjs` holds eight fixed cases (agree, each kind of partial,
disagree, one cannot tell, none can tell). It passed 16 of 16 over two runs.

```
node qa/judge.test.mjs    # about $0.007
```

If any reader fails — every link busy, timed out or errored — there is no
verdict. The page says "incomplete", nothing is cached or published, and the go
is handed back (see below).

## Thinking is turned all the way down

The test is a first read. A model that deliberates for two thousand hidden
tokens is doing something no visitor does, and it is also where the money and
the wait went. Claude Haiku 4.5 does not think by default, so the floor setting
keeps the three reading the same way. Each model has its own floor: gpt-oss
accepts `low`, GPT-5 mini `minimal`, Gemini `none`.

Measured on 14 September 2026 through the gateway, same prompt, same copy:

| Setting | Output tokens | Cost | Wait |
|---|---|---|---|
| Gemini 2.5 Flash, default thinking | 1,928 | $0.0055 | 29 s |
| Gemini 2.5 Flash, `effort: "none"` | 22 | $0.0001 | 1 s |
| GPT-5 mini, `effort: "minimal"` | 36 | $0.0001 | 1.5 s |

## What a reading costs

Every call logs its tokens, and the paid ones their cost — grep the function
logs for `[llm]`. Measured in production on 14 September 2026, when GPT and
Gemini still went through the gateway (their share was covered by its free
monthly credit):

| Input | Claude | Judge | Paid per reading | Wait |
|---|---|---|---|---|
| a pasted paragraph | $0.00035 | $0.00040 | **$0.0008** | 4 s |
| basecamp.com, ~1,400 tokens of page | $0.00160 | $0.00044 | **$0.0020** | 3 s |

Pages are now cut to 4,000 characters instead of 6,000 (the top of the page is
where a stranger decides what is sold, and the free plans budget tokens), so a
full page should come in nearer $0.0015. That figure is computed, not yet
measured. At the ceiling of 300 new readings a day, the worst case is about
$0.60 a day. An incomplete reading still pays for Claude if Claude answered,
which is why the ceiling is not refunded (below).

## What a visitor gets, and what stops abuse

- **3 readings per connection per day**, and a site-wide ceiling
  (`DAILY_GENERATION_CEILING`). Both are counted with one atomic
  `INSERT … ON CONFLICT` on the `events` table, so every serverless instance
  shares the same count. The visitor's own counter is checked first, and only
  a request that passes it touches the site-wide one. The first version did it
  the other way round, and the production test caught it: four refused
  requests moved the ceiling from 13 to 17, so one connection looping on a 429
  could have locked out every visitor for the day. Tested by attempting it,
  both locally and on the live site: over the limit, 429 and the ceiling does
  not move; over the ceiling, 429 and the visitor's go is handed back. A
  forged `x-forwarded-for` does not help on Vercel — no new counter appeared
  for the forged addresses, because Vercel replaces the header.
- **An incomplete reading gives the visitor's go back.** Without that, three
  provider hiccups in a row ended someone's day with nothing to show. Only the
  visitor's own counter is refunded. The site-wide ceiling stays charged,
  because the models that did answer were paid for, and a gateway outage must
  not become unlimited spend on the one provider still working.
- **The same text is never read twice in a week.** The cache key is a SHA-256
  of the normalised copy; a hit costs nothing and does not spend a go.
- A honeypot field and a minimum time on the form.

## Reading an address safely

Fetching a URL a stranger typed is a server-side request forgery risk, so
`src/lib/extract.ts` refuses before it fetches:

- http and https only, default ports only, no credentials in the URL;
- **every** DNS answer must be a public address (`src/lib/address.ts`);
- redirects are followed by hand, at most 4, and each hop is checked again;
- 8-second timeout, 1.5 MB cap, `text/html` only; the text is cut to 4,000 characters.

IPv6 is checked on the fully expanded address, not by regex. The first version
used a regex and `[::ffff:127.0.0.1]` walked past it, because Node rewrites it
to `::ffff:7f00:1` before the check ran. Mapped, compatible, NAT64, 6to4,
unique-local, link-local, documentation and multicast ranges are all refused.
`qa/address.test.mjs` holds the cases:

```
node qa/address.test.mjs
```

**Known residual risk:** DNS rebinding. The address is resolved for the check
and again by `fetch`; an attacker's DNS could answer differently the second
time. Closing it needs a pinned-IP agent, which is not built.

A page that draws its words with JavaScript returns almost no text. Under 200
characters, the page asks for the copy to be pasted instead.

## What is stored

- **Pasted copy is never stored by this site.** Only its hash is, as a cache key. Google's free plan may keep what Gemini reads (above).
- A reading of a public address is published at `/r/<id>` and in the "recently
  read" feed: host, path, the three sentences, the verdict. One row per
  address; a new reading replaces the old one.

## Routes

| Route | Mode | Why |
|---|---|---|
| `/` | static | |
| `/r/[id]` | ISR, 1 hour | empty `generateStaticParams` + `revalidate`, so shared links cache (the day 2 lesson) |
| `/api/read` | function | the reading itself |
| `/api/feed` | function, `s-maxage=60` | |
| `/api/og` | function, `s-maxage=86400` | share card per reading |
| `/api/cron/sweep` | function, 04:00 UTC | deletes expired cached readings and rate-limit buckets older than yesterday |

## Not built, and why

Mockup A showed a box under the result: *re-read this page every month and
email me when the answer changes*. It is the one mechanic that would bring a
visitor back, and it is **not built**, because no email-sending provider is set
up for this project. It needs a sending key, a double opt-in, and an
unsubscribe link before it is honest to offer.

## Running it

```
pnpm install
vercel env pull .env.local   # brings VERCEL_OIDC_TOKEN, valid for 12 hours
pnpm db:push
pnpm dev
```

Environment: `DATABASE_URL` (Neon, Frankfurt), `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`,
`NEXT_PUBLIC_SITE_URL`, `IP_DAILY_LIMIT`, `DAILY_GENERATION_CEILING`,
`CRON_SECRET`. The gateway needs no variable in production: Vercel injects the
OIDC token into every function.

Functions are pinned to `fra1` in `vercel.json`, beside the database.

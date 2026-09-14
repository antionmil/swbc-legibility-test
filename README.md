# Legibility test — day 12 of 26

Paste a landing page, or give its address. Three AI models from three
different companies read the words and each says, in one sentence, what the
company sells and who it is for. If they disagree, the copy is unclear.

Live at **legibilitytest.onedaybuilt.com**.

## The one decision everything follows from

Three readers from ONE model family agree with each other more often than
three families do. A test built to find disagreement cannot start with a
shared blind spot, so the panel is deliberately mixed:

| Reader | Model | Route |
|---|---|---|
| OpenAI | `openai/gpt-5-mini` | Vercel AI Gateway |
| Google | `google/gemini-2.5-flash` | Vercel AI Gateway |
| Anthropic | `claude-haiku-4-5` | Anthropic API, direct |

The gateway authenticates with the Vercel project's own OIDC token
(`@vercel/oidc`), so there is no OpenAI or Google account and no provider key
anywhere. Claude goes direct on the Anthropic key, because the gateway's free
tier does not serve Anthropic models. One model per company: this is the MVP.

The page says what this is and is not: a consistency test, not a simulation of
real visitors. It shows whether the copy says one thing or several.

**Tried and removed the same day:** a chain of models per column, with
Groq's and Google AI Studio's free plans in front of the gateway. It needed
two more accounts and keys, and Google's free plan keeps and may review what
it reads. It was dropped for one model each.

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

If any reader fails — busy after its retries, timed out or errored — there is no
verdict. The page says "incomplete", nothing is cached or published, and the go
is handed back (see below).

## Thinking is turned all the way down

The test is a first read. A model that deliberates for two thousand hidden
tokens is doing something no visitor does, and it is also where the money and
the wait went. Claude Haiku 4.5 does not think by default, so the floor setting
keeps the three reading the same way. Each model has its own floor: GPT-5 mini
accepts `minimal`, Gemini `none`.

Measured on 14 September 2026 through the gateway, same prompt, same copy:

| Setting | Output tokens | Cost | Wait |
|---|---|---|---|
| Gemini 2.5 Flash, default thinking | 1,928 | $0.0055 | 29 s |
| Gemini 2.5 Flash, `effort: "none"` | 22 | $0.0001 | 1 s |
| GPT-5 mini, `effort: "minimal"` | 36 | $0.0001 | 1.5 s |

## What a reading costs

Every call logs its tokens, and Claude's calls their cost — grep the function
logs for `[llm]`. Measured in production on 14 September 2026:

| Input | Claude | GPT | Gemini | Judge | Reading | Wait |
|---|---|---|---|---|---|---|
| a pasted paragraph | $0.00035 | $0.00014 | $0.00009 | $0.00040 | **$0.0010** | 4 s |
| basecamp.com, ~1,400 tokens of page | $0.00160 | $0.00042 | $0.00052 | $0.00044 | **$0.0030** | 3 s |

Only Claude and the judge are billed to the Anthropic key. GPT and Gemini are
covered by the gateway's free monthly credit ($5), which pays for thousands of
readings at these prices. Pages are now cut to 4,000 characters instead of
6,000 (the top of the page is where a stranger decides what is sold), so a
full page should cost less than the figure above; that is computed, not yet
measured. At the ceiling of 300 new readings a day, the Anthropic bill is at
most about $0.60 a day. An incomplete reading still pays for the readers that
did answer, which is why the ceiling is not refunded (below).

## The gateway free tier is the bottleneck

The free tier is rate limited, and the limit is shared across the whole team,
not set per model. That was tested, not assumed: ten models the team had never
called, one call each two seconds apart, all 429. In a burst, GPT and Gemini
each answer once or twice, then refuse for a while. Each reader retries twice,
waiting what the gateway asks for (at most 6 seconds); after that the column
says "busy", the reading is incomplete, and the visitor's go is handed back.
Paid gateway credits remove the gateway's limits. The site does not need them
to run; it needs them to run under load.

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

- **Pasted copy is never stored.** Only its hash is, as a cache key.
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

Environment: `DATABASE_URL` (Neon, Frankfurt), `ANTHROPIC_API_KEY`,
`NEXT_PUBLIC_SITE_URL`, `IP_DAILY_LIMIT`, `DAILY_GENERATION_CEILING`,
`CRON_SECRET`. The gateway needs no variable in production: Vercel injects the
OIDC token into every function.

Functions are pinned to `fra1` in `vercel.json`, beside the database.

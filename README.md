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
tier does not serve Anthropic models.

The page says what this is and is not: a consistency test, not a simulation of
real visitors. It shows whether the copy says one thing or several.

## How the verdict is made

A fourth call — `claude-haiku-4-5` again — compares the three sentences
**blind**. It sees them as A, B and C in a fixed order with no model names, and
answers three yes/no questions as JSON: same product, same buyer, and whether
any of them could not tell. The verdict itself is decided in code, not by the
model:

| Judge said | Verdict |
|---|---|
| all three "cannot tell" | unclear |
| some "cannot tell" | disagree |
| same product AND same buyer | agree |
| one of the two | partial |
| neither | disagree |

If any reader fails — busy, timed out, errored — there is no verdict. The page
says "incomplete", nothing is cached or published, and the go is handed back
(see below).

## Thinking is turned all the way down

The test is a first read. A model that deliberates for two thousand hidden
tokens is doing something no visitor does, and it is also where the money and
the wait went. Claude Haiku 4.5 does not think by default, so the floor setting
keeps the three reading the same way.

Measured on 14 September 2026, same prompt, same copy, single calls:

| Setting | Output tokens | Cost | Wait |
|---|---|---|---|
| Gemini 2.5 Flash, default thinking | 1,928 | $0.0055 | 29 s |
| Gemini 2.5 Flash, `effort: "none"` | 22 | $0.0001 | 1 s |
| GPT-5 mini, `effort: "minimal"` | 36 | $0.0001 | 1.5 s |

GPT-5 mini does not accept `none`; `minimal` is its floor. Every call logs its
own usage and cost — grep the function logs for `[llm]`. **The cost of a whole
reading in production has not been measured yet**; replace this line with the
figure once it has.

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
- 8-second timeout, 1.5 MB cap, `text/html` only.

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

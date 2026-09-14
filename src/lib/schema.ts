import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/* Four tables, and what is NOT stored matters as much as what is.
 *
 * Pasted copy is never written down anywhere — not in `readings`, not in the
 * cache key (which is a hash), not in a log. Only readings of a public URL are
 * kept, because the page they describe is already public. The page's TEXT is
 * never stored either, only the three one-sentence answers about it. */

/** getOrCompute backing store: the answers, keyed by a SHA-256 of the text read. */
export const cache = pgTable(
  "cache",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cache_expiry_idx").on(t.expires_at)],
);

/** Rate-limit counters. `bucket` MUST be the primary key: the increment is one
 *  atomic INSERT .. ON CONFLICT DO UPDATE, and without a conflict to catch every
 *  count comes back as 1 and neither limit ever fires. */
export const events = pgTable(
  "events",
  {
    bucket: text("bucket").primaryKey(),
    n: integer("n").notNull().default(0),
    day: text("day").notNull(),
  },
  (t) => [index("events_day_idx").on(t.day)],
);

/** Public readings — URL submissions only. One row per normalised URL; a
 *  re-read replaces the answers, so the feed shows each site once. */
export const readings = pgTable(
  "readings",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull().unique(),
    host: text("host").notNull(),
    answers: jsonb("answers").$type<StoredAnswer[]>().notNull(),
    verdict: text("verdict").notNull(),
    why: text("why").notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("readings_updated_idx").on(t.updated_at)],
);

/** One row, `gateway`: the start time of every AI Gateway call in the last
 *  five minutes. The functions in sql/pacer.sql hand out turns from it, so the
 *  free tier's limit is respected by the site as a whole, not per instance. */
export const pacer = pgTable("pacer", {
  name: text("name").primaryKey(),
  calls: timestamp("calls", { withTimezone: true }).array().notNull().default(sql`'{}'`),
});

export type StoredAnswer = { key: string; label: string; model: string; text: string };

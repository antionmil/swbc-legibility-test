import type { Config } from "drizzle-kit";

/* drizzle-kit runs OUTSIDE Next, so nothing has loaded .env.local for it and
   DATABASE_URL is simply undefined — the error it gives ("url or host are
   required") does not say that. Node can load the file itself; no dotenv
   dependency needed. */
try {
  process.loadEnvFile(".env.local");
} catch {
  // Fine in CI, where the variable is already in the environment.
}

export default {
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config;

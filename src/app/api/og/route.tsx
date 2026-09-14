import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";
import { db, hasDb, schema } from "@/lib/db";

export const runtime = "nodejs";

/* THE FONT TRAP: ImageResponse needs real TTF bytes, and a modern user agent
   gets woff2 from Google, which it cannot read. Ask as an old client. */
let font: ArrayBuffer | null = null;
async function display() {
  if (font) return font;
  try {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&display=swap", { headers: { "User-Agent": "Mozilla/5.0 (compatible; SWBC/1.0)" } })).text();
    const src = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!src) return null;
    font = await (await fetch(src)).arrayBuffer();
    return font;
  } catch {
    return null;
  }
}

const PILL: Record<string, [string, string]> = {
  agree: ["AGREE", "#15803d"], partial: ["PARTLY AGREE", "#a16207"], disagree: ["DISAGREE", "#c2410c"], unclear: ["NONE CAN TELL", "#475569"],
};

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const f = await display();
  const r = id && hasDb() && /^[A-Za-z0-9_-]{4,16}$/.test(id)
    ? (await db().select({ host: schema.readings.host, verdict: schema.readings.verdict, why: schema.readings.why }).from(schema.readings).where(eq(schema.readings.id, id)).limit(1))[0]
    : null;
  const [label, colour] = r ? PILL[r.verdict] ?? ["", "#101418"] : ["", "#101418"];

  return new ImageResponse(
    (
      <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f4f6f8", color: "#101418", padding: 72, fontFamily: f ? "Display" : "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 24, color: "#5b6570", letterSpacing: 4 }}>LEGIBILITY TEST</div>
        {r ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
            <div style={{ display: "flex", fontSize: 30, color: "#374151" }}>GPT · Gemini · Claude read</div>
            <div style={{ display: "flex", fontSize: 88, lineHeight: 1 }}>{r.host}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              <div style={{ display: "flex", background: colour, color: "#fff", fontSize: 30, padding: "10px 24px", borderRadius: 999, letterSpacing: 2 }}>{label}</div>
              <div style={{ display: "flex", fontSize: 30, color: "#374151", maxWidth: 760 }}>{r.why}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", fontSize: 92, lineHeight: 1.02 }}>Do three AIs agree</div>
            <div style={{ display: "flex", fontSize: 92, lineHeight: 1.02 }}>
              on what you sell?
            </div>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#5b6570" }}>
          <div style={{ display: "flex" }}>A consistency test, not a visitor simulator</div>
          <div style={{ display: "flex" }}>legibilitytest.onedaybuilt.com</div>
        </div>
      </div>
    ),
    {
      width: 1200, height: 630,
      fonts: f ? [{ name: "Display", data: f, style: "normal", weight: 800 }] : [],
      headers: { "cache-control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800" },
    },
  );
}

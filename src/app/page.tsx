import { Reader } from "@/components/Reader";
import { Feed } from "@/components/Feed";
import { Footer } from "@/components/Chrome";

export const dynamic = "force-static";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-10 px-5 py-12 sm:px-8 sm:py-16">
      <header className="flex flex-col gap-4">
        <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Legibility test</p>
        <h1 className="font-display max-w-[18ch] text-[40px] leading-[1.02] font-extrabold tracking-[-0.03em] sm:text-[56px]">
          Do three AIs <span className="text-accent">agree</span> on what you sell?
        </h1>
        <p className="max-w-[60ch] text-[17px] leading-relaxed text-body">
          Paste your landing page. GPT, Gemini and Claude each say, in one sentence, what you sell and who it is
          for. If they disagree, your copy is unclear — and so is whatever an AI tells the next person who asks
          about you.
        </p>
      </header>

      <Reader />
      <Feed />
      <Footer />
    </main>
  );
}

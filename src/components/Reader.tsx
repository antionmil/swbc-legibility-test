"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Reading } from "@/app/api/read/route";
import { Panel } from "./Panel";

type Mode = "copy" | "url";
type State =
  | { at: "idle" }
  | { at: "working" }
  | { at: "done"; reading: Reading }
  | { at: "error"; message: string };

export function Reader() {
  const [mode, setMode] = useState<Mode>("copy");
  const [copy, setCopy] = useState("");
  const [url, setUrl] = useState("");
  const [state, setState] = useState<State>({ at: "idle" });
  const [waited, setWaited] = useState(0);
  const startedAt = useRef(Date.now());
  const trap = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.at !== "working") return;
    setWaited(0);
    const t = setInterval(() => setWaited((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state.at]);

  const ready = mode === "copy" ? copy.trim().length >= 80 : url.trim().length > 3;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || state.at === "working") return;
    setState({ at: "working" });
    try {
      const res = await fetch("/api/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(mode === "copy" ? { copy } : { url }),
          trap: trap.current?.value,
          startedAt: startedAt.current,
        }),
      });
      const json = await res.json();
      if (!res.ok) return setState({ at: "error", message: json.error ?? "Something went wrong." });
      setState({ at: "done", reading: json as Reading });
    } catch {
      setState({ at: "error", message: "The connection dropped before the answers came back." });
    }
  };

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => { setMode(m); if (state.at === "error") setState({ at: "idle" }); }}
      aria-pressed={mode === m}
      className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${mode === m ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex items-center gap-1" role="group" aria-label="What to read">
          {tab("copy", "Paste the copy")}
          {tab("url", "Or a web address")}
        </div>

        {mode === "copy" ? (
          <textarea
            value={copy}
            onChange={(e) => setCopy(e.target.value)}
            rows={6}
            maxLength={6000}
            disabled={state.at === "working"}
            aria-label="Your landing page copy"
            placeholder="Paste the headline, the line under it, and the first section of your landing page."
            className="w-full resize-y rounded-xl border border-rule bg-card p-4 text-[15px] leading-relaxed text-ink placeholder:text-muted focus:border-ink focus:outline-none disabled:opacity-60"
          />
        ) : (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={state.at === "working"}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-label="Web address"
            placeholder="yourproduct.com"
            className="w-full rounded-xl border border-rule bg-card px-4 py-3 text-[15px] text-ink placeholder:text-muted focus:border-ink focus:outline-none disabled:opacity-60"
          />
        )}
        {/* Honeypot, kept off-screen rather than display:none. */}
        <input ref={trap} name="company" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-px w-px opacity-0" />

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={!ready || state.at === "working"}
            className="rounded-xl bg-ink px-6 py-3 text-[14px] font-bold text-white transition-opacity hover:enabled:opacity-90 disabled:opacity-35"
          >
            {state.at === "working" ? "Reading…" : "Read it"}
          </button>
          <span className="text-[13px] text-muted">
            {state.at === "working"
              ? waited < 6 ? "Three models are reading it at once." : `${waited} seconds — waiting for the slowest of the three.`
              : mode === "copy"
                ? "Pasted copy is never stored or shown to anyone."
                : "Web address readings are public, so others can see what the three said."}
          </span>
        </div>

        {state.at === "error" ? <p role="alert" className="text-[14px] text-accent">{state.message}</p> : null}
      </form>

      {state.at === "done" ? (
        <div className="flex flex-col gap-4">
          <Panel reading={state.reading} />
          {state.reading.id ? (
            <p className="text-[14px] text-body">
              Public link to this reading:{" "}
              <Link href={`/r/${state.reading.id}`} className="font-semibold text-accent underline underline-offset-4">
                legibilitytest.onedaybuilt.com/r/{state.reading.id}
              </Link>
            </p>
          ) : null}
          {state.reading.cached ? (
            <p className="text-[12.5px] text-muted">This exact text was read in the last week, so the answers came from the cache.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

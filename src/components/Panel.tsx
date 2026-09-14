import type { Reading } from "@/app/api/read/route";

const PILL: Record<Reading["verdict"], { label: string; bg: string }> = {
  agree: { label: "Agree", bg: "bg-v-agree" },
  partial: { label: "Partly agree", bg: "bg-v-partial" },
  disagree: { label: "Disagree", bg: "bg-v-disagree" },
  unclear: { label: "None can tell", bg: "bg-v-unclear" },
  incomplete: { label: "Incomplete", bg: "bg-v-incomplete" },
};

export function VerdictPill({ verdict }: { verdict: Reading["verdict"] }) {
  const p = PILL[verdict];
  return (
    <span className={`${p.bg} inline-flex shrink-0 rounded-full px-3 py-1 text-[12px] font-bold tracking-[0.12em] text-white uppercase`}>
      {p.label}
    </span>
  );
}

/* The three answers, verbatim and side by side. The page never merges them,
   ranks them or scores them: the disagreement IS the result. */
export function Panel({ reading }: { reading: Reading }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="rise flex flex-wrap items-center gap-3">
        <VerdictPill verdict={reading.verdict} />
        <p className="text-[15px] text-body">{reading.why}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {reading.answers.map((a, i) => (
          <article
            key={a.key}
            className={`rise ${i === 1 ? "rise-2" : i === 2 ? "rise-3" : ""} flex flex-col gap-3 rounded-xl border border-rule bg-card p-4`}
          >
            <header className="flex flex-col gap-0.5">
              <span className="text-[14px] font-bold">
                {a.company} · {a.label}
              </span>
              <span className="font-mono text-[10.5px] text-muted">{a.model}</span>
            </header>
            {a.text ? (
              <p className="text-[15px] leading-relaxed text-body">&ldquo;{a.text}&rdquo;</p>
            ) : (
              <p className="text-[14px] leading-relaxed text-muted">
                {a.reason === "busy"
                  ? "This model was busy and did not answer. Try again in a minute."
                  : "This model did not answer. Try again in a minute."}
              </p>
            )}
          </article>
        ))}
      </div>

      <p className="text-[13px] leading-relaxed text-muted">
        A consistency test, not a simulation of your visitors. It shows whether your copy says one thing,
        or several. The same question goes to all three, word for word.
      </p>
    </section>
  );
}

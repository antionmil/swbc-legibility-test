export function Footer() {
  return (
    <footer className="flex flex-col gap-3 border-t border-rule pt-7 text-[13px] leading-relaxed text-muted">
      <p className="max-w-[64ch]">
        Three models from three companies read the same text and answer the same question, word for word:
        OpenAI&rsquo;s GPT-OSS, Google&rsquo;s Gemini and Anthropic&rsquo;s Claude Haiku 4.5. When a model is
        busy, the next one from the same company answers, and its column says which. A fourth call only
        compares the three answers, labelled A, B and C so it cannot tell whose is whose, and the verdict is
        worked out from that comparison.
      </p>
      <p className="max-w-[64ch]">
        This site stores no pasted copy. But Gemini runs on Google&rsquo;s free plan, and Google may keep what
        it reads to improve its products, and people there may review it. Do not paste anything confidential.
        Readings of a web address are public, because the page already is — only the three answers are kept,
        never the page&rsquo;s text.
      </p>
      <p>
        <a href="https://onedaybuilt.com" className="text-accent hover:underline">onedaybuilt.com</a> — one website a day, every day of September.
      </p>
    </footer>
  );
}

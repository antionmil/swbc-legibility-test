"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { VerdictPill } from "./Panel";
import type { Reading } from "@/app/api/read/route";

type Item = { id: string; host: string; verdict: Reading["verdict"]; at: string };

/* Recent public readings. Loaded after the page, so the page itself stays
   static — and it renders nothing until there is something real to show. */
export function Feed() {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    fetch("/api/feed").then((r) => r.json()).then((j) => setItems(j.items ?? [])).catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 border-t border-rule pt-8">
      <h2 className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Recently read</h2>
      <ul className="grid gap-x-8 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.id}>
            <Link href={`/r/${i.id}`} className="group flex items-center justify-between gap-4 border-b border-rule py-3">
              <span className="truncate text-[15px] font-semibold group-hover:text-accent">{i.host}</span>
              <VerdictPill verdict={i.verdict} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

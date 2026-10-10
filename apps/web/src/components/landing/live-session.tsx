"use client";

// The real session state, read from the Stockroom API. If the API is not reachable the line simply does not
// render; the landing page never depends on it.

import { useQuery } from "@tanstack/react-query";
import { api, duration, pct, sessionWord } from "@/lib/api";

export function LiveSession() {
  const session = useQuery({ queryKey: ["session"], queryFn: api.session, retry: false, refetchInterval: 60_000 });
  if (!session.data) return null;
  const s = session.data;
  const word = sessionWord(s).toLowerCase();
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-ink-soft">
      <span className={`size-2 rounded-full ${s.isOpen ? "bg-ink" : "bg-signal"}`} aria-hidden />
      <span>
        Right now the US market is <span className="font-bold text-ink">{s.isOpen ? "open" : `closed (${word})`}</span>
        {s.isOpen
          ? ". Borrows run at the base margin."
          : `. It opens in ${duration(s.nextOpen - s.now)}; short debt carries a ${pct(s.gapPremium, 1)} gap premium until then.`}
      </span>
    </p>
  );
}

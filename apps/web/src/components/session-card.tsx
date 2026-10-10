"use client";

// Where the US cash market is in its day. Stockroom exists for the hours it is shut, so this is the one status
// every screen keeps in view.

import type { Session } from "@/lib/api";
import { duration, pct, sessionWord, whenShort } from "@/lib/api";

const PHASES = [
  { key: "pre", label: "Pre-market" },
  { key: "open", label: "Open" },
  { key: "post", label: "After hours" },
  { key: "closed", label: "Closed" },
];

/** Which of the four phases the on-chain calendar's open/closed flag and the clock land on. */
function phaseOf(s: Session): string {
  if (!s.isOpen) return "closed";
  // The calendar's "open" spans US extended hours; split it by New York wall-clock time.
  const ny = new Date(s.now * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
  const [h, m] = ny.split(":").map(Number);
  const minutes = h * 60 + m;
  if (minutes < 9 * 60 + 30) return "pre";
  if (minutes < 16 * 60) return "open";
  return "post";
}

export function SessionCard({ session }: { session: Session }) {
  const phase = phaseOf(session);
  const word = session.isOpen ? (phase === "open" ? "Open" : phase === "pre" ? "Pre-market" : "After hours") : sessionWord(session);
  return (
    <section aria-label="US market session">
      <p className="text-sm text-ink-soft">US stock market</p>
      <p className="mt-1 font-heading text-[1.9rem] leading-none font-semibold tracking-[-0.4px]">{word}</p>
      <ol className="mt-4 grid grid-cols-4 gap-1" aria-hidden>
        {PHASES.map((p) => {
          const current = p.key === phase;
          return (
            <li key={p.key} className="flex flex-col gap-1.5">
              <span className={`h-1.5 rounded-full ${current ? (session.isOpen ? "bg-ink" : "bg-signal") : "bg-paper-3"}`} />
              <span className={`text-[0.7rem] ${current ? "font-bold text-ink" : "text-ink-faint"}`}>{p.label}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-sm leading-relaxed text-ink-soft">
        {session.isOpen
          ? "Prices are live, so borrows run at the base margin and the feed, the pool and the reference print stay close."
          : `Closed for ${duration(session.closedForSec)}. Opens in ${duration(session.nextOpen - session.now)}, on ${whenShort(session.nextOpen)}. Until then short debt carries a ${pct(session.gapPremium, 1)} gap premium.`}
      </p>
    </section>
  );
}

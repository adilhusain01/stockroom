"use client";

// A worked example the visitor can push around: pick a borrow rate and a lending period, see the three numbers.

import { useState } from "react";
import { signedMoney } from "@/lib/api";

const POSITION = 10_000;
const PERIODS = [
  { label: "A weekend", days: 3 },
  { label: "A week", days: 7 },
  { label: "A month", days: 30 },
  { label: "A quarter", days: 91 },
];
const LENDER_SHARE = 0.9; // the contracts pass 90 percent of the fee to lenders, 10 percent to the insurance fund

export function TryIt() {
  const [apr, setApr] = useState(12);
  const [days, setDays] = useState(3);
  const fee = (POSITION * (apr / 100) * days) / 365;
  const kept = fee * (1 - LENDER_SHARE);
  const received = fee * LENDER_SHARE;
  const scale = Math.max(1, (POSITION * 0.4 * days) / 365); // the dearest rate for the chosen period fills the bar

  return (
    <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="flex flex-col gap-8">
        <div>
          <label htmlFor="apr" className="flex items-baseline justify-between gap-4">
            <span className="text-ink-soft">Borrowers are paying</span>
            <span className="font-heading text-[2rem] leading-none font-medium tracking-[-0.4px]">{apr}% a year</span>
          </label>
          <input id="apr" type="range" min={0} max={40} step={1} value={apr} onChange={(e) => setApr(Number(e.target.value))} className="mt-4 h-8 w-full cursor-pointer accent-[var(--ink)]" />
          <div className="flex justify-between text-[0.8rem] text-ink-faint">
            <span>0%</span>
            <span>20%</span>
            <span>40%</span>
          </div>
        </div>
        <fieldset>
          <legend className="text-ink-soft">Your stock is out for</legend>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                aria-pressed={days === p.days}
                onClick={() => setDays(p.days)}
                className={`cursor-pointer rounded-lg py-3 text-sm font-bold transition-[scale,background-color,color,box-shadow] duration-150 ease-out-strong active:scale-[0.97] sm:text-base ${
                  days === p.days ? "bg-ink text-paper" : "shadow-[inset_0_0_0_1.5px_var(--line)] hover:shadow-[inset_0_0_0_1.5px_var(--ink)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="text-sm leading-relaxed text-ink-faint">An example on $10,000 of stock. The rate is whatever borrowers pay at the time, set by how much of the pool is out.</p>
      </div>

      <div className="flex flex-col justify-center gap-5" aria-live="polite">
        <Bar label="The borrower pays" value={-fee} scale={scale} tone="cost" />
        <Bar label="Insurance fund keeps" value={-kept} scale={scale} tone="fund" />
        <div className="border-t border-line pt-5">
          <Bar label="You receive" value={received} scale={scale} tone="you" large />
        </div>
        <p className="leading-relaxed text-ink-soft">
          {apr === 0
            ? "Nobody is borrowing, so nothing accrues. Your stock sits in the pool, still yours, still earning dividends."
            : `Paid in USDT, claimable any time. The dividends and splits of those ${days} days still land on you: the borrower owes the same number of tokens back.`}
        </p>
      </div>
    </div>
  );
}

function Bar({ label, value, scale, tone, large }: { label: string; value: number; scale: number; tone: "cost" | "fund" | "you"; large?: boolean }) {
  const share = Math.min(1, Math.abs(value) / scale);
  const colour = tone === "you" ? "bg-signal" : tone === "cost" ? "bg-ink" : "bg-ink-faint";
  return (
    <div className="grid grid-cols-[7rem_1fr_5.5rem] items-center gap-3 sm:grid-cols-[9rem_1fr_6.5rem]">
      <span className={large ? "font-bold" : "text-ink-soft"}>{label}</span>
      <span className="relative h-3" aria-hidden>
        <span className="absolute inset-y-[-6px] left-1/2 w-px bg-line" />
        <span className={`absolute inset-y-0 w-1/2 rounded-full transition-transform duration-200 ease-out-strong ${colour} ${value < 0 ? "right-1/2 origin-right" : "left-1/2 origin-left"}`} style={{ transform: `scaleX(${share})` }} />
      </span>
      <span className={`text-right font-mono ${large ? "text-[1.15rem] font-medium" : ""}`}>{signedMoney(value)}</span>
    </div>
  );
}

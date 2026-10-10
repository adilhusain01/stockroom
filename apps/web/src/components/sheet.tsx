// Small pieces of the Stockroom layout that several pages share.

import type { ReactNode } from "react";

/** Section heading: small, uppercase, letterspaced, in faint ink. */
export function SectionLabel({ children, action, className = "" }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between text-[0.76rem] tracking-[1.5px] text-ink-faint uppercase ${className}`}>
      <span>{children}</span>
      {action}
    </div>
  );
}

/** Stat tile: label above a bold value, on a raised paper surface. */
export function StatTile({ label, value, hint, warn }: { label: string; value: ReactNode; hint?: string; warn?: boolean }) {
  return (
    <div className="flex min-w-[90px] flex-1 flex-col gap-[5px] rounded-lg bg-paper-2 p-4 shadow-[inset_0_0_0_1.5px_var(--line)]">
      <span className="text-[0.76rem] tracking-[0.5px] text-ink-faint uppercase">{label}</span>
      <span className={`font-mono text-[1.15rem] font-medium ${warn ? "text-danger" : "text-ink"}`}>{value}</span>
      {hint && <span className="text-[0.76rem] text-ink-faint">{hint}</span>}
    </div>
  );
}

/** A hairline row: label on the left, value on the right. */
export function LineRow({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line-soft px-0.5 py-2.5 last:border-b-0">
      <span className="text-sm text-ink-soft">
        {label}
        {sub && <span className="block text-[0.76rem] text-ink-faint">{sub}</span>}
      </span>
      <span className="text-right font-mono text-sm tracking-[0.3px] text-ink">{value}</span>
    </div>
  );
}

/** The round letter mark that opens every list row. */
export function Monogram({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-11 flex-none place-items-center rounded-full bg-paper-2 font-heading text-xl font-semibold shadow-[inset_0_0_0_1.5px_var(--line)]" aria-hidden>
      {children}
    </span>
  );
}

/** Page heading used inside the app: a display title and one sentence under it. */
export function PageTitle({ title, lead, action }: { title: ReactNode; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <h1 className="font-heading text-[clamp(2rem,5vw,2.8rem)] leading-[1.04] font-semibold tracking-[-0.02em]">{title}</h1>
        {lead && <p className="mt-3 max-w-[60ch] leading-relaxed text-ink-soft">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

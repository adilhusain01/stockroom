// The one loading indicator: three bars drawing in ink on the paper.

export function Loader({ label, compact }: { label?: string; compact?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-4 text-ink ${compact ? "min-h-40" : "min-h-[45dvh]"}`}>
      <span className="flex items-end gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-1.5 animate-pulse rounded-full bg-ink" style={{ height: compact ? 14 + i * 4 : 22 + i * 6, animationDelay: `${i * 160}ms` }} />
        ))}
      </span>
      {label ? <p className="font-heading text-ink-faint">{label}</p> : <span className="sr-only">Loading</span>}
    </div>
  );
}

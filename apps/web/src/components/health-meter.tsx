// Margin used, as a share of what would trigger liquidation. The contracts liquidate at 100 percent.

import { RegimeBadgeLike } from "@/components/regime-badge";

export type HealthState = "Safe" | "Watch" | "Risk" | "Liquidatable";

export function healthState(health: number | null): HealthState {
  if (health === null) return "Safe";
  if (health >= 1.5) return "Safe";
  if (health >= 1.1) return "Watch";
  if (health >= 1) return "Risk";
  return "Liquidatable";
}

const FILL: Record<HealthState, string> = { Safe: "bg-ink", Watch: "bg-signal", Risk: "bg-signal-deep", Liquidatable: "bg-danger" };
const TONE: Record<HealthState, "ink" | "signal" | "wash" | "danger"> = { Safe: "ink", Watch: "signal", Risk: "wash", Liquidatable: "danger" };

export function HealthMeter({ health }: { health: number | null }) {
  const state = healthState(health);
  // margin used = 1 / health factor; no debt means nothing used
  const share = health === null ? 0 : Math.min(1, Math.max(0, 1 / health));
  const percent = health === null ? "0%" : `${(share * 100).toFixed(1)}%`;
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">Margin used</p>
          <p className="mt-1 font-heading text-[1.9rem] leading-none font-semibold tracking-[-0.4px]">{percent}</p>
        </div>
        <RegimeBadgeLike tone={TONE[state]}>{health === null ? "No debt" : state}</RegimeBadgeLike>
      </div>
      <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Margin used" className="mt-4 h-1.5 overflow-hidden rounded-full bg-paper-3">
        <div className={`h-full origin-left rounded-full transition-transform duration-500 ease-out-strong ${FILL[state]}`} style={{ transform: `scaleX(${Math.max(share, 0.01)})` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[0.7rem] text-ink-faint">
        <span>0%</span>
        <span>Liquidation at 100%</span>
      </div>
    </div>
  );
}

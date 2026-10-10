import { RatesBoard } from "@/components/rates-board";
import { API_URL } from "@/lib/api";

export default function RatesPage() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">The equity borrow rate on BNB Chain</h1>
        <p className="max-w-2xl text-muted-foreground">
          What it costs to borrow each bStock right now, and what lenders earn. The same numbers are published as JSON for dashboards and agents at{" "}
          <a className="underline underline-offset-4" href={`${API_URL}/rates.json`}>
            /rates.json
          </a>{" "}
          (free) and <code className="rounded-sm bg-muted px-1">/paid/rates</code> (0.01 USDT per call over B402 for agents that want the TWAP, anchor and caps too).
        </p>
      </section>
      <RatesBoard />
    </div>
  );
}

import { API_URL } from "@/lib/api";
import { DeskStatus } from "@/components/desk-status";

export default function DeskPage() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Night Desk</h1>
        <p className="max-w-2xl text-muted-foreground">
          The first borrower on Stockroom is an agent. Every Friday after the US close it borrows bStocks against USDT, provides PancakeSwap v3 liquidity while Wall Street is shut, pulls the liquidity before the Monday open, buys back any shortfall and repays. The borrow fee it pays is what lenders earn. It has an ERC-8004 identity on BNB Chain and an agent card at{" "}
          <a className="underline underline-offset-4" href={`${API_URL}/agent-card.json`}>
            /agent-card.json
          </a>
          .
        </p>
      </section>
      <DeskStatus />
      <section className="grid gap-3 sm:grid-cols-3">
        <Step n="Friday 20:00 ET" title="Borrow" body="Deposit USDT collateral, borrow NVDAB from the pool. Borrowing is allowed while the session is closed, except in the last 30 minutes before the open." />
        <Step n="Weekend" title="Provide liquidity" body="Mint a PancakeSwap v3 position two percent either side of the price. Weekend flow pays fees while the price sits near Friday's close." />
        <Step n="Monday 02:00 ET" title="Repay" body="Remove the liquidity, buy back whatever the pool took, repay the raw units in full and withdraw the collateral." />
      </section>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground tabular-nums">{n}</div>
      <div className="font-semibold">{title}</div>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

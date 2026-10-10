import { MarketsTable } from "@/components/markets-table";

export default function MarketsPage() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Lend your bStocks. Borrow someone else&apos;s.</h1>
        <p className="max-w-2xl text-muted-foreground">
          Lenders keep every dividend and earn USDT while their stock is out. Borrowers post USDT and take the stock to short, hedge or make markets while Wall Street sleeps. Pick a stock to lend or borrow it.
        </p>
      </section>
      <MarketsTable />
    </div>
  );
}

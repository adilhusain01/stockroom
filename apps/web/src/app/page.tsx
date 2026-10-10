import type { Metadata } from "next";
import Link from "next/link";
import { LendChart } from "@/components/landing/lend-chart";
import { LiveSession } from "@/components/landing/live-session";
import { TryIt } from "@/components/landing/try-it";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Stockroom: lend the tokenized stock you already hold",
  description: "Stock lending for bStocks on BNB Chain. Lend NVDAB, TSLAB and the other bStocks, earn a fee in USDT and keep every dividend. Borrow them to short, hedge or make markets while Wall Street is shut.",
};

const STEPS = [
  {
    title: "Lend what you hold",
    body: "Put a bStock such as NVDAB into its Stockroom pool and get a share token back. Dividends and splits still reach you: the borrower owes the same number of tokens, and the issuer's multiplier lands on whoever holds the shares.",
  },
  {
    title: "A borrower posts USDT and takes it",
    body: "Anyone can borrow against 150 percent collateral: to short, to hedge, or, like the Night Desk agent, to make markets on PancakeSwap while Wall Street sleeps. The fee accrues every second, in USDT.",
  },
  {
    title: "The fee is yours, the stock comes back",
    body: "Claim your USDT whenever you like. Withdraw your stock whenever the pool has it idle. A borrower who falls short gets liquidated by anyone, with no capital needed, before your stock is at risk.",
  },
];

const SAFEGUARDS = [
  { title: "Collateral first, 150 percent of it", body: "Every borrow is backed by more USDT than the stock is worth, and the first liquidation happens the moment that cushion thins, at a discount that grows until someone takes it." },
  { title: "Three prices, not one", body: "The APRO feed, the PancakeSwap average and the last Binance reference print. Debt is valued at the highest. If they disagree, nobody can open new risk until they agree again." },
  { title: "The weekend is priced in", body: "bStocks trade around the clock; New York does not. While the market is shut, debt carries a premium that grows every hour, up to 5 percent, so a Monday gap is already paid for." },
  { title: "Corporate actions pause borrows", body: "A pending dividend or split stops new borrows until it applies. Repaying, withdrawing and liquidating never stop, and no owner key can move anyone's funds." },
];

export default function LandingPage() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 sm:px-8">
      <header className="flex items-center justify-between gap-4 py-5">
        <span className="font-heading text-[1.5rem] font-semibold tracking-[-0.01em]">Stockroom</span>
        <Button nativeButton={false} render={<Link href="/app" />} variant="secondary" className="rounded-full">
          Open the app
        </Button>
      </header>

      <main>
        <section className="pt-10 pb-20 sm:pt-16">
          <h1 className="max-w-[15ch] font-heading text-[clamp(2.9rem,8.4vw,6.5rem)] leading-[0.98] font-semibold tracking-[-0.03em]">Lend the stock you already hold. Keep every dividend.</h1>
          <div className="mt-8 grid items-end gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,1fr)_auto]">
            <p className="max-w-[54ch] text-[1.15rem] leading-[1.6] text-ink-soft">
              Tokenized stocks on BNB Chain trade around the clock, and until now nobody could borrow one. Stockroom is the lending desk: holders lend NVDAB, TSLAB and the other bStocks and earn a fee in USDT; borrowers post USDT and take the stock to short, hedge or make markets while Wall Street is shut.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Button nativeButton={false} render={<Link href="/app" />} size="lg" className="px-7">
                Open the app
              </Button>
              <a href="#how" className="font-bold text-ink">
                See how it works
              </a>
            </div>
          </div>
          <div className="mt-14">
            <LendChart />
          </div>
          <div className="mt-8">
            <LiveSession />
          </div>
        </section>

        <section className="border-t border-line py-20">
          <h2 className="max-w-[20ch] font-heading text-[clamp(2rem,5vw,3.4rem)] leading-[1.04] font-semibold tracking-[-0.02em]">Rent for stock that was sitting still</h2>
          <p className="mt-5 mb-12 max-w-[58ch] text-[1.05rem] leading-[1.6] text-ink-soft">
            A borrower pays a yearly rate on the value of what they took, for exactly as long as they hold it. Nine tenths of it reaches the lender. Try a few.
          </p>
          <TryIt />
        </section>

        <section id="how" className="scroll-mt-8 border-t border-line py-20">
          <h2 className="font-heading text-[clamp(2rem,5vw,3.4rem)] leading-[1.04] font-semibold tracking-[-0.02em]">How it works</h2>
          <ol className="mt-12 grid gap-x-12 gap-y-12 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="font-heading text-[4.5rem] leading-none font-semibold text-signal" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="mt-4 font-heading text-[1.6rem] leading-tight font-semibold tracking-[-0.3px]">{step.title}</h3>
                <p className="mt-3 leading-[1.65] text-ink-soft">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-line py-20">
          <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div>
              <h2 className="font-heading text-[clamp(2rem,5vw,3.4rem)] leading-[1.04] font-semibold tracking-[-0.02em]">What keeps it safe</h2>
              <p className="mt-5 max-w-[40ch] text-[1.05rem] leading-[1.6] text-ink-soft">A loan is a real position on a real chain. These are the limits Stockroom works inside.</p>
            </div>
            <dl className="grid gap-x-12 sm:grid-cols-2">
              {SAFEGUARDS.map((item) => (
                <div key={item.title} className="border-t border-line py-6">
                  <dt className="text-[1.05rem] font-bold">{item.title}</dt>
                  <dd className="mt-2 leading-[1.65] text-ink-soft">{item.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-t border-line py-24 text-center">
          <h2 className="mx-auto max-w-[18ch] font-heading text-[clamp(2.2rem,6vw,4rem)] leading-[1.02] font-semibold tracking-[-0.02em]">Keep the dividend. Collect the rent.</h2>
          <Button nativeButton={false} render={<Link href="/app" />} size="lg" className="mt-9 px-8">
            Open the app
          </Button>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-8 text-sm text-ink-faint">
        <span>Stockroom. Built on BNB Chain with bStocks, APRO, PancakeSwap and the Binance Web3 APIs.</span>
        <span>Lending yield depends on borrow demand. bStocks are not available to US persons. Not investment advice.</span>
      </footer>
    </div>
  );
}

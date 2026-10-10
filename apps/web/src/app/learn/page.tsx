import Link from "next/link";

export default function LearnPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">How Stockroom works, in plain words</h1>
        <p className="text-muted-foreground">
          Robinhood pays you to lend your shares. Stockroom does the same for the tokenized stocks you already hold on BNB Chain, with the rules written into contracts instead of a brokerage agreement.
        </p>
      </section>

      <Block title="If you own bStocks">
        <p>Lend them. You hand the tokens to the pool and get a receipt (for NVDAB it is called sNVDAB). While they are out, borrowers pay a fee in USDT and most of it goes to you. You can take your tokens back whenever the pool has idle liquidity, usually right away.</p>
        <p>You lose nothing you had before. Dividends and splits are applied by the issuer through a multiplier on every token, and the borrower owes you the same number of tokens back, so the multiplier lands on you, not them.</p>
        <p>The risk is a borrower who does not repay. Every borrower posts more USDT than the stock is worth, and anyone can liquidate them the moment that cushion gets thin; if a stock jumped faster than the auction could sell, the insurance fund covers lenders first.</p>
      </Block>

      <Block title="If you want to borrow">
        <p>Deposit USDT as collateral, then borrow a stock to take delivery, or press Short to borrow and sell it in one transaction so the USDT lands back in your collateral. One USDT balance backs every stock you borrow.</p>
        <p>Your health factor is your collateral divided by what you owe, weighted by each stock&apos;s risk. Above 1 you are safe; below 1 anyone can repay half of your position and take your USDT at a small discount; below 0.95, all of it. Covering buys the stock back and repays it in one transaction.</p>
      </Block>

      <Block title="Why the weekend matters">
        <p>bStocks trade around the clock on BNB Chain; the New York market does not. From Friday evening to Monday morning there is no fresh reference price, only what the on-chain pool says. Stockroom values short debt at the highest of three sources (the APRO feed, the PancakeSwap average price, and the last reference print) and adds a small premium that grows every hour the market is closed, up to 5 percent. That premium is what keeps lenders safe through a Monday gap.</p>
        <p>The session strip at the top of every page says which mode you are in.</p>
      </Block>

      <Block title="What pauses, and what never does">
        <p>New borrows pause when a dividend or split is about to land, when the token is paused by its issuer, or when the price sources disagree. Repaying, withdrawing and liquidating never pause.</p>
      </Block>

      <Block title="What this is not">
        <p>Not a bank and not a broker. Nobody holds your money but the contracts, which anyone can read. The contracts are new and unaudited; sizes are small for a reason. bStocks are not available to US persons. Lending yield is whatever borrowers are paying right now, not a promise.</p>
      </Block>

      <p className="text-sm text-muted-foreground">
        Ready? <Link href="/" className="underline underline-offset-4">Pick a stock</Link>, or read the contracts at github.com/adilhusain01/stockroom.
      </p>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

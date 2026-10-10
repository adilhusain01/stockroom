import type { Metadata } from "next";
import { Suspense } from "react";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { TopBar } from "@/components/top-bar";
import { SessionStrip } from "@/components/session-strip";

const sans = Instrument_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Stockroom",
  description: "Stock lending for bStocks on BNB Chain. Lend tokenized stocks and earn USDT while keeping every dividend; borrow them to short, hedge or market-make over the weekend.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <Providers>
          <Suspense fallback={<div className="h-14 border-b border-border" aria-hidden />}>
            <TopBar />
          </Suspense>
          <SessionStrip />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
            <Suspense fallback={null}>{children}</Suspense>
          </main>
          <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-muted-foreground">
            Stockroom is a hackathon prototype on BNB Smart Chain. bStocks are not available to US persons. Lending yield depends on borrow demand; nothing here is investment advice.
          </footer>
        </Providers>
      </body>
    </html>
  );
}

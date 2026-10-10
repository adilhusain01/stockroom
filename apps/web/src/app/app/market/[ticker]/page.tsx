import { Suspense } from "react";
import { Loader } from "@/components/loader";
import { MarketDetail } from "@/components/market-detail";

export default function MarketPage(props: PageProps<"/app/market/[ticker]">) {
  return (
    <Suspense fallback={<Loader label="Reading the market" />}>
      <Resolved params={props.params} />
    </Suspense>
  );
}

async function Resolved({ params }: { params: PageProps<"/app/market/[ticker]">["params"] }) {
  const { ticker } = await params;
  return <MarketDetail ticker={ticker.toUpperCase()} />;
}

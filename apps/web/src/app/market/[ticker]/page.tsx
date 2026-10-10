import { Suspense } from "react";
import { MarketDetail } from "@/components/market-detail";
import { Skeleton } from "@/components/ui/skeleton";

export default function MarketPage(props: PageProps<"/market/[ticker]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Resolved params={props.params} />
    </Suspense>
  );
}

async function Resolved({ params }: { params: PageProps<"/market/[ticker]">["params"] }) {
  const { ticker } = await params;
  return <MarketDetail ticker={ticker.toUpperCase()} />;
}

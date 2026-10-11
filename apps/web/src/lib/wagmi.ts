import { createConfig, http } from "wagmi";
import { bsc } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/** BSC only. The injected connector picks up Binance Web3 Wallet, MetaMask, Trust and the rest. */
export const wagmiConfig = createConfig({
  chains: [bsc],
  connectors: [injected()],
  transports: {
    [bsc.id]: http(process.env.NEXT_PUBLIC_BSC_RPC_URL ?? "https://bsc-dataseed.binance.org"),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

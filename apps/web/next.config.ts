import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The app moved under /app when the landing page took over /. Old links keep working.
  async redirects() {
    return [
      { source: "/market/:ticker", destination: "/app/market/:ticker", permanent: false },
      { source: "/account", destination: "/app/account", permanent: false },
      { source: "/desk", destination: "/app/desk", permanent: false },
      { source: "/rates", destination: "/app/rates", permanent: false },
      { source: "/learn", destination: "/#how", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

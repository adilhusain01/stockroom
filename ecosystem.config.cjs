// pm2 processes for the VPS. Start with: pnpm exec pm2 start ecosystem.config.cjs && pnpm exec pm2 save
// The API listens on 127.0.0.1:4310 and the web app on 127.0.0.1:3020; Caddy fronts both (docs/runbook.md).
const root = __dirname;

module.exports = {
  apps: [
    {
      name: "stockroom-keeper",
      cwd: `${root}/apps/keeper`,
      script: "node",
      args: "--import tsx src/main.ts all",
      env: { NODE_ENV: "production", RELAY_INTERVAL_SEC: "120", RELAY_RESTAMP_SEC: "0", ANCHOR_INTERVAL_SEC: "3600", LIQUIDATE_INTERVAL_SEC: "30" },
      max_restarts: 50,
      restart_delay: 10000,
    },
    {
      name: "stockroom-desk",
      cwd: `${root}/apps/keeper`,
      script: "node",
      args: "--import tsx src/main.ts nightdesk run",
      env: { NODE_ENV: "production", NIGHTDESK_INTERVAL_SEC: "300", NIGHTDESK_TICKER: "NVDAB", NIGHTDESK_BORROW: "0.01", NIGHTDESK_COLLATERAL: "5" },
      max_restarts: 50,
      restart_delay: 30000,
    },
    {
      name: "stockroom-api",
      cwd: `${root}/apps/api`,
      script: "node",
      args: "--import tsx src/server.ts",
      env: { NODE_ENV: "production", API_PORT: "4310", PUBLIC_API_URL: "https://stockroom.adilhusain.xyz/api" },
    },
    {
      name: "stockroom-web",
      cwd: `${root}/apps/web`,
      script: "node_modules/next/dist/bin/next",
      args: "start --hostname 127.0.0.1 --port 3020",
      env: { NODE_ENV: "production" },
    },
  ],
};

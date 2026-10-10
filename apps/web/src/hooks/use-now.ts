"use client";

import { useEffect, useState } from "react";

/** The current unix time in seconds, ticking every 30 seconds. Null on the server and the first paint. */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

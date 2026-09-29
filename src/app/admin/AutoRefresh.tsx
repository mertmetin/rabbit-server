"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-fetches the page's server data every few seconds, so new orders show up.
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}

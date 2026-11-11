"use client";

import { useEffect } from "react";

/** Registers the offline-fallback worker in production builds only. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Without a worker the app still works; only the offline page is missing.
    });
  }, []);
  return null;
}

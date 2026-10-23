"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (window.location.protocol === "http:" && window.location.hostname !== "localhost") return;
    if (process.env.NODE_ENV !== "production") {
      // Development must never serve cached Next.js chunks: they are not content-addressed.
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      });
      void caches.keys().then((keys) => {
        for (const key of keys) void caches.delete(key);
      });
      return;
    }
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration is optional; the app works without offline caching.
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

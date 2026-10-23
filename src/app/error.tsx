"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="card max-w-md p-8 text-center">
        <p className="text-3xl" aria-hidden>
          🛰️
        </p>
        <h1 className="mt-3 text-xl font-semibold">Something drifted off course</h1>
        <p className="mt-2 text-sm text-ink-soft">
          The page could not be loaded. Your family data is safe. Try again, or head back to the dashboard.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={reset} className="btn">
            Try again
          </button>
          <a href="/dashboard" className="btn-secondary">
            Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

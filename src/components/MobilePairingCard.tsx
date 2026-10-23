"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";

export function MobilePairingCard({ serverUrl }: { serverUrl: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!serverUrl) return;
    import("qrcode")
      .then((module) =>
        module.toDataURL(serverUrl, {
          margin: 1,
          width: 220,
          errorCorrectionLevel: "M",
          color: { dark: "#0b4f49", light: "#fffdf8" },
        }),
      )
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy the HomeOrbit server address:", serverUrl);
    }
  }

  return (
    <Card title="Pair a phone or tablet" subtitle="The native app loads this server; AI never runs on the phone.">
      {serverUrl ? (
        <div className="space-y-3">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code for the HomeOrbit server address" className="mx-auto h-48 w-48 rounded-xl border border-black/5" />
          ) : (
            <p className="text-xs text-ink-soft">Generating QR…</p>
          )}
          <p className="break-all rounded-xl bg-sand/70 px-3 py-2 text-center text-[11px] text-ink-soft">{serverUrl}</p>
          <button type="button" className="btn-secondary w-full text-xs" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy server address"}
          </button>
          <p className="text-[11px] text-ink-soft">
            Open the HomeOrbit app, tap <strong>Scan QR</strong>, and pick a photo of this code. The app asks for the address
            once and remembers it. Use HTTPS outside the home.
          </p>
        </div>
      ) : (
        <p className="rounded-xl bg-amber-50 p-3 text-[11px] text-amber-900">
          Set <code>MOBILE_PUBLIC_URL</code> to the HTTPS address phones use, then reload this page to show a pairing QR.
          The request host is <code>localhost</code>, which phones cannot reach.
        </p>
      )}
    </Card>
  );
}

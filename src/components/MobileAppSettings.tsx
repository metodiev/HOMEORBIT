"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Badge, Card } from "@/components/ui";
import { HomeOrbitServer, isNativeApp, normalizeServerUrl } from "@/lib/mobile/native";

type State = {
  native: boolean;
  platform: string;
  currentUrl: string | null;
  input: string;
  status: string;
  error: boolean;
  busy: boolean;
};

export function MobileAppSettings() {
  const [state, setState] = useState<State | null>(null);
  const qrInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isNativeApp()) {
      setState({
        native: false,
        platform: "web",
        currentUrl: null,
        input: "",
        status: "",
        error: false,
        busy: false,
      });
      return;
    }
    let cancelled = false;
    HomeOrbitServer.get()
      .then((result) => {
        if (cancelled) return;
        setState({
          native: true,
          platform: Capacitor.getPlatform(),
          currentUrl: result.url,
          input: result.url ?? "",
          status: "",
          error: false,
          busy: false,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          native: true,
          platform: Capacitor.getPlatform(),
          currentUrl: null,
          input: "",
          status: error instanceof Error ? error.message : "Could not read the native server setting.",
          error: true,
          busy: false,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state?.native) return null;

  function update(patch: Partial<State>) {
    setState((current) => (current ? { ...current, ...patch } : current));
  }

  async function connect() {
    let server: string;
    try {
      server = normalizeServerUrl(state?.input ?? "");
    } catch (error) {
      update({ status: error instanceof Error ? error.message : "Invalid server address.", error: true });
      return;
    }
    update({ busy: true, status: "Saving and restarting the app…", error: false });
    try {
      await HomeOrbitServer.set({ url: server });
      await HomeOrbitServer.reload();
    } catch (error) {
      update({
        busy: false,
        error: true,
        status: error instanceof Error ? error.message : "Could not change the server address.",
      });
    }
  }

  async function forget() {
    if (!window.confirm("Forget this server and return to the setup screen? Your login session stays on the server.")) {
      return;
    }
    update({ busy: true, status: "Returning to setup…", error: false });
    try {
      await HomeOrbitServer.clear();
      await HomeOrbitServer.reload();
    } catch (error) {
      update({
        busy: false,
        error: true,
        status: error instanceof Error ? error.message : "Could not reset the server address.",
      });
    }
  }

  async function decodeQr(file: File) {
    update({ status: "Reading QR code…", error: false });
    try {
      const { default: jsQR } = await import("jsqr");
      const objectUrl = URL.createObjectURL(file);
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("That image could not be read."));
          img.src = objectUrl;
        });
        const maxSide = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = maxSide > 1600 ? 1600 / maxSide : 1;
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("This device cannot decode QR images.");
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);
        const code = jsQR(pixels.data, width, height, { inversionAttempts: "attemptBoth" });
        if (!code?.data) {
          update({ status: "No QR code found. Try a closer, brighter photo.", error: true });
          return;
        }
        let decoded = code.data.trim();
        try {
          const qrUrl = new URL(decoded);
          if (qrUrl.protocol === "homeorbit:" && qrUrl.searchParams.get("url")) {
            decoded = qrUrl.searchParams.get("url") ?? decoded;
          }
        } catch {
          // Plain URL below.
        }
        const server = normalizeServerUrl(decoded);
        update({ input: server, status: "QR code read. Tap Save & connect.", error: false });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (error) {
      update({
        status: error instanceof Error ? error.message : "Could not read that QR image.",
        error: true,
      });
    } finally {
      if (qrInput.current) qrInput.current.value = "";
    }
  }

  return (
    <Card
      title="Mobile app connection"
      subtitle={`Native ${state.platform === "ios" ? "iOS" : "Android"} shell — all AI stays on your HomeOrbit server.`}
    >
      <div className="space-y-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="teal">{state.platform === "ios" ? "iOS app" : "Android app"}</Badge>
          {state.currentUrl ? <span className="break-all text-ink-soft">{state.currentUrl}</span> : null}
        </div>
        <div>
          <label className="label" htmlFor="mobile-server-url">
            HomeOrbit server address
          </label>
          <input
            id="mobile-server-url"
            value={state.input}
            onChange={(event) => update({ input: event.target.value, error: false })}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://homeorbit.example.ts.net"
            className="field mt-0"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-[11px]" disabled={state.busy} onClick={() => void connect()}>
            Save &amp; reconnect
          </button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-[11px]" disabled={state.busy} onClick={() => qrInput.current?.click()}>
            Scan QR
          </button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-[11px] text-red-700" disabled={state.busy} onClick={() => void forget()}>
            Change server
          </button>
          <input
            ref={qrInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void decodeQr(file);
            }}
          />
        </div>
        {state.status ? (
          <p className={`rounded-xl px-3 py-2 text-[11px] ${state.error ? "bg-red-50 text-red-800" : "bg-sand/70 text-ink-soft"}`}>
            {state.status}
          </p>
        ) : null}
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          Use HTTPS outside the home. A plain <code>http://</code> LAN address is allowed for trusted local testing only.
          The app never connects directly to Ollama, ComfyUI or the database.
        </p>
      </div>
    </Card>
  );
}

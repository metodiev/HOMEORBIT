"use client";

import { useEffect, useState } from "react";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read the downloaded file."));
    reader.readAsDataURL(blob);
  });
}

function safeFilename(value: string): string {
  return value.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 160) || "homeorbit-download";
}

export function NativeMobileBridge() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cleanup: (() => void)[] = [];

    async function start() {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      const [{ App }, { Network }, { Browser }, { Filesystem, Directory }, { Share }, { StatusBar, Style }] =
        await Promise.all([
          import("@capacitor/app"),
          import("@capacitor/network"),
          import("@capacitor/browser"),
          import("@capacitor/filesystem"),
          import("@capacitor/share"),
          import("@capacitor/status-bar"),
        ]);
      if (cancelled) return;

      try {
        await StatusBar.setStyle({ style: Style.Light });
        await StatusBar.setOverlaysWebView({ overlay: false });
        if (Capacitor.getPlatform() === "android") {
          await StatusBar.setBackgroundColor({ color: "#f6f2ea" });
        }
      } catch {
        // Status bar appearance is cosmetic; ignore platform limitations.
      }

      const backListener = await App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) window.history.back();
        else void App.minimizeApp();
      });
      cleanup.push(() => void backListener.remove());

      const networkListener = await Network.addListener("networkStatusChange", (status) => {
        if (!cancelled) setOffline(!status.connected);
      });
      cleanup.push(() => void networkListener.remove());
      const status = await Network.getStatus();
      if (!cancelled) setOffline(!status.connected);

      async function onClick(event: MouseEvent) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const anchor = target.closest("a");
        if (!anchor) return;
        const href = anchor.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
        let url: URL;
        try {
          url = new URL(href, window.location.href);
        } catch {
          return;
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") return;

        if (url.origin !== window.location.origin) {
          event.preventDefault();
          event.stopPropagation();
          await Browser.open({ url: url.toString() });
          return;
        }

        if (!url.pathname.startsWith("/api/media/") || url.searchParams.get("download") !== "1") return;

        event.preventDefault();
        event.stopPropagation();
        try {
          const response = await fetch(url.toString(), { credentials: "include" });
          if (!response.ok) throw new Error(`Download failed (${response.status}).`);
          const blob = await response.blob();
          const disposition = response.headers.get("content-disposition") ?? "";
          const filenameMatch = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition);
          const filename = safeFilename(
            filenameMatch ? decodeURIComponent(filenameMatch[1].replace(/"$/, "")) : url.pathname.split("/").pop() ?? "homeorbit-download",
          );
          const path = `downloads/${filename}`;
          await Filesystem.writeFile({
            path,
            data: await blobToBase64(blob),
            directory: Directory.Cache,
            recursive: true,
          });
          const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
          await Share.share({
            title: filename,
            text: "Downloaded from HomeOrbit",
            url: uri,
            dialogTitle: "Save or share your HomeOrbit file",
          });
        } catch (error) {
          window.alert(error instanceof Error ? error.message : "The file could not be downloaded.");
        }
      }

      document.addEventListener("click", onClick, true);
      cleanup.push(() => document.removeEventListener("click", onClick, true));
    }

    void start().catch(() => undefined);
    return () => {
      cancelled = true;
      for (const remove of cleanup) remove();
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-24 z-[60] rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950 shadow-lg lg:bottom-4 lg:left-auto lg:right-4 lg:max-w-sm"
    >
      <strong>No network connection.</strong> HomeOrbit needs the private server on your Mac Studio. Reconnect to Wi-Fi or
      your VPN and try again.
    </div>
  );
}

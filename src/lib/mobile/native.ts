import { Capacitor, registerPlugin } from "@capacitor/core";

export type HomeOrbitServerPlugin = {
  get(): Promise<{ url: string | null }>;
  set(options: { url: string }): Promise<void>;
  clear(): Promise<void>;
  reload(): Promise<void>;
};

export const HomeOrbitServer = registerPlugin<HomeOrbitServerPlugin>("HomeOrbitServer");

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function normalizeServerUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Enter the address of your HomeOrbit server.");
  if (/\s/.test(value)) throw new Error("Server addresses cannot contain spaces.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("That does not look like a valid server address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Use an http(s) server address.");
  }
  if (url.username || url.password) throw new Error("Do not include credentials in the server address.");
  if (!url.hostname) throw new Error("The server address needs a hostname.");
  if (!/^[a-z0-9._:[\]-]+$/i.test(url.hostname) || url.hostname.includes("%")) {
    throw new Error("The server hostname contains invalid characters.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Use the HomeOrbit root address without a path, query or fragment.");
  }
  return url.origin;
}

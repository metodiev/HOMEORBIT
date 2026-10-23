import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { getCurrentActor } from "@/lib/auth/session";
import { normalizeLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: {
    default: "HomeOrbit — your family's AI assistant",
    template: "%s · HomeOrbit",
  },
  description:
    "HomeOrbit keeps the whole family in orbit: shared calendars, school runs, deliveries, shopping, meals and an AI assistant that works with real family data.",
  manifest: "/manifest.webmanifest",
  applicationName: "HomeOrbit",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "HomeOrbit" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await getCurrentActor();
  return (
    <html lang={normalizeLocale(actor?.locale)}>
      <body className="min-h-screen antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

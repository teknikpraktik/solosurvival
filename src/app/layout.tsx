import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "./_client/SessionProvider";
import { ServiceWorker } from "./_client/ServiceWorker";

export const metadata: Metadata = {
  title: "Solo Survival",
  description: "GPS-based zombie survival game along real trails.",
  applicationName: "Solo Survival",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/icon-192.png?v=5", sizes: "192x192", type: "image/png" }], apple: "/icons/apple-touch-icon.png?v=5" },
  appleWebApp: { capable: true, title: "Solo Survival", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f14",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}

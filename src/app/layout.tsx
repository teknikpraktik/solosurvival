import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "./_client/SessionProvider";
import { ServiceWorker } from "./_client/ServiceWorker";

export const metadata: Metadata = {
  title: "OUTBREAK – Solo Survival",
  description: "GPS-based zombie survival game along real trails.",
  applicationName: "OUTBREAK – Solo Survival",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/icon-192.png?v=3", sizes: "192x192", type: "image/png" }], apple: "/icons/apple-touch-icon.png?v=3" },
  appleWebApp: { capable: true, title: "OUTBREAK", statusBarStyle: "black-translucent" },
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

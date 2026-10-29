import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "../client/SessionProvider";
import { ServiceWorker } from "../client/ServiceWorker";

export const metadata: Metadata = {
  title: "Mini Outbreak Solo Survival",
  description: "A friendly GPS game: walk real paths and dodge cute critters.",
  applicationName: "Mini Outbreak Solo Survival",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/icon-192.png?v=3", sizes: "192x192", type: "image/png" }], apple: "/icons/apple-touch-icon.png?v=3" },
  appleWebApp: { capable: true, title: "Mini Outbreak", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#7c5cff",
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

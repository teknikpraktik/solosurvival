import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OUTBREAK – Solo Survival",
  description: "GPS-baserat överlevnadsspel längs verkliga stigar.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}

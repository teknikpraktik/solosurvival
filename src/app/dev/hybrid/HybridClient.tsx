"use client";

import dynamic from "next/dynamic";

const HybridViewer = dynamic(() => import("./HybridViewer"), { ssr: false });

export default function HybridClient() {
  return <HybridViewer />;
}

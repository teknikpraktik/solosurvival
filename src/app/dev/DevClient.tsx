"use client";

import dynamic from "next/dynamic";

// MapLibre kräver webbläsaren, så kartan renderas bara på klienten.
const SimMap = dynamic(() => import("./SimMap"), { ssr: false });

export default function DevClient() {
  return <SimMap />;
}

"use client";

import dynamic from "next/dynamic";

const RoutesViewer = dynamic(() => import("./RoutesViewer"), { ssr: false });

export default function RoutesClient() {
  return <RoutesViewer />;
}

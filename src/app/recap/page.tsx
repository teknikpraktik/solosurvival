import { Suspense } from "react";
import Recap from "./Recap";

export const metadata = { title: "Match – OUTBREAK" };

export default function Page() {
  return <Suspense><Recap /></Suspense>;
}

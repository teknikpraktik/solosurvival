import Link from "next/link";
import { PageHeader } from "../_client/Modal";
import { SoundSettings } from "../_client/SoundSettings";

export const metadata = { title: "Settings – OUTBREAK" };

/** Every setting in one place: sound now; test mode (tools for checking location and the game outside a match) last, as it is rarely needed. */
export default function Settings() {
  return (
    <main className="page settings">
      <PageHeader title="SETTINGS" />
      <h2>Sound</h2>
      <SoundSettings />
      <h2>Test mode</h2>
      <div className="card setgroup">
        <p className="muted">Check location accuracy and try the game without starting a match.</p>
        <Link className="btn" href="/field">OPEN TEST MODE</Link>
      </div>
    </main>
  );
}

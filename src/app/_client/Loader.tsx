/** The app's waiting state: the rings logo breathing, with an optional line under it (never a bare "Loading…"). */
export function Loader({ label }: { label?: string }) {
  return (
    <div className="loader" role="status" aria-label={label ?? "Loading"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/img/logo-rings.png" alt="" width={72} height={72} />
      {label && <span>{label}</span>}
    </div>
  );
}

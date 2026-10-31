"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Gemensam dialog. Täcker hela skärmen (backdrop), respekterar safe areas och scrollar innehållet inuti dialogen, så
 * dialogens egna knappar (`actions`) alltid ligger synliga i botten. Ett X uppe till höger visas bara när dialogen får stängas;
 * obligatoriska beslut (t.ex. Match slut) saknar X och måste besvaras med någon av knapparna.
 */
export function Modal({ title, onClose, children, actions, tone }: { title: string; onClose?: () => void; children?: ReactNode; actions: ReactNode; tone?: "bad" }) {
  useEffect(() => {
    if (!onClose) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal${tone ? ` ${tone}` : ""}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && <CloseButton onClick={onClose} />}
        </div>
        {children && <div className="modal-body">{children}</div>}
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}

/** The app's single close button (same look in dialogs, page headers and the course preview). Renders a link when `href` is given. */
export function CloseButton({ onClick, href, disabled, label = "Close" }: { onClick?: () => void; href?: string; disabled?: boolean; label?: string }) {
  if (href) return <a className="xbtn" href={href} aria-label={label}>✕</a>;
  return <button className="xbtn" onClick={onClick} disabled={disabled} aria-label={label}>✕</button>;
}

/** Sidhuvud: BACK (till startsidan, eller `href`) och rubriken. */
export function PageHeader({ title, href = "/" }: { title: string; href?: string }) {
  // A small back chevron before the title (44 px to tap, but only the chevron shows): the page's title is what the eye should land on.
  return (
    <div className="topbar">
      <a className="pageback" href={href} aria-label="Back"><span aria-hidden="true">‹</span></a>
      <h1 style={{ flex: 1 }}>{title}</h1>
    </div>
  );
}

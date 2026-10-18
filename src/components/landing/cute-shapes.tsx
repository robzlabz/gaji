/**
 * Maskot kecil untuk landing page.
 * Semua SVG memakai `currentColor` / token brand supaya ikut tema terang & gelap.
 */

/** Koin lucu: mata bisa berkedip (class `.eye` di-animasikan GSAP). */
export function CoinFace({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" role="img" aria-label="Koin" className={className}>
      <circle cx="48" cy="48" r="44" className="fill-brand" />
      <circle cx="48" cy="48" r="34" className="fill-brand-soft" />
      <circle cx="48" cy="48" r="34" fill="none" className="stroke-brand" strokeWidth="2.5" strokeDasharray="4 6" opacity="0.5" />
      <g className="fill-brand-soft-foreground">
        <ellipse className="eye" cx="37" cy="44" rx="4.2" ry="5.4" />
        <ellipse className="eye" cx="59" cy="44" rx="4.2" ry="5.4" />
      </g>
      <path
        d="M38 58c3 4 7 6 10 6s7-2 10-6"
        fill="none"
        className="stroke-brand-soft-foreground"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <circle cx="28" cy="55" r="3.4" className="fill-brand" opacity="0.28" />
      <circle cx="68" cy="55" r="3.4" className="fill-brand" opacity="0.28" />
    </svg>
  );
}

/** Kuitansi lucu dengan gigi zig-zag di bawah. */
export function ReceiptFace({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 112" role="img" aria-label="Kuitansi" className={className}>
      <path
        d="M12 8h72v88l-9-7-9 7-9-7-9 7-9-7-9 7-9-7-9 7V8Z"
        className="fill-card stroke-brand"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <g className="fill-brand-soft-foreground">
        <ellipse className="eye" cx="36" cy="40" rx="3.8" ry="4.8" />
        <ellipse className="eye" cx="60" cy="40" rx="3.8" ry="4.8" />
      </g>
      <path
        d="M40 52c2.4 3 5 4.6 8 4.6s5.6-1.6 8-4.6"
        fill="none"
        className="stroke-brand-soft-foreground"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <g className="stroke-brand" strokeWidth="3" strokeLinecap="round" opacity="0.45">
        <path d="M26 68h44" />
        <path d="M26 78h28" />
      </g>
    </svg>
  );
}

/** Kilau kecil untuk aksen. */
export function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M12 1.5c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8Z"
        className="fill-current"
      />
    </svg>
  );
}

/** Garis bawah ala spidol, digambar dengan DrawSVG. */
export function Squiggle({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 18"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3 12c34-8 68-9 102-5 22 2.6 43 5.6 64 4.4 22-1.2 44-4.4 68-9"
        fill="none"
        className="stroke-brand"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

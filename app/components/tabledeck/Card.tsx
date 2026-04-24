import type { CSSProperties } from "react";

type Suit = "parrot" | "chest" | "map" | "jolly";
type Variant = "pirate" | "mermaid" | "skull-king" | "tigress" | "escape" | "numbered";

interface CardProps {
  suit?: Suit;
  value?: number;
  variant?: Variant;
  rotation?: number;
  playable?: boolean;
  played?: boolean;
  className?: string;
}

/* ── Suit mini SVG icons (14×14) ─── */
function SuitMark({ suit }: { suit: Suit }) {
  if (suit === "parrot") {
    return (
      <svg className="td-suit-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 14c0-5 4-9 9-9 2 0 4 1 5 2l-3 3c-1-1-2-1-3-1-3 0-6 3-6 7v1H6v-3z" />
      </svg>
    );
  }
  if (suit === "chest") {
    return (
      <svg className="td-suit-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10h16v10H4z" />
        <path d="M4 10c0-3 2-5 8-5s8 2 8 5" fill="none" strokeWidth="2" />
      </svg>
    );
  }
  if (suit === "map") {
    return (
      <svg className="td-suit-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5l6 2 6-2 4 2v14l-4-2-6 2-6-2-4 2V7z" />
        <path d="M10 8v12M16 7v12" fill="none" strokeWidth="1.5" />
        <path d="M13 14l-1-1-1 2 2 1z" fill="none" strokeWidth="1.5" />
      </svg>
    );
  }
  // jolly
  return (
    <svg className="td-suit-icon" viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="12,4 14,14 22,14 15,19 18,28 12,22 6,28 9,19 2,14 10,14" />
    </svg>
  );
}

/* ── Center art ─────────────────── */
function CardArt({ suit, variant, value }: { suit?: Suit; variant?: Variant; value?: number }) {
  if (variant === "pirate") {
    return (
      <svg viewBox="0 0 64 90" aria-hidden="true">
        <g stroke="#1a1612" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 24c4-10 16-14 22-14s18 4 22 14c-4-1-8-1-14-1l-4 4h-8l-4-4c-6 0-10 0-14 1z" fill="#1a1612" />
          <circle cx="32" cy="18" r="2.4" fill="#f4e9d0" stroke="none" />
          <path d="M20 32c0 8 4 16 12 16s12-8 12-16" fill="#e8d7af" />
          <path d="M16 32l10-2 8 2" />
          <circle cx="36" cy="34" r="1.4" fill="#1a1612" />
          <path d="M24 46c2 4 6 8 8 8s6-4 8-8c-2 2-4 2-8 2s-6 0-8-2z" fill="#1a1612" />
          <path d="M10 72c4-8 14-10 22-10s18 2 22 10" fill="#6b1a21" />
          <path d="M18 62l26 18" stroke="#c9a24a" strokeWidth="2" />
        </g>
      </svg>
    );
  }
  if (variant === "mermaid") {
    return (
      <svg viewBox="0 0 64 90" aria-hidden="true">
        <g stroke="#0f1d33" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="32" cy="18" r="7" fill="#e8d7af" />
          <path d="M26 12c-4 4-4 12-2 20l8-6M38 12c4 4 4 12 2 20l-8-6" fill="#6b1a21" stroke="#6b1a21" />
          <path d="M24 26c0 6 2 10 8 10s8-4 8-10" fill="#e8d7af" />
          <path d="M20 38c2 14 6 24 12 28 6-4 10-14 12-28-6 2-10 4-12 4s-6-2-12-4z" fill="#17294b" />
          <path d="M12 70c4 4 10 6 20 6s16-2 20-6c-6-2-10 0-20 0s-14-2-20 0z" fill="#17294b" />
          <g stroke="#c9a24a" strokeWidth="0.8" fill="none">
            <path d="M26 44c2 0 3 1 4 2" />
            <path d="M32 50c2 0 3 1 4 2" />
            <path d="M28 58c2 0 3 1 4 2" />
          </g>
        </g>
      </svg>
    );
  }
  if (variant === "skull-king") {
    return (
      <svg viewBox="0 0 64 90" aria-hidden="true">
        <g stroke="#e8c872" strokeWidth="1.6" fill="none">
          <path d="M14 22l4-10 6 6 8-10 8 10 6-6 4 10z" fill="#c9a24a" />
          <circle cx="22" cy="16" r="1.2" fill="#6b1a21" />
          <circle cx="32" cy="10" r="1.4" fill="#6b1a21" />
          <circle cx="42" cy="16" r="1.2" fill="#6b1a21" />
        </g>
        <g stroke="#e8c872" strokeWidth="1.5" fill="#f4e9d0">
          <path d="M32 26c-10 0-16 6-16 14 0 4 2 7 4 9v4c0 2 1 3 3 3h3v-3h2v3h8v-3h2v3h3c2 0 3-1 3-3v-4c2-2 4-5 4-9 0-8-6-14-16-14z" />
          <circle cx="26" cy="42" r="3" fill="#1a1612" />
          <circle cx="38" cy="42" r="3" fill="#1a1612" />
          <path d="M29 50c1 1 2 1.5 3 1.5s2-0.5 3-1.5" fill="none" />
        </g>
      </svg>
    );
  }
  if (variant === "tigress") {
    return (
      <svg viewBox="0 0 64 80" aria-hidden="true">
        <g stroke="#a3441e" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="32" cy="28" rx="14" ry="18" fill="#e8d7af" stroke="#a3441e" />
          <circle cx="26" cy="26" r="2.5" fill="#1a1612" />
          <circle cx="38" cy="26" r="2.5" fill="#1a1612" />
          <path d="M22 36c4 4 8 4 20 0" />
          <path d="M16 18c2-4 6-6 16-6s14 2 16 6" />
          <path d="M18 18l-4-8M46 18l4-8" stroke="#a3441e" strokeWidth="2" />
          <path d="M28 40c1 1 2 2 4 2s3-1 4-2" />
        </g>
      </svg>
    );
  }
  if (variant === "escape") {
    return (
      <svg viewBox="0 0 64 80" aria-hidden="true">
        <g stroke="#1a1612" strokeWidth="1.4" fill="none" strokeLinecap="round">
          <path d="M16 60l6-42 10 8 10-8 6 42H16z" fill="#f4e9d0" />
          <path d="M32 18c8 0 16 4 20 10-4-2-8-3-20-3s-16 1-20 3c4-6 12-10 20-10z" fill="#0f1d33" />
          <line x1="32" y1="18" x2="32" y2="60" />
        </g>
      </svg>
    );
  }
  // numbered suits
  if (suit === "parrot") {
    return (
      <svg viewBox="0 0 64 80" aria-hidden="true">
        <g stroke="#6b1a21" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M30 12c-7 0-14 6-14 14 0 10 6 18 14 22 8 4 14 10 14 18" />
          <path d="M30 12c6 0 12 4 14 10" />
          <path d="M18 24c-3 1-5 4-6 8" />
          <circle cx="36" cy="18" r="1.6" fill="#6b1a21" />
          <path d="M44 20l5-2-5 6z" fill="#a3441e" />
          <path d="M28 46c6 0 12-4 14-8" />
          <path d="M30 66l-3 6M34 66l-1 6" />
        </g>
      </svg>
    );
  }
  if (suit === "chest") {
    return (
      <svg viewBox="0 0 64 80" aria-hidden="true">
        <g stroke="#214634" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="8" y="32" width="48" height="30" fill="#e2d4b0" />
          <path d="M8 32c0-10 8-14 24-14s24 4 24 14" fill="#e2d4b0" />
          <line x1="8" y1="46" x2="56" y2="46" />
          <circle cx="32" cy="46" r="3" fill="#c9a24a" stroke="#214634" />
          <line x1="32" y1="32" x2="32" y2="62" />
        </g>
      </svg>
    );
  }
  if (suit === "map") {
    return (
      <svg viewBox="0 0 64 80" aria-hidden="true">
        <g stroke="#a3441e" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 14l16 4 16-4 16 4v50l-16-4-16 4-16-4z" fill="#e8d7af" />
          <path d="M22 18v50M38 14v50" />
          <path d="M12 28c8 0 14 6 20 0s12 0 18 6" />
          <path d="M16 50c6-4 10 0 14-4s12 4 20 0" />
          <path d="M44 40l-2-2-2 4 4 2z" fill="#a3441e" />
        </g>
      </svg>
    );
  }
  if (suit === "jolly") {
    return (
      <svg viewBox="0 0 64 80" aria-hidden="true">
        <g stroke="#0f1d33" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <line x1="16" y1="8" x2="16" y2="72" />
          <path d="M16 14h32l-6 8 6 8H16z" fill="#0f1d33" />
          <circle cx="30" cy="20" r="3" fill="#f4e9d0" />
          <circle cx="38" cy="20" r="3" fill="#f4e9d0" />
          <line x1="26" y1="28" x2="42" y2="28" stroke="#f4e9d0" strokeWidth="1.8" />
        </g>
      </svg>
    );
  }
  return null;
}

/* ── Main Card ──────────────────── */
export function Card({ suit, value, variant = "numbered", rotation = 0, playable = false, played = false, className = "" }: CardProps) {
  const isSpecial = variant !== "numbered";
  const isSkullKing = variant === "skull-king";

  const suitClass = suit ? `td-suit-${suit}` : "";
  const specialClass = isSpecial ? "td-special" : "";
  const skClass = isSkullKing ? "td-skull-king-card" : "";
  const playedClass = played ? "td-played" : "";
  const playableClass = playable ? "td-playable" : "";

  const style: CSSProperties = { "--r": `${rotation}deg` } as CSSProperties;

  /* Corner label for special cards */
  const cornerLabel = () => {
    if (variant === "pirate") return <span className="td-num" style={{ fontSize: "10px", letterSpacing: "0.2em" }}>P</span>;
    if (variant === "mermaid") return <span className="td-num" style={{ fontSize: "10px", letterSpacing: "0.2em" }}>M</span>;
    if (variant === "skull-king") return <span className="td-num" style={{ fontSize: "10px", letterSpacing: "0.2em", color: "var(--gold-hi)" }}>SK</span>;
    if (variant === "tigress") return <span className="td-num" style={{ fontSize: "10px", letterSpacing: "0.2em" }}>T</span>;
    if (variant === "escape") return <span className="td-num" style={{ fontSize: "10px", letterSpacing: "0.2em" }}>E</span>;
    return <span className="td-num">{value}</span>;
  };

  const flavorName = () => {
    if (variant === "pirate") return "Pirate";
    if (variant === "mermaid") return "Mermaid";
    if (variant === "skull-king") return "Skull King";
    if (variant === "tigress") return "Tigress";
    if (variant === "escape") return "Escape";
    return null;
  };

  return (
    <div
      className={`td-card ${suitClass} ${specialClass} ${skClass} ${playedClass} ${playableClass} ${className}`}
      style={style}
    >
      {/* top-left corner */}
      <div className="td-corner td-tl">
        {cornerLabel()}
        {suit && !isSpecial && <SuitMark suit={suit} />}
      </div>

      {/* center art */}
      <div className="td-center">
        <CardArt suit={suit} variant={variant} value={value} />
      </div>

      {/* bottom-right corner (rotated 180) */}
      <div className="td-corner td-br">
        {cornerLabel()}
        {suit && !isSpecial && <SuitMark suit={suit} />}
      </div>

      {/* flavor text for special cards */}
      {flavorName() && (
        <div className="td-flavor" style={isSkullKing ? { color: "var(--gold-hi)" } : undefined}>
          {flavorName()}
        </div>
      )}
    </div>
  );
}

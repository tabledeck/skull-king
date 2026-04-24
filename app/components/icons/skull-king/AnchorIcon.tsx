export function AnchorIcon({ className = "", size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="7" x2="12" y2="20" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 20c0-4 2.5-7 6-7s6 3 6 7" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

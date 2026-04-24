export function ChestIcon({ className = "", size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4 10h16v10H4z" fill="currentColor" />
      <path d="M4 10c0-3 2-5 8-5s8 2 8 5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

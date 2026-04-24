export function JollyRogerIcon({ className = "", size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polygon points="12,4 14,14 22,14 15,19 18,28 12,22 6,28 9,19 2,14 10,14" fill="currentColor" />
    </svg>
  );
}

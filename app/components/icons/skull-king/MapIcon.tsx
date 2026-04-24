export function MapIcon({ className = "", size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4 5l6 2 6-2 4 2v14l-4-2-6 2-6-2-4 2V7z" fill="currentColor" />
      <path d="M10 8v12M16 7v12" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 14l-1-1-1 2 2 1z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

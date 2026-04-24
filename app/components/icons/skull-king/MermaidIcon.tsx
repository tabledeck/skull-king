export function MermaidIcon({ className = "", size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <circle cx="12" cy="7" r="3" fill="currentColor" />
      <path d="M9 10c0 2 0.8 4 3 4s3-2 3-4" fill="currentColor" />
      <path
        d="M7 14c0.8 5 2.5 8 5 10 2.5-2 4.2-5 5-10-2 0.7-3.5 1.5-5 1.5S9 14.7 7 14z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ParrotIcon({ className = "", size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M6 14c0-5 4-9 9-9 2 0 4 1 5 2l-3 3c-1-1-2-1-3-1-3 0-6 3-6 7v1H6v-3z"
        fill="currentColor"
      />
      <circle cx="17" cy="8" r="1.4" fill="currentColor" />
      <path
        d="M6 17l4 3 4-3"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

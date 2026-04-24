export function CrownIcon({ className = "", size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 16" className={className} aria-hidden="true">
      <path
        d="M2 14l2-10 5 6 3-8 3 8 5-6 2 10H2z"
        fill="#c9a24a"
        stroke="#8b6a1e"
        strokeWidth="0.8"
      />
    </svg>
  );
}

export function SkullIcon({ className = "", size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      <path
        d="M16 6c-7 0-11 5-11 10 0 3 1 5 3 6v3c0 1.5 0.7 2 2 2h2v-2h2v2h4v-2h2v2h2c1.3 0 2-0.5 2-2v-3c2-1 3-3 3-6 0-5-4-10-11-10z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.8"
      />
      <circle cx="12" cy="18" r="2.2" fill="#f4e9d0" />
      <circle cx="20" cy="18" r="2.2" fill="#f4e9d0" />
      <path d="M14 22c1 1 1.5 1.5 2 1.5s1-0.5 2-1.5" stroke="#f4e9d0" strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

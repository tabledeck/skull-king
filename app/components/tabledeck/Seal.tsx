interface SealProps {
  animate?: boolean;
  children?: React.ReactNode;
}

export function Seal({ animate = false, children }: SealProps) {
  return (
    <div className={`td-seal ${animate ? "td-seal-animate" : ""}`}>
      {children ?? (
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <circle cx="16" cy="13" r="6" stroke="#f4e9d0" strokeWidth="1.4" />
          <circle cx="13.5" cy="12" r="1.2" fill="#f4e9d0" />
          <circle cx="18.5" cy="12" r="1.2" fill="#f4e9d0" />
          <path d="M13 15c1 1 2 1.5 3 1.5s2-0.5 3-1.5" stroke="#f4e9d0" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M10 23l6-3 6 3" stroke="#f4e9d0" strokeWidth="1.2" />
        </svg>
      )}
    </div>
  );
}

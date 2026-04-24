import type { ReactNode } from "react";

interface PlaqueProps {
  children: ReactNode;
  className?: string;
}

export function Plaque({ children, className = "" }: PlaqueProps) {
  return (
    <div className={`td-plaque ${className}`}>
      {children}
    </div>
  );
}

import type { ReactNode } from "react";

interface ScrollProps {
  children: ReactNode;
  title?: string;
  className?: string;
}

export function Scroll({ children, title, className = "" }: ScrollProps) {
  return (
    <div className={`td-scroll ${className}`}>
      {title && (
        <div className="td-scroll-header">
          <h2>{title}</h2>
          <div className="td-scroll-rule" />
        </div>
      )}
      {children}
    </div>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from "react";

interface BtnSecondaryProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  fullWidth?: boolean;
}

export function BtnSecondary({ children, fullWidth = false, className = "", ...props }: BtnSecondaryProps) {
  return (
    <button
      className={`td-btn-secondary ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

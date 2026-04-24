import type { ButtonHTMLAttributes, ReactNode } from "react";

interface BtnPrimaryProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  fullWidth?: boolean;
}

export function BtnPrimary({ children, fullWidth = false, className = "", ...props }: BtnPrimaryProps) {
  return (
    <button
      className={`td-btn-primary ${fullWidth ? "w-full mt-4" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

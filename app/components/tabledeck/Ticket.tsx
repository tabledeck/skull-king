import type { ReactNode } from "react";

interface TicketProps {
  label: string;
  value: ReactNode;
  dim?: string;
}

export function Ticket({ label, value, dim }: TicketProps) {
  return (
    <div className="td-ticket">
      <span className="td-ticket-label">{label}</span>
      <span className="td-ticket-value">
        {value}
        {dim && <span className="td-dim"> {dim}</span>}
      </span>
    </div>
  );
}

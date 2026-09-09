import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className, ...props }: Props) {
  return (
    <div className={cn("rounded-2xl bg-white border border-slate-100 shadow-card", className)} {...props}>
      {children}
    </div>
  );
}

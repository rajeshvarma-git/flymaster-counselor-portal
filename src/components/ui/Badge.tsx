import { cn } from "@/lib/utils";
import type { LeadStatus } from "@/lib/types";

const styles: Record<string, string> = {
  cold: "bg-sky-100 text-sky-800",
  warm: "bg-amber-100 text-amber-800",
  hot: "bg-orange-100 text-orange-800",
  enrolled: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  requested: "bg-slate-100 text-slate-700",
  uploaded: "bg-sky-100 text-sky-800",
  "needs review": "bg-sky-100 text-sky-800",
  returned: "bg-orange-100 text-orange-800",
  student: "bg-slate-100 text-slate-700",
  counselor: "bg-indigo-100 text-indigo-800",
  admin: "bg-navy-900 text-white",
  super_admin: "bg-navy-900 text-white",
  ai_chat: "bg-cyan-100 text-cyan-800",
};

export function Badge({
  value,
  className,
}: {
  value: LeadStatus | string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
        styles[value] || "bg-slate-100 text-slate-700",
        className,
      )}
    >
      {value.replace("_", " ")}
    </span>
  );
}

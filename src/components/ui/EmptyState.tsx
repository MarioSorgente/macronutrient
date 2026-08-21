import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** The dashed placeholder used wherever a list has nothing in it yet. */
export default function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl2 border border-dashed border-cream-deep px-6 py-10 text-center",
        className
      )}
    >
      {icon && <span className="text-charcoal-soft">{icon}</span>}
      <p className="font-600 text-charcoal">{title}</p>
      {hint && <p className="max-w-sm text-sm text-charcoal-soft">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

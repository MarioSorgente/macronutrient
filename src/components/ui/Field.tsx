import type { ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Label + optional hint + error, wrapping any control.
 *
 * The layout is the one ClientSettings had established privately — label and
 * hint sharing a baseline above the control — lifted out so every form in the
 * app labels its inputs the same way, and so the label is actually associated
 * with the control it names.
 */
export default function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** Pass when the control sets its own id; otherwise one is generated. */
  htmlFor?: string;
  className?: string;
  children: ReactNode | ((id: string) => ReactNode);
}) {
  const generated = useId();
  const id = htmlFor ?? generated;

  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-600 text-charcoal">
          {label}
        </label>
        {hint && <span className="text-[11px] text-charcoal-soft">{hint}</span>}
      </div>
      {typeof children === "function" ? children(id) : children}
      {error && (
        <p className={cn("mt-1 text-[11px] font-600 text-tomato-dark")}>{error}</p>
      )}
    </div>
  );
}

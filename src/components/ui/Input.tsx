import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/components/ui/cn";

/** Shared control chrome, so an input, select and textarea cannot drift apart. */
export const CONTROL_CLASS =
  "w-full rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm text-charcoal outline-none " +
  "transition-colors focus:border-tomato-soft focus:ring-2 focus:ring-tomato-soft/40 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export default function Input({
  invalid,
  className,
  ...rest
}: { invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_CLASS,
        // Number fields keep the app-wide spinner removal from globals.css.
        rest.type === "number" && "no-spin tabular-nums",
        invalid && "border-tomato-dark focus:border-tomato-dark focus:ring-tomato-dark/30",
        className
      )}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(CONTROL_CLASS, "font-600", className)}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(CONTROL_CLASS, "scroll-slim resize-y", className)} />;
}

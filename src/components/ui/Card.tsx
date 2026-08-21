import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The app's surface. `raised` is the list-card treatment (opaque-ish white on
 * cream); `panel` is the quieter background used for grouped controls.
 */
export default function Card({
  tone = "raised",
  className,
  children,
  ...rest
}: {
  tone?: "raised" | "panel";
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "rounded-xl2 border border-cream-deep",
        tone === "raised" ? "bg-white/70 shadow-card" : "bg-white/60",
        className
      )}
    >
      {children}
    </div>
  );
}

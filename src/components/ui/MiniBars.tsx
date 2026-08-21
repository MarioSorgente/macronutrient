import { cn } from "@/components/ui/cn";

export type Bar = { label: string; value: number; title?: string };

/**
 * A bar chart in plain divs.
 *
 * The app carries no charting dependency and the existing macro split bar is
 * hand-rolled the same way; a revenue-per-week chart does not justify pulling
 * in a library for one screen.
 */
export default function MiniBars({
  bars,
  format = (n) => String(Math.round(n)),
  tone = "bg-tomato",
  height = 96,
  className,
}: {
  bars: Bar[];
  format?: (value: number) => string;
  tone?: string;
  /** Plot height in pixels. */
  height?: number;
  className?: string;
}) {
  const peak = Math.max(1, ...bars.map((b) => b.value));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="flex items-end gap-1 border-b border-cream-deep"
        style={{ height }}
        role="img"
        aria-label={bars.map((b) => `${b.label}: ${format(b.value)}`).join(", ")}
      >
        {bars.map((bar) => (
          <div
            key={bar.label}
            className="group relative flex flex-1 items-end justify-center"
            style={{ height: "100%" }}
            title={bar.title ?? `${bar.label} · ${format(bar.value)}`}
          >
            <div
              className={cn("w-full rounded-t transition-all", tone, bar.value === 0 && "bg-cream-deep")}
              // A zero week still gets a hairline so the axis reads as continuous.
              style={{ height: `${Math.max(2, (bar.value / peak) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 text-[10px] tabular-nums text-charcoal-soft">
        {bars.map((bar) => (
          <span key={bar.label} className="flex-1 truncate text-center">
            {bar.label}
          </span>
        ))}
      </div>
    </div>
  );
}

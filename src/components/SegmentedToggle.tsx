"use client";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

/**
 * Two-or-more-way switch used for Manual/Coach and Day/Week. Shared so the
 * planner's toggles stay visually identical instead of drifting apart.
 */
export default function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="inline-flex rounded-xl border border-cream-deep bg-white p-0.5"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-600 transition-colors " +
              (active
                ? "bg-charcoal text-cream"
                : "text-charcoal-soft hover:text-charcoal")
            }
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

import type { Macros } from "@/types/nutrition";
import type { MacroTargets } from "@/lib/storage/types";
import { TARGET_FIELDS, adherencePct } from "@/lib/clients";
import { round0 } from "@/lib/format";
import { diagnoseDailyAdherence } from "@/lib/dailyAdherence";

/**
 * Actual vs target for each macro. Only rendered when the client has targets
 * set — clients without goals never see empty progress bars.
 */
export default function TargetAdherence({
  actual,
  targets,
}: {
  actual: Macros;
  targets: MacroTargets;
}) {
  const diagnostics = diagnoseDailyAdherence(actual, targets);
  return (
    <ul className="flex flex-col gap-2.5">
      {TARGET_FIELDS.map((field) => {
        const target = targets[field.key];
        const value = actual[field.macroKey];
        const pct = adherencePct(value, target);
        // Over target is worth seeing, so the bar caps at 100% but the number doesn't.
        const width = Math.min(100, pct);
        const diagnostic = diagnostics.macros[field.key];
        const over = value > diagnostic.upper;
        const under = value < diagnostic.lower;

        return (
          <li key={field.key}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-600 text-charcoal">{field.label}</span>
              <span className="tabular-nums text-charcoal-soft">
                <b className="text-charcoal">{round0(value)}</b> / {round0(target)}{" "}
                {field.unit}
                <span
                  className={
                    "ml-1.5 font-700 " +
                    (over ? "text-tomato-dark" : under ? "text-gold" : "text-basil")
                  }
                >
                  {target > 0 ? `${Math.round(pct)}%` : "—"}
                </span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-cream-deep">
              <span
                className={`block h-full ${field.tone}`}
                style={{ width: `${width}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

import Link from "next/link";
import {
  BadgeCheck,
  CalendarRange,
  ChefHat,
  Send,
  Sparkles,
  Target,
} from "lucide-react";
import BrandHeader from "@/components/BrandHeader";
import LandingCtas from "@/components/LandingCtas";
import {
  LANDING_WEEK,
  LANDING_WEEK_SLOTS,
  LANDING_WEEK_TARGET,
} from "@/lib/landingWeek";

/**
 * Public landing page.
 */
export const metadata = {
  title: "Mamma Calories — Eat at your restaurant, hit your macros",
  description:
    "Plan your week from the real menu with verified nutrition, then send it to the kitchen to prepare.",
};

/** Fixed locale so the server and the client render the same separators. */
const num = (value: number) => value.toLocaleString("en-US");

const STEPS = [
  {
    icon: Target,
    title: "Set your targets",
    body: "Calories and macros for a whole plan.",
  },
  {
    icon: CalendarRange,
    title: "Build your week",
    body: "Fill each meal slot from the menu, or let the planner assemble a week that lands on your targets.",
  },
  {
    icon: Send,
    title: "Send it to the kitchen",
    body: "Submit your weeks to have your meals ready.",
  },
];

const PROOF = [
  {
    icon: Sparkles,
    title: "A week in about a second",
    body: "Auto-fill builds all seven days at once, searching the whole menu. Not keen on it? Shuffle gives you a different week that lands on the same numbers.",
  },
  {
    icon: Target,
    title: "Built to your numbers",
    body: "Set calories and macros, or start from a split like high protein. DIY meals are supported.",
  },
  {
    icon: ChefHat,
    title: "The restaurant cooks it",
    body: "Send the week and it lands on the kitchen prep board, dish by dish. Pickup or delivery, chosen per day.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <BrandHeader />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-12 sm:px-6 sm:pb-16 sm:pt-20">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-basil/10 px-3 py-1 text-xs font-700 uppercase tracking-wide text-basil">
            <BadgeCheck size={13} /> Verified nutrition data
          </span>

          <h1 className="mt-4 font-display text-4xl font-700 leading-tight text-charcoal sm:text-5xl">
            Eat at the Restaurant.
            <br />
            Hit your macros.
          </h1>

          <p className="mt-4 max-w-xl text-lg leading-relaxed text-charcoal-soft">
            Plan a week of real food from the menu, see exactly what it delivers,
            and have the kitchen prepare it. No weighing, no logging, no cooking.
          </p>

          <LandingCtas className="mt-7" />

          <p className="mt-4 text-sm">
            <Link
              href="#how"
              className="font-600 text-tomato hover:underline"
            >
              See how it works
            </Link>
          </p>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how"
        className="border-y border-cream-deep bg-cream-deep/40"
      >
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
            How it works
          </h2>

          <ol className="mt-8 grid gap-5 sm:grid-cols-3">
            {STEPS.map((step, index) => {
              const Icon = step.icon;

              return (
                <li
                  key={step.title}
                  className="rounded-xl2 border border-cream-deep bg-white p-6 shadow-card"
                >
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-tomato text-cream shadow-card">
                    <Icon size={21} strokeWidth={2.2} />
                  </span>

                  <h3 className="mt-5 font-display text-lg font-700 text-charcoal">
                    <span className="text-tomato">{index + 1}.</span>{" "}
                    {step.title}
                  </h3>

                  <p className="mt-3 text-sm leading-relaxed text-charcoal-soft">
                    {step.body}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Planner example */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
            One click fills the whole week
          </h2>

          <p className="mt-3 leading-relaxed text-charcoal-soft">
            Tell it your calories and protein, or start from a split like high
            protein or low carb. Auto-fill searches the entire menu and builds
            all seven days in about a second.
          </p>
        </div>

        {/* Example week */}
        <figure className="mt-8">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-[11px] font-600 uppercase tracking-wide text-charcoal-soft">
              A week the planner built
            </span>

            <span className="text-sm text-charcoal-soft">
              Target{" "}
              <b className="font-600 tabular-nums text-charcoal">
                {num(LANDING_WEEK_TARGET.energy_kcal)} kcal
              </b>{" "}
              ·{" "}
              <b className="font-600 tabular-nums text-charcoal">
                {LANDING_WEEK_TARGET.protein_g} g protein
              </b>
            </span>
          </figcaption>

          <div className="scroll-slim mt-3 overflow-x-auto pb-2">
            <ol className="grid min-w-[48rem] grid-cols-7 gap-3">
              {LANDING_WEEK.map((day) => (
                <li
                  key={day.day}
                  className="flex flex-col rounded-xl2 border border-cream-deep bg-white/70 p-3 shadow-card"
                >
                  <h3 className="text-xs font-700 uppercase tracking-wide text-charcoal-soft">
                    {day.day}
                  </h3>

                  <ul className="mt-2 flex-1 space-y-2">
                    {LANDING_WEEK_SLOTS.map((slot) => {
                      const meal = day.meals.find(
                        (item) => item.slot === slot
                      );

                      if (!meal) {
                        return (
                          <li
                            key={slot}
                            className="rounded-lg border border-dashed border-cream-deep px-2 py-1.5 text-[11px] leading-snug text-charcoal-soft/70"
                          >
                            No {slot.toLowerCase()} needed
                          </li>
                        );
                      }

                      return (
                        <li key={slot} className="leading-snug">
                          <p className="text-[10px] font-600 uppercase tracking-wide text-charcoal-soft/70">
                            {slot}
                          </p>

                          <p className="mt-0.5 text-[13px] font-600 text-charcoal">
                            {meal.short}
                          </p>

                          <p className="text-[11px] font-600 tabular-nums text-tomato">
                            {num(meal.energy_kcal)} kcal
                          </p>
                        </li>
                      );
                    })}
                  </ul>

                  <p className="mt-3 border-t border-cream-deep pt-2 text-[11px] leading-snug text-charcoal-soft">
                    <span className="font-display text-base font-700 tabular-nums text-charcoal">
                      {num(day.energy_kcal)}
                    </span>{" "}
                    kcal
                    <br />
                    <span className="font-600 tabular-nums text-basil">
                      {day.protein_g} g
                    </span>{" "}
                    protein
                  </p>
                </li>
              ))}
            </ol>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-charcoal-soft">
            Every dish here is on the menu, at the macros the menu publishes.
          </p>
        </figure>

        {/* Product benefits */}
        <ul className="mt-10 grid gap-4 sm:grid-cols-3">
          {PROOF.map((item) => {
            const Icon = item.icon;

            return (
              <li
                key={item.title}
                className="flex gap-3 rounded-xl2 border border-cream-deep bg-white/70 p-4 shadow-card"
              >
                <Icon
                  size={18}
                  className="mt-0.5 shrink-0 text-tomato"
                />

                <div>
                  <h3 className="font-600 text-charcoal">{item.title}</h3>

                  <p className="mt-0.5 text-sm leading-relaxed text-charcoal-soft">
                    {item.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Nutrition verification */}
        <div className="mt-8 rounded-xl2 border border-cream-deep bg-cream-deep/40 p-5">
          <div className="flex items-start gap-3">
            <BadgeCheck
              size={20}
              className="mt-0.5 shrink-0 text-basil"
            />

            <div>
              <h3 className="font-600 text-charcoal">
                Verified nutrition data
              </h3>

              <p className="mt-1 text-sm leading-relaxed text-charcoal-soft">
                All ingredients are verified against USDA FoodData Central.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="border-t border-cream-deep bg-charcoal">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h2 className="font-display text-2xl font-700 text-cream sm:text-3xl">
              Ready when you are
            </h2>

            <p className="mt-3 leading-relaxed text-cream/70">
              Sign in to keep your plan, orders and preferences synced. Build
              your week, and when it is ready, send it to the kitchen.
            </p>
          </div>

          <LandingCtas className="shrink-0" />
        </div>
      </section>
    </div>
  );
}

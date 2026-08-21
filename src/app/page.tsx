import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CalendarRange,
  ChefHat,
  Scale,
  Send,
  Sparkles,
  Target,
} from "lucide-react";
import BrandHeader from "@/components/BrandHeader";
import { databaseMeta, ingredients, menuRecipes } from "@/lib/database";

/**
 * Public landing page.
 *
 * The product's real edge is that its numbers are honest: most are verified
 * against USDA FoodData Central, the rest are visibly labelled as estimates,
 * and portions are counted the way a kitchen counts them. That is the centre of
 * the page rather than a footnote — and every figure is derived from the
 * shipped database, so the page cannot claim more than the app knows.
 */
export const metadata = {
  title: "Mamma Calories — Eat at Negrita, hit your macros",
  description:
    "Plan your week from the real Negrita menu with verified nutrition, then send it to the kitchen to prepare.",
};

const STEPS = [
  {
    icon: Target,
    title: "Set your targets",
    body: "Calories and macros for a normal day. Or skip it — you can plan on feel and check the numbers after.",
  },
  {
    icon: CalendarRange,
    title: "Build your week",
    body: "Fill each meal slot from the menu, or let the planner assemble a week that lands on your targets.",
  },
  {
    icon: Send,
    title: "Send it to the kitchen",
    body: "Submit your week and Negrita preps it, day by day — pickup or delivery, whichever suits each day.",
  },
];

/**
 * Counted from the shipped database rather than written down, so the page
 * cannot claim more than the app actually knows. The distinction matters: most
 * of the catalogue is USDA-verified, and the remainder is *flagged* as an
 * estimate in the UI rather than quietly presented as fact.
 */
const VERIFIED_COUNT = ingredients.filter(
  (i) => i.source_status === "verified_usda"
).length;

const PROOF = [
  {
    icon: Scale,
    title: "Real portions",
    body: "Count food the way a kitchen does — two large eggs, one pita, a tablespoon of oil — not grams you have to estimate.",
  },
  {
    icon: ChefHat,
    title: "House recipes",
    body: "Negrita's own sauces and blends are entered from the real batch, so a dish built on them is exact rather than estimated.",
  },
  {
    icon: Sparkles,
    title: "Auto-fill a week",
    body: "Give it your targets and what you like. If a slot cannot be filled honestly it is left empty and flagged, never padded to make the total look right.",
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
            Eat at Negrita.
            <br />
            Hit your macros.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-charcoal-soft">
            Plan a week of real food from the Negrita menu, see exactly what it
            delivers, and have the kitchen prepare it. No weighing, no logging,
            no cooking.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/plan"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-tomato px-6 py-3 text-base font-700 text-cream shadow-card transition-colors hover:bg-tomato-dark"
            >
              Get started <ArrowRight size={18} />
            </Link>
            <Link
              href="#how"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-cream-deep bg-white px-6 py-3 text-base font-600 text-charcoal transition-colors hover:border-tomato-soft"
            >
              See how it works
            </Link>
          </div>
          <p className="mt-3 text-xs text-charcoal-soft">
            No account needed to start planning.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-cream-deep bg-cream-deep/40">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
            How it works
          </h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <li key={step.title} className="flex flex-col gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl2 bg-tomato text-cream shadow-card">
                    <Icon size={20} strokeWidth={2.2} />
                  </span>
                  <h3 className="font-display text-lg font-700 text-charcoal">
                    <span className="text-tomato">{index + 1}.</span> {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-charcoal-soft">
                    {step.body}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Why the numbers hold up */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <h2 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
              Numbers you can actually trust
            </h2>
            <p className="mt-3 leading-relaxed text-charcoal-soft">
              Most macro apps guess, and never tell you when they are guessing.
              Here, {VERIFIED_COUNT} of the {ingredients.length} ingredients
              Negrita cooks with are verified against USDA FoodData Central. The
              rest are marked <b className="text-gold">est</b> everywhere they
              appear, so you always know which numbers are solid.
            </p>
            <dl className="mt-6 grid grid-cols-3 gap-4">
              <div>
                <dt className="text-[11px] font-600 uppercase tracking-wide text-charcoal-soft">
                  USDA-verified
                </dt>
                <dd className="font-display text-2xl font-700 tabular-nums text-basil">
                  {VERIFIED_COUNT}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-600 uppercase tracking-wide text-charcoal-soft">
                  Ingredients
                </dt>
                <dd className="font-display text-2xl font-700 tabular-nums text-tomato">
                  {ingredients.length}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-600 uppercase tracking-wide text-charcoal-soft">
                  Menu dishes
                </dt>
                <dd className="font-display text-2xl font-700 tabular-nums text-tomato">
                  {menuRecipes.length}
                </dd>
              </div>
            </dl>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {PROOF.map((item) => {
              const Icon = item.icon;
              return (
                <li
                  key={item.title}
                  className="flex gap-3 rounded-xl2 border border-cream-deep bg-white/70 p-4 shadow-card"
                >
                  <Icon size={18} className="mt-0.5 shrink-0 text-tomato" />
                  <div>
                    <h3 className="font-600 text-charcoal">{item.title}</h3>
                    <p className="mt-0.5 text-sm text-charcoal-soft">{item.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
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
              Build your week now — nothing is saved to an account until you want
              it to be. When it is ready, send it to the kitchen.
            </p>
          </div>
          <Link
            href="/plan"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-tomato px-6 py-3 text-base font-700 text-cream transition-colors hover:bg-tomato-dark"
          >
            Get started <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-charcoal-soft sm:px-6">
        <p>
          Nutrition data: {databaseMeta.name} (v{databaseMeta.version}). Verified
          entries were checked against USDA FoodData Central; estimated entries
          are flagged as such throughout the app.
        </p>
      </footer>
    </div>
  );
}

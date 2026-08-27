import { DAY_SHORT } from "@/lib/clients";

/**
 * The example week shown on the public landing page.
 *
 * Marketing pages drift into lies quietly: a dish gets re-costed, a macro is
 * corrected, and the "example" week on the front page keeps quoting numbers the
 * kitchen no longer serves. So this week is not prose — it is data, checked by
 * `landingWeek.test.ts` against the shipped catalog on every run. If a dish is
 * renamed or its macros move, the test fails and the page has to be corrected
 * rather than silently misleading someone.
 *
 * Two deliberate limits on what it claims:
 *
 * 1. **Calories and protein only.** The planner grades a day on all four macros
 *    at the tolerances in `dailyAdherence.ts`, and it clears that bar by
 *    composing plates from the ingredient catalog. Seven menu-only days cannot
 *    clear it — so this week does not pretend to. It shows the two numbers it
 *    genuinely lands, and the section copy claims nothing more.
 * 2. **Menu dishes only.** Every cell is a real dish someone can order, not a
 *    composed plate, so each figure here is one a diner is actually sold.
 */
export const LANDING_WEEK_TARGET = Object.freeze({
  energy_kcal: 2250,
  protein_g: 195,
});

/** The slots this example uses. Snack is optional, and most days do without it. */
export const LANDING_WEEK_SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"] as const;

export type LandingWeekSlot = (typeof LANDING_WEEK_SLOTS)[number];

export interface LandingWeekMeal {
  slot: LandingWeekSlot;
  /** Must match a menu recipe name in the catalog exactly; the test enforces it. */
  dish: string;
  /** Shortened for a narrow column. The full name still has to resolve. */
  short: string;
  energy_kcal: number;
  protein_g: number;
}

export interface LandingWeekDay {
  day: string;
  meals: LandingWeekMeal[];
  energy_kcal: number;
  protein_g: number;
}

const meal = (
  slot: LandingWeekSlot,
  dish: string,
  short: string,
  energy_kcal: number,
  protein_g: number
): LandingWeekMeal => ({ slot, dish, short, energy_kcal, protein_g });

function day(name: string, meals: LandingWeekMeal[]): LandingWeekDay {
  return {
    day: name,
    meals,
    energy_kcal: meals.reduce((sum, m) => sum + m.energy_kcal, 0),
    protein_g: meals.reduce((sum, m) => sum + m.protein_g, 0),
  };
}

export const LANDING_WEEK: readonly LandingWeekDay[] = Object.freeze([
  day(DAY_SHORT[0], [
    meal("Breakfast", "Cheese Cake (Cottage Cheese 100 g)", "Cheese Cake", 265, 31),
    meal("Lunch", "Bulking (300 g Chicken)", "Bulking", 755, 90),
    meal("Dinner", "Thai Boy - Beefy", "Thai Boy — Beefy", 800, 60),
    meal("Snack", "Before Cardio", "Before Cardio", 480, 20),
  ]),
  day(DAY_SHORT[1], [
    meal("Breakfast", "Cheese Cake (Cottage Cheese 100 g)", "Cheese Cake", 265, 31),
    meal("Lunch", "Chicken Pita (300 g Chicken)", "Chicken Pita", 855, 91),
    meal("Dinner", "The Beef Ritual Burger", "Beef Ritual Burger", 1105, 70),
  ]),
  day(DAY_SHORT[2], [
    meal("Breakfast", "Protein Banana Bread 120 g Portion", "Protein Banana Bread", 675, 26),
    meal("Lunch", "Bulking (300 g Chicken)", "Bulking", 755, 90),
    meal("Dinner", "Peri Peri Chicken (300 g Chicken)", "Peri Peri Chicken", 765, 85),
  ]),
  day(DAY_SHORT[3], [
    meal("Breakfast", "Special Protein Pancake", "Protein Pancake", 1095, 50),
    meal("Lunch", "Geisha (300 g Chicken)", "Geisha", 580, 80),
    meal("Dinner", "Chicken Teriyaki with Buckwheat", "Chicken Teriyaki", 545, 63),
  ]),
  day(DAY_SHORT[4], [
    meal("Breakfast", "Protein Bountiful Fruit Waffle", "Fruit Waffle", 1175, 52),
    meal("Lunch", "Thai Boy - Chicky", "Thai Boy — Chicky", 765, 91),
    meal("Dinner", "Bluefin Tuna Tataki with Buckwheat", "Bluefin Tuna Tataki", 365, 46),
  ]),
  day(DAY_SHORT[5], [
    meal("Breakfast", "Oatmeal Bowl - Banana Peanut Butter Protein", "Oatmeal — Banana PB", 1095, 63),
    meal("Lunch", "Geisha (300 g Chicken)", "Geisha", 580, 80),
    meal("Dinner", "Recovery Salmon (200 g Salmon Teriyaki)", "Recovery Salmon", 665, 46),
  ]),
  day(DAY_SHORT[6], [
    meal("Breakfast", "Oatmeal Bowl - Baked Apple Cinnamon Protein", "Oatmeal — Apple Cinnamon", 1085, 62),
    meal("Lunch", "Breakfast Protein Burrito (250 g Chicken)", "Protein Burrito", 600, 68),
    meal("Dinner", "Bali Boy (200 g Chicken)", "Bali Boy", 615, 60),
  ]),
]);

/** How many distinct dishes the week draws on, for the copy that cites it. */
export const LANDING_WEEK_DISH_COUNT = new Set(
  LANDING_WEEK.flatMap((d) => d.meals.map((m) => m.dish))
).size;

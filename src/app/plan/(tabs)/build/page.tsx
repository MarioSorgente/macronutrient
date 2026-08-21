import IngredientPicker from "@/components/IngredientPicker";
import DishBuilder from "@/components/DishBuilder";

export default function BuilderPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
          Build a dish
        </h1>
        <p className="mt-1 text-sm text-charcoal-soft">
          Pick ingredients, set the grams for each, and watch the macros add up.
          Save it and generate a printable report.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <IngredientPicker />
        <DishBuilder />
      </div>
    </main>
  );
}

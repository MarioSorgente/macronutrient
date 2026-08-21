import SavedDishList from "@/components/SavedDishList";

export default function DishesPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
          Saved dishes
        </h1>
        <p className="mt-1 text-sm text-charcoal-soft">
          Open a dish to keep editing it, or generate its report.
        </p>
      </div>
      <SavedDishList />
    </main>
  );
}

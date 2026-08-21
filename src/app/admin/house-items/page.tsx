import HouseItemList from "@/components/HouseItemList";

export const metadata = { title: "House items — Mamma Calories" };

export default function HouseItemsPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
          House items
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-charcoal-soft">
          These are Negrita&apos;s own sauces, blends and bakes. They ship with
          estimated values because no public database contains them — entering
          the real batch recipe makes them exact everywhere in the app.
        </p>
      </div>
      <HouseItemList />
    </main>
  );
}

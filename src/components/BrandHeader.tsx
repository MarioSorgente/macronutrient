import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";

export type NavKey = "builder" | "dishes" | "clients" | "coaches" | "house";

/**
 * "Clients" and "For coaches" are the same screen in two modes, not two data
 * silos — the coach link just lands in coach mode.
 */
const LINKS: { key: NavKey; href: string; label: string }[] = [
  { key: "builder", href: "/", label: "Builder" },
  { key: "dishes", href: "/dishes", label: "Dishes" },
  { key: "clients", href: "/clients", label: "Clients" },
  { key: "coaches", href: "/clients?mode=coach", label: "For coaches" },
  { key: "house", href: "/house-items", label: "House items" },
];

/**
 * App shell header. "Mamma Calories" is the product brand; "For Negrita" is the
 * customer skin. Nav is hidden in print output.
 */
export default function BrandHeader({ active }: { active?: NavKey }) {
  return (
    <header className="no-print sticky top-0 z-20 border-b border-cream-deep bg-cream/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl2 bg-tomato text-cream shadow-card">
            <UtensilsCrossed size={20} strokeWidth={2.2} />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-xl font-700 text-charcoal">
              Mamma Calories
            </span>
            <span className="block text-[11px] font-600 uppercase tracking-[0.18em] text-tomato">
              For Negrita
            </span>
          </span>
        </Link>

        <nav className="scroll-slim -mx-1 flex items-center gap-1 overflow-x-auto px-1 text-sm font-600">
          {LINKS.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              className={
                "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 transition-colors " +
                (active === link.key
                  ? "bg-tomato text-cream"
                  : "text-charcoal-soft hover:bg-cream-deep hover:text-charcoal")
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

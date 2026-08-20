import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";

/**
 * App shell header. "Mamma Calories" is the product brand; "For Negrita" is the
 * customer skin. Nav is hidden in print output.
 */
export default function BrandHeader({
  active,
}: {
  active?: "builder" | "dishes";
}) {
  return (
    <header className="no-print border-b border-cream-deep bg-cream/80 backdrop-blur sticky top-0 z-20">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-center gap-3">
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

        <nav className="flex items-center gap-1 text-sm font-600">
          <NavLink href="/" label="Builder" isActive={active === "builder"} />
          <NavLink
            href="/dishes"
            label="Saved dishes"
            isActive={active === "dishes"}
          />
        </nav>
      </div>
    </header>
  );
}

function NavLink({
  href,
  label,
  isActive,
}: {
  href: string;
  label: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "rounded-lg px-3 py-1.5 transition-colors " +
        (isActive
          ? "bg-tomato text-cream"
          : "text-charcoal-soft hover:bg-cream-deep hover:text-charcoal")
      }
    >
      {label}
    </Link>
  );
}

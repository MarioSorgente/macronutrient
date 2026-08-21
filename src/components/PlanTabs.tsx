"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarRange, Hammer, Library, Send } from "lucide-react";
import { cn } from "@/components/ui/cn";

const TABS = [
  { href: "/plan", label: "My week", icon: CalendarRange },
  { href: "/plan/build", label: "Build a dish", icon: Hammer },
  { href: "/plan/dishes", label: "Saved dishes", icon: Library },
  { href: "/plan/submit", label: "Send to kitchen", icon: Send },
];

/**
 * Sub-navigation for the Plan & Build section. Real routes rather than local
 * tab state, so each view is linkable and the back button behaves.
 */
export default function PlanTabs() {
  const pathname = usePathname() ?? "/plan";

  return (
    <div className="no-print border-b border-cream-deep bg-cream">
      <nav className="scroll-slim mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-600 transition-colors",
                active
                  ? "border-tomato text-tomato"
                  : "border-transparent text-charcoal-soft hover:text-charcoal"
              )}
            >
              <Icon size={15} />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

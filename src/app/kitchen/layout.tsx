import type { ReactNode } from "react";
import BrandHeader from "@/components/BrandHeader";

/**
 * The kitchen area.
 *
 * Both the sign-in requirement and the staff-role requirement come from
 * RouteGuard in the root layout, which reads them from the route policy table.
 * A customer who lands here is offered the staff-access flow rather than a
 * locked door. The real boundary remains firestore.rules, which denies the
 * prep-task reads outright.
 */
export default function KitchenLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <BrandHeader />
      {children}
    </div>
  );
}

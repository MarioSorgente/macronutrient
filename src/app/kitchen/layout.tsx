import type { ReactNode } from "react";
import BrandHeader from "@/components/BrandHeader";
import RequireRole from "@/components/RequireRole";

/**
 * The kitchen area. The gate here keeps a customer from watching the board
 * render before being redirected; the real boundary is firestore.rules, which
 * denies the prep-task reads outright.
 */
export default function KitchenLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <BrandHeader />
      <RequireRole allow={["restaurant", "admin"]}>{children}</RequireRole>
    </div>
  );
}

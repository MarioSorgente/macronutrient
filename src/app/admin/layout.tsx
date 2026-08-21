import type { ReactNode } from "react";
import BrandHeader from "@/components/BrandHeader";
import RequireRole from "@/components/RequireRole";

/**
 * Staff area.
 *
 * The gate here is for presentation — it keeps a client from watching the page
 * render before being redirected. The real boundary is firestore.rules, which
 * denies the underlying reads whatever this renders. The owner dashboard adds a
 * stricter admin-only check of its own.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <BrandHeader />
      <RequireRole allow={["restaurant", "admin"]}>{children}</RequireRole>
    </div>
  );
}

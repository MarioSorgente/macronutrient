import type { ReactNode } from "react";
import BrandHeader from "@/components/BrandHeader";

/**
 * Staff area.
 *
 * Authentication and the staff-role check are applied centrally by RouteGuard;
 * the owner dashboard and settings add a stricter admin-only check of their
 * own. The real boundary is firestore.rules, which denies the underlying reads
 * whatever renders here.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <BrandHeader />
      {children}
    </div>
  );
}

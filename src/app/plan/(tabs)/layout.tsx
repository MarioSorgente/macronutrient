import type { ReactNode } from "react";
import BrandHeader from "@/components/BrandHeader";
import PlanTabs from "@/components/PlanTabs";

/**
 * Shell for the one place a diner works: the week, the dish builder and the
 * dishes they have saved. These are three views of the same job, so they share
 * a destination and switch with tabs instead of living in the top nav.
 *
 * The printable report sits outside this group — it brings its own chrome.
 */
export default function PlanLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <BrandHeader />
      <PlanTabs />
      {children}
    </div>
  );
}

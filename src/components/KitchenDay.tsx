"use client";

import { useParams } from "next/navigation";
import KitchenBoard from "@/components/KitchenBoard";
import { parseCalendarDate } from "@/lib/format";

/**
 * Reads the date from the route so KitchenBoard stays a pure presentation of
 * one day.
 *
 * Validated as a real calendar date rather than by shape: "2026-02-31" matches
 * yyyy-mm-dd but does not exist, and the board immediately feeds the date to
 * `addDays` for its previous/next links, which throws on one that cannot be
 * parsed. A hand-typed URL should land on today, not on a blank screen.
 */
export default function KitchenDay() {
  const params = useParams<{ date: string }>();
  const date = params?.date;
  return (
    <KitchenBoard date={parseCalendarDate(date) ? (date as string) : undefined} />
  );
}

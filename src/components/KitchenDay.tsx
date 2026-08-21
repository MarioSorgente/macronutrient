"use client";

import { useParams } from "next/navigation";
import KitchenBoard from "@/components/KitchenBoard";

/** Reads the date from the route so KitchenBoard stays a pure presentation of one day. */
export default function KitchenDay() {
  const params = useParams<{ date: string }>();
  const date = params?.date;
  const valid = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return <KitchenBoard date={valid ? date : undefined} />;
}

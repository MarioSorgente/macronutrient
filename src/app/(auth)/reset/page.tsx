import { Suspense } from "react";
import AuthForm from "@/components/auth/AuthForm";

export const metadata = { title: "Reset — Mamma Calories" };

export default function ResetPage() {
  // AuthForm reads ?next= via useSearchParams, which needs a Suspense boundary
  // for this route to stay statically rendered.
  return (
    <Suspense>
      <AuthForm mode="reset" />
    </Suspense>
  );
}

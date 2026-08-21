import { Suspense } from "react";
import AuthForm from "@/components/auth/AuthForm";

export const metadata = { title: "Login — Mamma Calories" };

export default function LoginPage() {
  // AuthForm reads ?next= via useSearchParams, which needs a Suspense boundary
  // for this route to stay statically rendered.
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}

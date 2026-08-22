import BrandHeader from "@/components/BrandHeader";
import AccountAccess from "@/components/AccountAccess";

export const metadata = { title: "Account & access — Mamma Calories" };

export default function AccountPage() {
  return (
    <div className="min-h-screen">
      <BrandHeader />
      <AccountAccess />
    </div>
  );
}

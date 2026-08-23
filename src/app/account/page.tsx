import BrandHeader from "@/components/BrandHeader";
import AccountAccess from "@/components/AccountAccess";
import StaffAccessStatus from "@/components/StaffAccessStatus";

export const metadata = { title: "Account & access — Mamma Calories" };

export default function AccountPage() {
  return (
    <div className="min-h-screen">
      <BrandHeader />
      <div className="mx-auto max-w-3xl px-4 sm:px-6"><StaffAccessStatus /></div>
      <AccountAccess />
    </div>
  );
}

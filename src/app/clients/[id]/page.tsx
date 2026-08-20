import BrandHeader from "@/components/BrandHeader";
import ClientPlanner from "@/components/ClientPlanner";

export default function ClientPlannerPage() {
  return (
    <div className="min-h-screen">
      <BrandHeader active="clients" />
      <ClientPlanner />
    </div>
  );
}

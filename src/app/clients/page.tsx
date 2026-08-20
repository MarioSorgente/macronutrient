import BrandHeader from "@/components/BrandHeader";
import ClientList from "@/components/ClientList";

export default function ClientsPage() {
  return (
    <div className="min-h-screen">
      <BrandHeader active="clients" />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
            Clients
          </h1>
          <p className="mt-1 text-sm text-charcoal-soft">
            Plan a client&apos;s meals week by week, then generate their report.
          </p>
        </div>
        <ClientList />
      </main>
    </div>
  );
}

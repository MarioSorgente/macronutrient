import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { ToastProvider } from "@/components/ui/Toast";
import GuestDataClaim from "@/components/GuestDataClaim";
import RouteGuard from "@/components/RouteGuard";
import ViewAsBanner from "@/components/ViewAsBanner";
import { Analytics } from "@vercel/analytics/next";

const display = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mamma Calories — For Negrita",
  description:
    "Build dishes from Negrita's ingredients, calculate macros, and generate reports.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="font-sans antialiased">
        <AuthProvider>
          <ToastProvider>
            {/* House recipes are loaded by the views that need them, not
                globally — the landing page has no use for them. */}
            <GuestDataClaim />
            <ViewAsBanner />
            {/* Every route except the landing page and the auth screens needs an
                account. Gating here rather than per page is the point: a new
                screen is protected by existing, not by remembering to ask. */}
            <RouteGuard>{children}</RouteGuard>
          </ToastProvider>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import HouseRecipeLoader from "@/components/HouseRecipeLoader";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { ToastProvider } from "@/components/ui/Toast";
import GuestDataClaim from "@/components/GuestDataClaim";

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
            <HouseRecipeLoader />
            <GuestDataClaim />
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

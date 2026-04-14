import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppChrome } from "@/components/AppChrome";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "NeighborHealth",
  description: "Housing and health equity prioritization for nonprofits and planners",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} min-h-screen bg-slate-50 font-sans text-slate-900 antialiased`}>
        <AppChrome />
        <main>{children}</main>
      </body>
    </html>
  );
}

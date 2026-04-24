import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { AppChrome } from "@/components/AppChrome";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

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
      <body
        className={`${inter.variable} ${display.variable} min-h-screen bg-nh-cream font-sans text-nh-ink antialiased`}
      >
        <AppChrome />
        <main>{children}</main>
      </body>
    </html>
  );
}

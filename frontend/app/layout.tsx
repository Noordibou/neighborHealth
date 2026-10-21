import type { Metadata } from "next";
import { Newsreader, Public_Sans } from "next/font/google";
import { AppChrome } from "@/components/AppChrome";
import "./globals.css";

const sans = Public_Sans({ subsets: ["latin"], variable: "--font-sans" });
const display = Newsreader({
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
        className={`${sans.variable} ${display.variable} min-h-screen bg-nh-cream font-sans text-nh-ink antialiased`}
      >
        <AppChrome />
        <main>{children}</main>
      </body>
    </html>
  );
}

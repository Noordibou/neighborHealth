"use client";

import Link from "next/link";
import { BrandWordmark } from "@/components/BrandMark";

const nav = [
  { href: "/explore", label: "Map Explorer" },
  { href: "/#methodology", label: "Methods & data" },
  { href: "/about", label: "About" },
];

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-nh-brown/10 bg-nh-cream/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:py-3.5 md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="flex items-center justify-between gap-3 md:contents">
          <BrandWordmark />
          <div className="flex shrink-0 items-center gap-2 md:order-3 md:justify-end">
            <Link
              href="#"
              className="hidden rounded-lg border border-nh-brown/20 px-3 py-2 text-sm font-medium text-nh-brown sm:inline-block"
              onClick={(e) => e.preventDefault()}
            >
              Sign In
            </Link>
            <Link
              href="/explore"
              className="rounded-lg bg-nh-brown px-3 py-2 text-sm font-semibold text-nh-cream shadow-sm transition hover:bg-nh-brown/90"
            >
              Open explorer →
            </Link>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-1 border-t border-nh-brown/10 pt-3 [-webkit-overflow-scrolling:touch] md:order-2 md:flex-1 md:justify-center md:border-t-0 md:pt-0">
          {nav.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-lg px-2.5 py-2 text-xs font-medium text-nh-brown-muted transition hover:bg-white/80 hover:text-nh-brown sm:px-3 sm:text-sm"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

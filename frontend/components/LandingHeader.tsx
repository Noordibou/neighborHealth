"use client";

import Link from "next/link";
import { BrandWordmark } from "@/components/BrandMark";

const nav = [
  { href: "/explore", label: "Map Explorer" },
  { href: "/#methodology", label: "Methodology" },
  { href: "/#sources", label: "Data sources" },
  { href: "/about", label: "About" },
];

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-nh-brown/10 bg-nh-cream/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5">
        <BrandWordmark />
        <nav className="hidden items-center gap-1 md:flex">
          {nav.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-md px-3 py-2 text-sm font-medium text-nh-brown-muted transition hover:bg-white/80 hover:text-nh-brown"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
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
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandWordmark } from "@/components/BrandMark";

const nav = [
  { href: "/explore", label: "Map Explorer" },
  { href: "/#methodology", label: "Methodology" },
  { href: "/#sources", label: "Data sources" },
  { href: "/about", label: "About" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-nh-brown/10 bg-nh-cream/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5">
        <BrandWordmark />
        <nav className="hidden items-center gap-1 lg:flex">
          {nav.map(({ href, label }) => {
            const active = pathname === href.split("#")[0] && href.startsWith("/explore");
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                  active ? "bg-white text-nh-brown shadow-sm" : "text-nh-brown-muted hover:bg-white/70 hover:text-nh-brown"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/compare"
            className={`hidden rounded-md px-2 py-2 text-sm font-medium sm:inline-block ${
              pathname === "/compare" ? "text-nh-terracotta" : "text-nh-brown-muted hover:text-nh-brown"
            }`}
          >
            Compare
          </Link>
          <Link
            href="#"
            className="hidden rounded-lg border border-nh-brown/20 px-3 py-2 text-sm font-medium text-nh-brown md:inline-block"
            onClick={(e) => e.preventDefault()}
          >
            Sign In
          </Link>
          <Link
            href="/explore"
            className="rounded-lg bg-nh-brown px-3 py-2 text-sm font-semibold text-nh-cream shadow-sm hover:bg-nh-brown/90"
          >
            Open explorer →
          </Link>
        </div>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-nh-brown/10 bg-nh-cream/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5">
        <BrandWordmark />

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
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
            href="/explore"
            className="rounded-lg bg-nh-brown px-3 py-2 text-sm font-semibold text-nh-cream shadow-sm hover:bg-nh-brown/90"
          >
            Open explorer →
          </Link>
          {/* Mobile hamburger */}
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-nh-brown-muted hover:bg-nh-cream md:hidden"
          >
            {menuOpen ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <nav className="border-t border-nh-brown/10 bg-nh-cream/98 px-4 pb-4 pt-2 md:hidden">
          <ul className="space-y-1">
            {nav.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-3 py-3 text-sm font-medium text-nh-brown hover:bg-white/70"
                >
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/compare"
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-3 text-sm font-medium text-nh-brown hover:bg-white/70"
              >
                Compare
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}

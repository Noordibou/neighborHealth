"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/explore", label: "Explore" },
  { href: "/compare", label: "Compare" },
  { href: "/about", label: "About" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-3.5">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-[#0f2940]">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600 text-white" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </span>
          NeighborHealth
        </Link>
        <nav className="flex items-center gap-1 text-sm font-medium text-slate-600">
          {nav.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-md px-3 py-2 transition-colors hover:bg-teal-50 hover:text-teal-900 ${
                  active ? "bg-teal-100/90 text-teal-900" : ""
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <Link href="#" className="text-sm font-medium text-slate-500 hover:text-slate-800" onClick={(e) => e.preventDefault()}>
          Sign In
        </Link>
      </div>
    </header>
  );
}

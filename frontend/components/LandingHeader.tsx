"use client";

import Link from "next/link";

/** Minimal header for marketing home: logo + About + Sign In (no app nav). */
export function LandingHeader() {
  return (
    <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
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
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
          <Link href="/about" className="hover:text-teal-800">
            About
          </Link>
          <Link href="#" className="text-slate-500 hover:text-slate-800" onClick={(e) => e.preventDefault()}>
            Sign In
          </Link>
        </nav>
      </div>
    </header>
  );
}

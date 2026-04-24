import Link from "next/link";

/** Logo mark from product mock: triangle in a circle. */
export function BrandIcon({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-nh-brown/20 bg-nh-cream ${className}`}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" className="h-[55%] w-[55%] text-nh-terracotta" fill="currentColor">
        <circle cx="16" cy="16" r="14" className="fill-none stroke-current stroke-[1.5]" />
        <path d="M16 8 L23 22 H9 Z" />
      </svg>
    </span>
  );
}

export function BetaBadge() {
  return (
    <span className="rounded border border-nh-brown/15 bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-nh-brown/70">
      Beta
    </span>
  );
}

export function BrandWordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-nh-brown">
      <BrandIcon />
      <span className="flex items-center gap-2">
        NeighborHealth
        <BetaBadge />
      </span>
    </Link>
  );
}

import Link from "next/link";

/** Four census parcels; one cell carries the index color. */
export function BrandIcon({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center border border-nh-brown/30 bg-nh-cream ${className}`}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" className="h-[78%] w-[78%]">
        <rect x="2" y="2" width="13" height="13" className="fill-nh-sand stroke-nh-brown" strokeWidth="1.25" />
        <rect x="17" y="2" width="13" height="13" className="fill-nh-terracotta stroke-nh-brown" strokeWidth="1.25" />
        <rect x="2" y="17" width="13" height="13" className="fill-white stroke-nh-brown" strokeWidth="1.25" />
        <rect x="17" y="17" width="13" height="13" className="fill-nh-brown stroke-nh-brown" strokeWidth="1.25" />
      </svg>
    </span>
  );
}

export function BetaBadge() {
  return (
    <span className="rounded-md border border-nh-brown/25 px-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-nh-brown/70">
      Beta
    </span>
  );
}

export function BrandWordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-nh-brown">
      <BrandIcon />
      <span className="flex items-center gap-2">
        <span className="font-display text-[1.15rem] font-medium tracking-tight">NeighborHealth</span>
        <BetaBadge />
      </span>
    </Link>
  );
}

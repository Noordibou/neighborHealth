import Link from "next/link";

type Props = { variant?: "light" | "dark" };

export function SiteFooter({ variant = "light" }: Props) {
  if (variant === "dark") {
    return (
      <footer className="bg-nh-brown text-nh-cream/90">
        <div className="mx-auto max-w-7xl px-4 py-14">
          <div className="grid gap-12 md:grid-cols-[1.2fr_2fr]">
            <div>
              <p className="font-display text-xl font-semibold text-white">NeighborHealth</p>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-nh-cream/75">
                Civic-tech project mapping open methodology from HUD housing stressors and CDC PLACES health estimates
                into a single prioritization lens for outreach and planning.
              </p>
            </div>
            <div className="grid gap-10 sm:grid-cols-3" id="sources">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-nh-cream/50">Data sources</p>
                <ul className="mt-3 space-y-2 text-sm text-nh-cream/80">
                  <li>CDC PLACES (tract)</li>
                  <li>HUD CHAS / ACS housing</li>
                  <li>U.S. Census ACS</li>
                  <li>State health dept. context</li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-nh-cream/50">Product</p>
                <ul className="mt-3 space-y-2 text-sm">
                  <li>
                    <Link href="/explore" className="text-nh-cream/85 hover:text-white hover:underline">
                      Map explorer
                    </Link>
                  </li>
                  <li>
                    <Link href="/#methodology" className="text-nh-cream/85 hover:text-white hover:underline">
                      Methodology
                    </Link>
                  </li>
                  <li>
                    <span className="text-nh-cream/45">API access</span>
                  </li>
                  <li>
                    <span className="text-nh-cream/45">Changelog</span>
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-nh-cream/50">Org</p>
                <ul className="mt-3 space-y-2 text-sm">
                  <li>
                    <Link href="/about" className="text-nh-cream/85 hover:text-white hover:underline">
                      About
                    </Link>
                  </li>
                  <li>
                    <span className="text-nh-cream/45">Contact</span>
                  </li>
                  <li>
                    <span className="text-nh-cream/45">Partners</span>
                  </li>
                  <li>
                    <span className="text-nh-cream/45">Press kit</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-8 text-xs text-nh-cream/55 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} NeighborHealth — CC BY-NC 4.0</p>
            <p className="font-mono text-[11px] text-nh-cream/40">v2.0.1 · local build</p>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="border-t border-nh-brown/10 bg-white/60">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-md">
            <p className="font-semibold text-nh-brown">NeighborHealth</p>
            <p className="mt-2 text-sm leading-relaxed text-nh-brown-muted">
              Prioritizing housing stability and health equity for nonprofits and local planners using public data.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-nh-brown-muted">Data sources</p>
            <ul className="mt-2 space-y-1 text-sm text-nh-brown-muted">
              <li>CDC PLACES</li>
              <li>U.S. Census Bureau ACS</li>
              <li>HUD (housing context)</li>
            </ul>
          </div>
        </div>
        <p className="mt-8 text-xs text-nh-brown-muted/70">
          © {new Date().getFullYear()} NeighborHealth. For research and planning purposes only.
        </p>
        <p className="mt-1 text-xs">
          <Link href="/explore" className="font-medium text-nh-terracotta hover:underline">
            Explore map
          </Link>
        </p>
      </div>
    </footer>
  );
}

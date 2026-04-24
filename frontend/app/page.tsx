import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-nh-cream text-nh-brown">
      <section className="border-b border-nh-brown/10">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 lg:grid-cols-2 lg:items-center lg:py-20">
          <div>
            <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-nh-brown md:text-5xl">
              Find where housing stress and{" "}
              <span className="text-nh-terracotta italic">health risk overlap.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-nh-brown-muted">
              NeighborHealth combines HUD housing indicators and CDC PLACES health estimates into a composite
              prioritization index—so outreach teams can see where to focus first.
            </p>
            <form action="/explore" method="get" className="mt-8">
              <div className="flex flex-col gap-2 rounded-2xl border border-nh-brown/10 bg-white p-1.5 shadow-sm sm:flex-row sm:items-center">
                <div className="relative flex min-w-0 flex-1 items-center pl-3">
                  <svg className="h-5 w-5 shrink-0 text-nh-brown-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    name="q"
                    type="search"
                    placeholder="Search by city, county, or census tract…"
                    className="min-w-0 flex-1 border-0 bg-transparent py-3 pl-2 pr-2 text-nh-brown placeholder:text-nh-brown-muted/70 focus:outline-none focus:ring-0"
                  />
                </div>
                <button
                  type="submit"
                  className="shrink-0 rounded-xl bg-nh-terracotta px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-nh-terracotta-dark"
                >
                  Explore →
                </button>
              </div>
            </form>
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-nh-brown-muted">
              <span className="font-semibold uppercase tracking-wide text-nh-brown/50">Try:</span>
              {["Philadelphia, PA", "19134", "Tract 42101018800", "Kensington"].map((t) => (
                <Link
                  key={t}
                  href={`/explore?q=${encodeURIComponent(t)}`}
                  className="rounded-full border border-nh-brown/10 bg-white px-3 py-1 text-xs font-medium text-nh-brown transition hover:border-nh-terracotta hover:text-nh-terracotta"
                >
                  {t}
                </Link>
              ))}
            </p>
            <dl className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
              {[
                { k: "Tracts analyzed", v: "73,056" },
                { k: "Indicators", v: "18" },
                { k: "Last refresh", v: "Apr 2024" },
                { k: "Used by", v: "210 orgs" },
              ].map((row) => (
                <div key={row.k}>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-nh-brown-muted">{row.k}</dt>
                  <dd className="mt-1 font-display text-2xl font-semibold text-nh-brown">{row.v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative">
            <div className="overflow-hidden rounded-3xl border border-nh-brown/10 bg-white shadow-[0_24px_60px_rgba(44,24,16,0.12)]">
              <div
                className="relative aspect-[4/3] w-full bg-gradient-to-br from-nh-cream via-nh-sand to-nh-terracotta/25"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'%3E%3Cpath fill='%23c45c3e22' d='M40 200 L120 80 L200 140 L280 60 L360 120 L360 260 L40 260 Z'/%3E%3Cpath fill='%23b85c3a33' d='M60 220 L160 100 L240 160 L320 90 L340 200 L340 260 L60 260 Z'/%3E%3C/svg%3E")`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
                role="img"
                aria-label="Decorative map preview with shaded regions"
              />
              <div className="absolute left-4 top-4 rounded-full bg-white/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-nh-brown shadow">
                Live · Philadelphia County, PA
              </div>
              <div className="absolute bottom-4 left-4 rounded-lg border border-nh-brown/10 bg-white/95 px-3 py-2 text-[10px] shadow backdrop-blur-sm">
                <p className="font-semibold uppercase tracking-wide text-nh-brown-muted">Priority index</p>
                <p className="mt-1 font-mono text-[11px] text-nh-brown">0 — 100 scale</p>
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-nh-brown-muted">
              Illustrative preview — open the explorer for live data in your states.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16">
        <div className="grid gap-8 md:grid-cols-3">
          {[
            {
              title: "Identify high-risk neighborhoods",
              body: "Rank census tracts with a transparent composite of rent burden, insurance coverage, chronic conditions, overcrowding, and asthma burden.",
              href: "/explore",
            },
            {
              title: "Compare areas side by side",
              body: "Collect up to four tracts in the compare tray and open a side-by-side profile with charts and raw indicators.",
              href: "/compare",
            },
            {
              title: "Export reports for stakeholders",
              body: "Download tract PDF scorecards and CSV exports for grants and policy memos—with citations to public sources.",
              href: "/about",
            },
          ].map((card) => (
            <div
              key={card.title}
              className="flex flex-col rounded-2xl border border-nh-brown/10 bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <h2 className="text-lg font-semibold text-nh-brown">{card.title}</h2>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-nh-brown-muted">{card.body}</p>
              <Link href={card.href} className="mt-5 inline-flex text-sm font-semibold text-nh-terracotta hover:underline">
                Learn more →
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section id="methodology" className="border-t border-nh-brown/10 bg-white/60 py-16">
        <div className="mx-auto max-w-7xl px-4">
          <p className="text-xs font-bold uppercase tracking-widest text-nh-terracotta">Methodology</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-nh-brown">How the index is built.</h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-nh-brown-muted">
            Each tract receives a 0–100 score from publicly available housing and health indicators. We percentile-rank
            metrics within the comparison cohort, apply domain-informed weights, and surface the blend on the map and in
            exports.
          </p>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {[
              {
                n: "01",
                t: "Pull source data",
                d: "Ingest HUD CHAS / ACS housing fields and CDC PLACES tract estimates aligned by GEOID and vintage.",
              },
              {
                n: "02",
                t: "Normalize & weight",
                d: "Percentile-transform indicators, handle missing values explicitly, and combine with adjustable weights in the explorer.",
              },
              {
                n: "03",
                t: "Surface priorities",
                d: "Choropleth shading, ranked lists, tract profiles, and compare mode translate scores into action-ready views.",
              },
            ].map((s) => (
              <div key={s.n}>
                <p className="font-display text-3xl font-light text-nh-terracotta/80">{s.n}</p>
                <h3 className="mt-2 font-semibold text-nh-brown">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-nh-brown-muted">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter variant="dark" />
    </div>
  );
}

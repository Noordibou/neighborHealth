import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";

export default function LandingPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-white">
      <section className="relative overflow-hidden border-b border-slate-100">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 600'%3E%3Cpath fill='%230d9488' d='M120 180 L200 140 L280 160 L360 120 L440 150 L520 130 L600 170 L680 150 L760 190 L840 160 L900 200 L900 420 L100 420 Z'/%3E%3C/svg%3E")`,
            backgroundSize: "cover",
            backgroundPosition: "center 30%",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-4 pb-20 pt-16 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-[#0f2940] md:text-5xl">
            Find where housing stress and health risk overlap.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            NeighborHealth helps nonprofit planners and housing advocates explore the intersection of housing
            affordability and community health outcomes.
          </p>
          <form action="/explore" method="get" className="mx-auto mt-10 max-w-2xl">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-md">
              <svg className="h-5 w-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                name="q"
                type="search"
                placeholder="Search by city, county, or census tract"
                className="min-w-0 flex-1 border-0 bg-transparent text-[#0f2940] placeholder:text-slate-400 focus:outline-none focus:ring-0"
              />
              <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">
                Search
              </button>
            </div>
          </form>
          <p className="mt-4 text-sm text-slate-500">
            Or go straight to the{" "}
            <Link href="/explore" className="font-medium text-teal-700 hover:underline">
              interactive map
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16">
        <div className="grid gap-8 md:grid-cols-3">
          {[
            {
              title: "Identify high-risk neighborhoods",
              body: "See where housing cost burden, lack of insurance, and chronic disease converge at the census tract level.",
              icon: "pin",
            },
            {
              title: "Compare areas side by side",
              body: "Select multiple tracts and compare health and housing indicators with interactive charts and tables.",
              icon: "chart",
            },
            {
              title: "Export reports for stakeholders",
              body: "Download ready-to-share PDF scorecards and data exports for grant applications and policy briefs.",
              icon: "doc",
            },
          ].map((card) => (
            <div key={card.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-700">
                {card.icon === "pin" && (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                )}
                {card.icon === "chart" && (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 20V10M12 20V4M6 20v-6" />
                  </svg>
                )}
                {card.icon === "doc" && (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <path d="M12 18v-6M9 15h6" />
                  </svg>
                )}
              </div>
              <h2 className="mt-4 text-lg font-semibold text-[#0f2940]">{card.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-100 bg-slate-50/80 py-16">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center text-2xl font-bold text-[#0f2940]">How it works</h2>
          <div className="mt-10 grid gap-10 md:grid-cols-3">
            {[
              {
                step: "1",
                title: "Search",
                body: "Enter a city, county, or census tract to find your area of interest.",
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                ),
              },
              {
                step: "2",
                title: "Filter & explore",
                body: "Use filters to narrow results by rent burden, uninsured rate, and more.",
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M7 12h10M10 20h4" />
                  </svg>
                ),
              },
              {
                step: "3",
                title: "Report & act",
                body: "Download scorecards and share data-driven insights with your team.",
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                  </svg>
                ),
              },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teal-100 text-teal-800">{s.icon}</div>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-teal-700">Step {s.step}</p>
                <h3 className="mt-1 font-semibold text-[#0f2940]">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

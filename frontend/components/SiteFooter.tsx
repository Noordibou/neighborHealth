import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-md">
            <p className="font-semibold text-[#0f2940]">NeighborHealth</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Prioritizing housing stability and health equity for nonprofits and local planners using public data.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Data sources</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              <li>CDC PLACES</li>
              <li>U.S. Census Bureau ACS</li>
              <li>HUD (housing context)</li>
            </ul>
          </div>
        </div>
        <p className="mt-8 text-xs text-slate-400">© {new Date().getFullYear()} NeighborHealth. For research and planning purposes only.</p>
        <p className="mt-1 text-xs">
          <Link href="/explore" className="text-teal-700 hover:underline">
            Explore map
          </Link>
        </p>
      </div>
    </footer>
  );
}

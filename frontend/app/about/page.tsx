import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-[#0f2940]">About NeighborHealth</h1>
      <p className="mt-4 leading-relaxed text-slate-600">
        NeighborHealth helps nonprofit planners and housing advocates explore where housing affordability stress and
        community health burdens overlap at the census tract level. We combine CDC PLACES health estimates, Census ACS
        housing indicators, and a composite risk score so you can prioritize outreach and intervention.
      </p>
      <p className="mt-4">
        <Link href="/explore" className="font-medium text-teal-700 hover:underline">
          Open the map →
        </Link>
      </p>
    </div>
  );
}

import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-display text-3xl font-semibold text-nh-brown">About NeighborHealth</h1>
      <p className="mt-4 leading-relaxed text-nh-brown-muted">
        NeighborHealth helps nonprofit planners and housing advocates explore where housing affordability stress and
        community health burdens overlap at the census tract level. We combine CDC PLACES health estimates, Census ACS
        housing indicators, and a composite risk score so you can prioritize outreach and intervention.
      </p>
      <p className="mt-6">
        <Link href="/explore" className="font-semibold text-nh-terracotta hover:underline">
          Open the map →
        </Link>
      </p>
    </div>
  );
}

import { STATE_FIPS_TO_POSTAL } from "@/lib/geo";

/** Two-letter state code from FIPS (e.g. "06" → "CA"). */
export function statePostalFromFips(fips: string | null | undefined): string | null {
  if (fips == null || typeof fips !== "string") return null;
  const k = fips.padStart(2, "0").slice(0, 2);
  return STATE_FIPS_TO_POSTAL[k] ?? null;
}

/**
 * Headline + subline for map hover and tract detail cards — same rules as the map popover.
 */
export function formatTractHoverLocation(args: {
  name: string | null;
  place_name: string | null;
  county_name: string | null;
  statePostal: string | null;
}): { headline: string; subline: string | null } {
  const st = args.statePostal;
  const countyWithSt =
    args.county_name && st ? `${args.county_name}, ${st}` : args.county_name ?? (st ? st : null);

  if (args.place_name) {
    const parts: string[] = [];
    if (args.name) parts.push(args.name);
    if (countyWithSt) parts.push(countyWithSt);
    const sub = parts.length ? parts.join(" · ") : null;
    return { headline: args.place_name, subline: sub };
  }

  if (countyWithSt) {
    const sub = args.name && args.name !== countyWithSt ? args.name : null;
    return { headline: countyWithSt, subline: sub };
  }

  if (args.name) {
    return { headline: args.name, subline: st ? st : null };
  }

  if (st) {
    return { headline: `Census tract · ${st}`, subline: null };
  }

  return { headline: "Census tract", subline: null };
}

"use client";

import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";

type NearbyClinicPayload = {
  clinic_id: number;
  name: string;
  address: string | null;
  city: string | null;
  zip_code: string | null;
  latitude: number;
  longitude: number;
  distance_miles: number;
  rank: number;
  site_type: string | null;
};

function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
      />
    </svg>
  );
}

function distanceTextClass(miles: number): string {
  if (miles <= 2) return "font-semibold text-emerald-700";
  if (miles <= 5) return "font-semibold text-amber-700";
  return "font-medium text-nh-brown-muted";
}

function formatAddressLine(c: NearbyClinicPayload): string {
  const parts = [c.address, c.city, c.zip_code].filter((p) => p != null && String(p).trim() !== "");
  return parts.length > 0 ? parts.join(", ") : "Address not available";
}

function NearbyClinicSkeleton() {
  return (
    <section className="mt-10 rounded-2xl border border-nh-brown/10 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 shrink-0 animate-pulse rounded bg-nh-sand" />
        <div className="h-6 w-52 animate-pulse rounded-md bg-nh-sand" />
      </div>
      <div className="mt-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-nh-brown/10 bg-nh-cream/30 p-4">
            <div className="h-5 w-48 max-w-xs animate-pulse rounded bg-nh-sand" />
            <div className="mt-3 h-4 w-32 animate-pulse rounded bg-nh-cream-dark" />
            <div className="mt-2 h-3 w-full max-w-md animate-pulse rounded bg-nh-sand" />
            <div className="mt-3 h-5 w-28 animate-pulse rounded-full bg-nh-cream-dark" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function NearbyClinicPanel({ geoid }: { geoid: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [clinics, setClinics] = useState<NearbyClinicPayload[]>([]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setClinics([]);

    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tracts/${geoid}/clinics`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (cancelled) return;
        if (!res.ok) {
          setState("error");
          setClinics([]);
          return;
        }
        const json: unknown = await res.json();
        if (!Array.isArray(json)) {
          setState("error");
          setClinics([]);
          return;
        }
        setClinics(json as NearbyClinicPayload[]);
        setState("ready");
      } catch {
        if (!cancelled) {
          setState("error");
          setClinics([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [geoid]);

  if (state === "loading") {
    return <NearbyClinicSkeleton />;
  }

  return (
    <section className="mt-10 rounded-2xl border border-nh-brown/10 bg-white p-6 shadow-sm">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-nh-brown">
        <MapPinIcon className="h-5 w-5 shrink-0 text-nh-terracotta" aria-hidden />
        Nearby Health Centers
      </h2>

      {state === "error" ? (
        <p className="mt-4 text-sm text-nh-brown-muted">Could not load nearby clinics right now.</p>
      ) : clinics.length === 0 ? (
        <p className="mt-4 text-sm text-nh-brown-muted">
          No FQHC sites found within 50 miles of this tract.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {clinics.map((c) => (
            <li
              key={`${c.clinic_id}-${c.rank}`}
              className="rounded-xl border border-nh-brown/10 bg-nh-cream/25 p-4 shadow-sm"
            >
              <p className="font-display text-base font-semibold text-nh-brown">{c.name}</p>
              <p className={`mt-2 text-sm tabular-nums ${distanceTextClass(c.distance_miles)}`}>
                {Number(c.distance_miles).toFixed(2)} mi away
              </p>
              <p className="mt-2 text-sm text-nh-brown-muted">{formatAddressLine(c)}</p>
              {c.site_type ? (
                <span className="mt-3 inline-flex rounded-full border border-nh-brown/15 bg-white px-2.5 py-0.5 text-[10px] font-medium text-nh-brown-muted">
                  {c.site_type}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

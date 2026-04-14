"use client";

import Link from "next/link";
import { useState } from "react";
import { postPdfExport } from "@/lib/api";

export function ScorecardActions({ geoid, apiBase }: { geoid: string; apiBase: string }) {
  const [msg, setMsg] = useState<string | null>(null);

  async function onPdf() {
    setMsg(null);
    try {
      const r = await postPdfExport(geoid);
      const url = r.download_url.startsWith("http") ? r.download_url : `${apiBase}${r.download_url}`;
      window.open(url, "_blank");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "PDF failed");
    }
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Link
        href={`/compare?geoids=${encodeURIComponent(geoid)}`}
        className="rounded-xl border-2 border-teal-700 bg-white px-5 py-2.5 text-sm font-semibold text-teal-900 shadow-sm hover:bg-teal-50"
      >
        Compare this tract
      </Link>
      <button
        type="button"
        onClick={onPdf}
        className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-600"
      >
        Download report
      </button>
      <a
        className="text-sm font-medium text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
        href={`${apiBase}/api/export/tracts.csv`}
      >
        CSV export
      </a>
      {msg && <span className="text-sm text-red-600">{msg}</span>}
    </div>
  );
}

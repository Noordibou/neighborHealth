"use client";

import Link from "next/link";
import { useState } from "react";
import { addToCompareTray, readCompareTray } from "@/lib/compareTray";
import { API_BASE, postPdfExport } from "@/lib/api";

export function ScorecardActions({ geoid }: { geoid: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [compareHint, setCompareHint] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvErr, setCsvErr] = useState<string | null>(null);

  async function onPdf() {
    setMsg(null);
    try {
      const r = await postPdfExport(geoid);
      const url = r.download_url.startsWith("http") ? r.download_url : `${API_BASE}${r.download_url}`;
      window.open(url, "_blank");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "PDF failed");
    }
  }

  async function onExportCsv() {
    const g = geoid.trim();
    if (g.length !== 11) return;
    setCsvErr(null);
    setCsvLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/export/tract-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geoid: g }),
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `neighborhealth-tract-${g}.csv`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setCsvErr(e instanceof Error ? e.message : "CSV export failed");
    } finally {
      setCsvLoading(false);
    }
  }

  function onAddCompare() {
    const g = geoid.trim();
    if (!g) return;
    const before = readCompareTray();
    const wasInTray = before.includes(g);
    const wasAtCapacity = before.length >= 4;
    addToCompareTray(geoid);
    if (!wasInTray && wasAtCapacity) {
      setCompareHint("Added to tray. The previous 4th tract was removed to keep four slots.");
    } else if (wasInTray) {
      setCompareHint("Already in tray — moved to the front.");
    } else {
      setCompareHint("Added to compare tray — return to the map to open compare.");
    }
    window.setTimeout(() => setCompareHint(null), 3200);
  }

  const btnBase =
    "inline-flex w-full items-center justify-center rounded-full px-4 py-3 text-center text-sm font-semibold min-h-[44px]";

  return (
    <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-col md:items-end md:max-w-[13rem]">
      <Link
        href={`/compare?geoids=${encodeURIComponent(geoid)}`}
        className={`${btnBase} border border-nh-brown/20 bg-white text-nh-brown shadow-sm hover:bg-nh-cream`}
      >
        + Compare
      </Link>
      <button
        type="button"
        onClick={onAddCompare}
        className={`${btnBase} border border-nh-brown/20 bg-white text-nh-brown hover:bg-nh-cream`}
      >
        Add to tray
      </button>
      <button
        type="button"
        onClick={() => {
          if (!navigator.clipboard?.writeText) {
            setCopyMsg("Clipboard not available");
            return;
          }
          void navigator.clipboard.writeText(window.location.href).then(
            () => {
              setCopyMsg("Link copied");
              window.setTimeout(() => setCopyMsg(null), 2000);
            },
            () => setCopyMsg("Copy failed")
          );
        }}
        className={`${btnBase} border border-nh-brown/20 bg-white text-nh-brown hover:bg-nh-cream`}
      >
        Share link
      </button>
      <button
        type="button"
        onClick={() => void onExportCsv()}
        disabled={csvLoading}
        className={`${btnBase} border border-nh-brown/20 bg-white text-nh-brown shadow-sm hover:bg-nh-cream disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {csvLoading ? "Exporting…" : "Export CSV"}
      </button>
      <button
        type="button"
        onClick={onPdf}
        className={`${btnBase} bg-nh-brown px-5 text-nh-cream shadow-sm hover:bg-nh-brown/90`}
      >
        Report PDF ↓
      </button>
      {csvErr ? <p className="col-span-2 w-full text-right text-sm text-red-600 md:col-span-1 md:max-w-[13rem]">{csvErr}</p> : null}
      {msg ? <p className="col-span-2 w-full text-right text-sm text-red-600 md:col-span-1 md:max-w-[13rem]">{msg}</p> : null}
      {copyMsg ? <p className="col-span-2 w-full text-right text-sm text-nh-brown-muted md:col-span-1 md:max-w-[13rem]">{copyMsg}</p> : null}
      {compareHint ? <p className="col-span-2 w-full text-right text-sm text-nh-brown-muted md:col-span-1 md:max-w-[13rem]">{compareHint}</p> : null}
    </div>
  );
}

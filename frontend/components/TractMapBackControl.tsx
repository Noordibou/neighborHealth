"use client";

import { useRouter } from "next/navigation";

/** Uses history Back so Explore can remount from the stack and rehydrate saved map/search state. */
export function TractMapBackControl() {
  const router = useRouter();
  return (
    <p className="text-sm text-slate-500">
      <button
        type="button"
        onClick={() => router.back()}
        className="font-medium text-teal-700 hover:underline"
      >
        ← Back to map
      </button>
    </p>
  );
}

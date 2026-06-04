"use client";

import dynamic from "next/dynamic";
import type { TrendChartProps } from "@/types";

const TrendChartImpl = dynamic(
  () => import("@/components/TrendChart").then((m) => ({ default: m.TrendChart })),
  {
    ssr: false,
    loading: () => <div className="h-[60px] w-full animate-pulse rounded-md bg-nh-sand" aria-hidden />,
  }
);

export function TrendChartLazy(props: TrendChartProps) {
  return <TrendChartImpl {...props} />;
}

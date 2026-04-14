"use client";

import { usePathname } from "next/navigation";
import { LandingHeader } from "@/components/LandingHeader";
import { SiteHeader } from "@/components/SiteHeader";

export function AppChrome() {
  const pathname = usePathname();
  if (pathname === "/") {
    return <LandingHeader />;
  }
  return <SiteHeader />;
}

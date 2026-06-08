"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getCompareNavHref, NH_COMPARE_TRAY_EVENT } from "@/lib/compareTray";

type Props = {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
};

export function CompareNavLink({ className, children, onClick }: Props) {
  const pathname = usePathname();
  const [href, setHref] = useState("/compare");

  const sync = useCallback(() => {
    setHref(getCompareNavHref(pathname));
  }, [pathname]);

  useEffect(() => {
    sync();
  }, [sync]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUpdate = () => sync();
    window.addEventListener(NH_COMPARE_TRAY_EVENT, onUpdate);
    window.addEventListener("popstate", onUpdate);
    return () => {
      window.removeEventListener(NH_COMPARE_TRAY_EVENT, onUpdate);
      window.removeEventListener("popstate", onUpdate);
    };
  }, [sync]);

  return (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

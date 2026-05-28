"use client";

export function CollapseChevron({ isOpen, className }: { isOpen: boolean; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={`h-5 w-5 shrink-0 text-nh-brown-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

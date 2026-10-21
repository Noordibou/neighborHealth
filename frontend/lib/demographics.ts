export const RACE_SEGMENTS: {
  key: "pct_white" | "pct_black" | "pct_hispanic" | "pct_asian" | "pct_other_race";
  label: string;
  barColor: string;
  labelClass: string;
}[] = [
  { key: "pct_white", label: "White", barColor: "#7d7a72", labelClass: "text-nh-brown" },
  { key: "pct_black", label: "Black", barColor: "#3d5a80", labelClass: "text-nh-brown" },
  { key: "pct_hispanic", label: "Hispanic", barColor: "#c4501a", labelClass: "text-nh-brown" },
  { key: "pct_asian", label: "Asian", barColor: "#1f6b62", labelClass: "text-nh-brown" },
  { key: "pct_other_race", label: "Other", barColor: "#8a6232", labelClass: "text-nh-brown" },
];

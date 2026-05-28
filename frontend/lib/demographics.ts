export const RACE_SEGMENTS: {
  key: "pct_white" | "pct_black" | "pct_hispanic" | "pct_asian" | "pct_other_race";
  label: string;
  barColor: string;
  labelClass: string;
}[] = [
  { key: "pct_white", label: "White", barColor: "#f2c49c", labelClass: "text-nh-brown" },
  { key: "pct_black", label: "Black", barColor: "#6ec4f0", labelClass: "text-nh-brown" },
  { key: "pct_hispanic", label: "Hispanic", barColor: "#8fb88f", labelClass: "text-nh-brown" },
  { key: "pct_asian", label: "Asian", barColor: "#eb9a8e", labelClass: "text-nh-brown" },
  { key: "pct_other_race", label: "Other", barColor: "#42a8ad", labelClass: "text-nh-brown" },
];

import { computeBatchScores, METRIC_KEYS, type TractValues } from "@/lib/riskScore";

describe("computeBatchScores", () => {
  it("matches equal midrange for flat cohort", () => {
    const tracts: TractValues[] = [
      { geoid: "1", values: Object.fromEntries(METRIC_KEYS.map((k) => [k, 50])) as TractValues["values"] },
      { geoid: "2", values: Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as TractValues["values"] },
      { geoid: "3", values: Object.fromEntries(METRIC_KEYS.map((k) => [k, 100])) as TractValues["values"] },
    ];
    const r = computeBatchScores(tracts);
    expect(r["1"].composite).toBeGreaterThan(40);
    expect(r["1"].composite).toBeLessThan(60);
  });
});

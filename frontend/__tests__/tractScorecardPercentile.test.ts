import { percentileBurdenClass } from "@/components/TractScorecardTable";

describe("percentileBurdenClass", () => {
  it("maps burden tiers to color classes", () => {
    expect(percentileBurdenClass(80)).toBe("text-nh-terracotta");
    expect(percentileBurdenClass(60)).toBe("text-amber-700");
    expect(percentileBurdenClass(40)).toBe("text-nh-brown-muted");
    expect(percentileBurdenClass(10)).toBe("text-emerald-700");
    expect(percentileBurdenClass(null)).toBe("text-nh-brown-muted");
  });
});

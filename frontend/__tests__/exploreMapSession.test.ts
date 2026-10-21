import {
  EXPLORE_MAP_SESSION_KEY,
  getInitialExploreBrowseStateFips,
  parseExploreMapSession,
  parseSearchGeoids,
  parseSearchResults,
} from "@/lib/exploreMapSession";

describe("parseSearchGeoids", () => {
  it("returns [] when value is not an array", () => {
    expect(parseSearchGeoids(null)).toEqual([]);
    expect(parseSearchGeoids(undefined)).toEqual([]);
    expect(parseSearchGeoids("x")).toEqual([]);
    expect(parseSearchGeoids({})).toEqual([]);
    expect(parseSearchGeoids(123)).toEqual([]);
  });

  it("filters to non-empty strings", () => {
    expect(parseSearchGeoids(["  ", 1, "48001", false, "48002"])).toEqual(["48001", "48002"]);
  });
});

describe("parseSearchResults", () => {
  it("returns null for non-array", () => {
    expect(parseSearchResults("bad")).toBeNull();
    expect(parseSearchResults({})).toBeNull();
  });

  it("parses valid rows and skips invalid", () => {
    const rows = [
      { geoid: "48123456700", state_fips: "48", name: "T1", county_name: "X", composite_score: 12 },
      { geoid: "", state_fips: "48" },
      { geoid: "48123456701", state_fips: 6, composite_score: null },
    ];
    const out = parseSearchResults(rows);
    expect(out).toHaveLength(2);
    expect(out![0].geoid).toBe("48123456700");
    expect(out![1].state_fips).toBe("06");
    expect(out![1].composite_score).toBeNull();
  });
});

describe("getInitialExploreBrowseStateFips", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("prefers the state query over a saved explore session", () => {
    sessionStorage.setItem(
      EXPLORE_MAP_SESSION_KEY,
      JSON.stringify({
        v: 1,
        mapMode: "search",
        q: "Citrus Heights",
        searchNarrowFips: "06",
        stateFips: "06",
        searchResults: null,
        searchGeoids: ["06067008139"],
        searchInfo: null,
        searchZoomKey: 1,
      })
    );
    expect(getInitialExploreBrowseStateFips("?state=48", false)).toBe("48");
  });

  it("uses the saved session when the URL has no state", () => {
    sessionStorage.setItem(
      EXPLORE_MAP_SESSION_KEY,
      JSON.stringify({
        v: 1,
        mapMode: "browse",
        q: "",
        searchNarrowFips: null,
        stateFips: "06",
        searchResults: null,
        searchGeoids: [],
        searchInfo: null,
        searchZoomKey: 0,
      })
    );
    expect(getInitialExploreBrowseStateFips("", false)).toBe("06");
  });
});

describe("parseExploreMapSession", () => {
  const valid = {
    v: 1,
    mapMode: "search" as const,
    q: "houston",
    searchNarrowFips: null,
    stateFips: "48",
    searchResults: null,
    searchGeoids: ["48123000100"],
    searchInfo: null,
    searchZoomKey: 1,
  };

  it("parses valid payload", () => {
    const s = JSON.stringify(valid);
    expect(parseExploreMapSession(s)).toEqual(valid);
  });

  it("does not throw when searchGeoids is corrupted", () => {
    const bad = { ...valid, searchGeoids: "not-an-array" };
    const parsed = parseExploreMapSession(JSON.stringify(bad));
    expect(parsed).not.toBeNull();
    expect(parsed!.searchGeoids).toEqual([]);
  });

  it("returns null for invalid mapMode", () => {
    expect(parseExploreMapSession(JSON.stringify({ ...valid, mapMode: "fly" }))).toBeNull();
  });
});

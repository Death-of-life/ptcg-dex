import { describe, expect, it } from "vitest";
import { parseListQuery } from "../src/utils";

describe("parseListQuery", () => {
  it("uses defaults", () => {
    const url = new URL("https://example.com/api/en/cards");
    const parsed = parseListQuery(url);

    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(24);
    expect(parsed.sortBy).toBe("name");
    expect(parsed.sortOrder).toBe("asc");
  });

  it("clamps values", () => {
    const url = new URL(
      "https://example.com/api/en/cards?page=3&pageSize=999&sortBy=hp&sortOrder=DESC"
    );
    const parsed = parseListQuery(url);

    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(100);
    expect(parsed.sortBy).toBe("hp");
    expect(parsed.sortOrder).toBe("desc");
  });
});

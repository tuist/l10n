import { describe, expect, test } from "bun:test";
import { expandOutput } from "./output.js";

describe("expandOutput", () => {
  test("expands all placeholders", () => {
    const result = expandOutput("i18n/{lang}/{relpath}", {
      lang: "es",
      relpath: "docs/guide.md",
      basename: "guide",
      ext: "md",
    });
    expect(result).toContain("es");
    expect(result).toContain("guide.md");
  });

  test("expands basename and ext", () => {
    const result = expandOutput("out/{lang}/{basename}.{ext}", {
      lang: "de",
      relpath: "guide.md",
      basename: "guide",
      ext: "md",
    });
    expect(result).toContain("de");
    expect(result).toContain("guide.md");
  });
});

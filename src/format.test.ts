import { describe, expect, test } from "bun:test";
import { detectFormat } from "./format.js";

describe("detectFormat", () => {
  test("detects markdown", () => {
    expect(detectFormat("docs/guide.md")).toBe("markdown");
    expect(detectFormat("readme.markdown")).toBe("markdown");
  });

  test("detects json", () => {
    expect(detectFormat("data.json")).toBe("json");
  });

  test("detects yaml", () => {
    expect(detectFormat("config.yaml")).toBe("yaml");
    expect(detectFormat("config.yml")).toBe("yaml");
  });

  test("detects po", () => {
    expect(detectFormat("messages.po")).toBe("po");
  });

  test("defaults to text", () => {
    expect(detectFormat("readme.txt")).toBe("text");
    expect(detectFormat("file.unknown")).toBe("text");
  });
});

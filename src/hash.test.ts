import { describe, expect, test } from "bun:test";
import { hashString, hashStrings } from "./hash.js";

describe("hashString", () => {
  test("returns consistent sha256 hex", () => {
    const result = hashString("hello");
    expect(result).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  test("different inputs produce different hashes", () => {
    expect(hashString("a")).not.toBe(hashString("b"));
  });
});

describe("hashStrings", () => {
  test("joins with double newline before hashing", () => {
    const result = hashStrings(["a", "b"]);
    expect(result).toBe(hashString("a\n\nb"));
  });

  test("single item is same as hashString", () => {
    expect(hashStrings(["hello"])).toBe(hashString("hello"));
  });
});

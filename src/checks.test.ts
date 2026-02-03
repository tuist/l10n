import { describe, expect, test } from "bun:test";
import { validate, ToolError } from "./checks.js";

describe("validate syntax", () => {
  test("validates valid JSON", async () => {
    await expect(
      validate("/tmp", "json", '{"key": "value"}', "", { preserve: ["none"] }),
    ).resolves.toBeUndefined();
  });

  test("rejects invalid JSON", async () => {
    await expect(
      validate("/tmp", "json", "not json", "", { preserve: ["none"] }),
    ).rejects.toThrow("syntax-validator");
  });

  test("validates valid YAML", async () => {
    await expect(
      validate("/tmp", "yaml", "key: value\n", "", { preserve: ["none"] }),
    ).resolves.toBeUndefined();
  });

  test("validates valid PO", async () => {
    const po = `msgid "hello"
msgstr "hola"
`;
    await expect(
      validate("/tmp", "po", po, "", { preserve: ["none"] }),
    ).resolves.toBeUndefined();
  });

  test("rejects PO with missing msgstr", async () => {
    const po = `msgid "hello"
msgid "world"
`;
    await expect(
      validate("/tmp", "po", po, "", { preserve: ["none"] }),
    ).rejects.toThrow("syntax-validator");
  });

  test("validates markdown frontmatter", async () => {
    const md = `---
title: Test
---
Content here`;
    await expect(
      validate("/tmp", "markdown", md, "", { preserve: ["none"] }),
    ).resolves.toBeUndefined();
  });

  test("rejects broken markdown frontmatter", async () => {
    const md = `---
title: [invalid
---
Content`;
    await expect(
      validate("/tmp", "markdown", md, "", { preserve: ["none"] }),
    ).rejects.toThrow("syntax-validator");
  });
});

describe("validate preserve", () => {
  test("passes when all tokens preserved", async () => {
    const source = "Hello `code` world";
    const output = "Hola `code` mundo";
    await expect(
      validate("/tmp", "text", output, source, {
        preserve: ["inline_code"],
      }),
    ).resolves.toBeUndefined();
  });

  test("fails when tokens are missing", async () => {
    const source = "Hello `code` world";
    const output = "Hola mundo";
    await expect(
      validate("/tmp", "text", output, source, {
        preserve: ["inline_code"],
      }),
    ).rejects.toThrow("preserve-check");
  });

  test("skips preserve check with none", async () => {
    const source = "Hello `code` world";
    const output = "Hola mundo";
    await expect(
      validate("/tmp", "text", output, source, { preserve: ["none"] }),
    ).resolves.toBeUndefined();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { __test, noteLeafCommand } from "./herdrHostLeaves";

const isPlain = (leafId: number | null) => __test.isPlainShell(leafId);

describe("herdrHostLeaves sidebar authority", () => {
  beforeEach(() => __test.reset());

  it("a fresh leaf with no command seen is plain (idle prompt)", () => {
    expect(isPlain(1)).toBe(true);
  });

  it("non-terminal tabs (null leaf) are never plain — herdr keeps authority", () => {
    expect(isPlain(null)).toBe(false);
  });

  it("at a prompt (D/A) the leaf is plain immediately — no command needed", () => {
    noteLeafCommand(1, false);
    expect(isPlain(1)).toBe(true);
  });

  it("running herdr makes the leaf NOT plain (herdr authority)", () => {
    noteLeafCommand(1, true, "herdr");
    expect(isPlain(1)).toBe(false);
  });

  it("running an identified non-herdr command stays plain", () => {
    noteLeafCommand(1, true, "vim file.ts");
    expect(isPlain(1)).toBe(true);
  });

  it("follows the terminal cwd again the moment herdr exits", () => {
    noteLeafCommand(1, true, "herdr");
    expect(isPlain(1)).toBe(false);
    noteLeafCommand(1, false); // D — herdr quit, back at prompt
    expect(isPlain(1)).toBe(true); // plain immediately, no command needed
  });

  it("fail-safe: a running UNidentified command (bash bare C) keeps herdr authority", () => {
    noteLeafCommand(1, true, ""); // bash sends `C` with no command line
    expect(isPlain(1)).toBe(false);
    noteLeafCommand(1, false); // back at prompt → plain
    expect(isPlain(1)).toBe(true);
  });

  it("detects herdr through wrappers and paths, not through filename args", () => {
    noteLeafCommand(1, true, "sudo herdr");
    expect(isPlain(1)).toBe(false);
    noteLeafCommand(2, true, "/usr/local/bin/herdr attach");
    expect(isPlain(2)).toBe(false);
    noteLeafCommand(3, true, "vim herdr.md"); // editing a file named herdr
    expect(isPlain(3)).toBe(true);
  });

  it("leaves are independent", () => {
    noteLeafCommand(1, true, "herdr");
    noteLeafCommand(2, false);
    expect(isPlain(1)).toBe(false);
    expect(isPlain(2)).toBe(true);
  });
});

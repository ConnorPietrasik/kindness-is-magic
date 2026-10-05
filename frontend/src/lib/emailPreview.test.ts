import { describe, expect, it } from "vitest";
import { splitMessageParagraphs } from "./emailPreview";

describe("splitMessageParagraphs", () => {
  it("keeps a message with no blank lines as one paragraph", () => {
    expect(splitMessageParagraphs("hello")).toEqual([["hello"]]);
  });

  it("splits paragraphs on blank lines", () => {
    expect(splitMessageParagraphs("First paragraph\n\nSecond paragraph")).toEqual([["First paragraph"], ["Second paragraph"]]);
  });

  it("keeps single newlines as line breaks within a paragraph", () => {
    expect(splitMessageParagraphs("Timeline:\n- Monday: intro call\n- Tuesday: visit")).toEqual([
      ["Timeline:", "- Monday: intro call", "- Tuesday: visit"],
    ]);
  });

  it("treats whitespace-only lines as paragraph separators", () => {
    expect(splitMessageParagraphs("a\n   \nb")).toEqual([["a"], ["b"]]);
  });

  it("normalizes Windows line endings before splitting", () => {
    expect(splitMessageParagraphs("Line one\r\n\r\nLine two")).toEqual([["Line one"], ["Line two"]]);
    expect(splitMessageParagraphs("a\r\nb")).toEqual([["a", "b"]]);
  });

  it("drops empty paragraphs (blank input yields no paragraphs)", () => {
    expect(splitMessageParagraphs("")).toEqual([]);
    expect(splitMessageParagraphs("\n\n")).toEqual([]);
    expect(splitMessageParagraphs("  \n \n ")).toEqual([]);
  });
});

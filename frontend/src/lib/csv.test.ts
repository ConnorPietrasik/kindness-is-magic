import { describe, expect, it } from "vitest";
import { EXPECTED_HEADERS, isValidCsvFile, KNOWN_SECTIONS, parseCsvLine, parseCsvSections, validateCsvForImport } from "./csv";

/* ------------------------------------------------------------------ */
/* parseCsvLine                                                        */
/* ------------------------------------------------------------------ */

describe("parseCsvLine", () => {
  it("splits simple comma-separated values", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields", () => {
    expect(parseCsvLine('"hello world",foo,bar')).toEqual(["hello world", "foo", "bar"]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });

  it("handles empty fields", () => {
    expect(parseCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("handles trailing comma", () => {
    expect(parseCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });

  it("handles quoted fields with commas inside", () => {
    expect(parseCsvLine('"Smith, John",25,active')).toEqual(["Smith, John", "25", "active"]);
  });

  it("handles single field with no commas", () => {
    expect(parseCsvLine("only")).toEqual(["only"]);
  });

  it("handles empty line", () => {
    expect(parseCsvLine("")).toEqual([""]);
  });
});

/* ------------------------------------------------------------------ */
/* parseCsvSections                                                    */
/* ------------------------------------------------------------------ */

describe("parseCsvSections", () => {
  it("returns empty object for empty text", () => {
    expect(parseCsvSections("")).toEqual({});
  });

  it("returns empty object for text with no section headers", () => {
    expect(parseCsvSections("a,b,c\n1,2,3")).toEqual({});
  });

  it("parses a single section with headers and rows", () => {
    const text = `# referrers
name,family_limit,phone_number
Acme Corp,5,555-0100
Beta Inc,3,555-0200`;

    const result = parseCsvSections(text);
    expect(Object.keys(result)).toEqual(["referrers"]);
    expect(result.referrers!.headers).toEqual(["name", "family_limit", "phone_number"]);
    expect(result.referrers!.rows).toEqual([
      ["Acme Corp", "5", "555-0100"],
      ["Beta Inc", "3", "555-0200"],
    ]);
  });

  it("parses multiple sections", () => {
    const text = `# referrers
name,family_limit,phone_number
Acme Corp,5,555-0100

# families
referrer_name,family_name,family_wish,contact_name,bio,address,phone_number
Acme Corp,The Smiths,Pizza,John Smith,,,555-0300`;

    const result = parseCsvSections(text);
    expect(result.referrers!.headers).toEqual(["name", "family_limit", "phone_number"]);
    expect(result.referrers!.rows.length).toBe(1);
    expect(result.families!.headers.length).toBe(7);
    expect(result.families!.rows.length).toBe(1);
  });

  it("skips blank lines", () => {
    const text = `# referrers

name,family_limit,phone_number

Acme Corp,5,555-0100

`;
    const result = parseCsvSections(text);
    expect(result.referrers!.headers).toEqual(["name", "family_limit", "phone_number"]);
    expect(result.referrers!.rows.length).toBe(1);
  });

  it("skips non-section comment lines", () => {
    const text = `# referrers
# This is a comment
name,family_limit,phone_number
# Another comment
Acme Corp,5,555-0100`;

    const result = parseCsvSections(text);
    expect(result.referrers!.headers).toEqual(["name", "family_limit", "phone_number"]);
    expect(result.referrers!.rows).toEqual([["Acme Corp", "5", "555-0100"]]);
  });

  it("handles section names case-insensitively", () => {
    const text = `# REFERRERS
name,family_limit,phone_number
Acme,5,555`;

    const result = parseCsvSections(text);
    expect(result.referrers!).toBeDefined();
  });

  it("handles quoted fields in data rows", () => {
    const text = `# referrers
name,family_limit,phone_number
"Smith, John & Co",5,555`;

    const result = parseCsvSections(text);
    expect(result.referrers!.rows).toEqual([["Smith, John & Co", "5", "555"]]);
  });

  it("trims header and field values", () => {
    const text = `# referrers
 name , family_limit , phone_number 
 Acme , 5 , 555 `;

    const result = parseCsvSections(text);
    expect(result.referrers!.headers).toEqual(["name", "family_limit", "phone_number"]);
    expect(result.referrers!.rows).toEqual([["Acme", "5", "555"]]);
  });
});

/* ------------------------------------------------------------------ */
/* validateCsvForImport                                                */
/* ------------------------------------------------------------------ */

describe("validateCsvForImport", () => {
  it("reports error when no sections found", () => {
    const result = validateCsvForImport({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("No sections found");
  });

  it("passes valid single section", () => {
    const sections = {
      referrers: {
        headers: ["name", "family_limit", "phone_number"],
        rows: [["Acme", "5", "555"]],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("passes valid multi-section CSV", () => {
    const sections = {
      referrers: {
        headers: ["name", "family_limit", "phone_number"],
        rows: [["Acme", "5", "555"]],
      },
      families: {
        headers: ["referrer_name", "family_name", "family_wish", "contact_name", "bio", "address", "phone_number"],
        rows: [["Acme", "Smiths", "Pizza", "John", "", "", "555"]],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports missing columns", () => {
    const sections = {
      referrers: {
        headers: ["name"],
        rows: [["Acme"]],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing columns"))).toBe(true);
    expect(result.errors.some((e) => e.includes("family_limit"))).toBe(true);
  });

  it("warns about extra columns", () => {
    const sections = {
      referrers: {
        headers: ["name", "family_limit", "phone_number", "extra_col"],
        rows: [["Acme", "5", "555", "extra"]],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("extra columns"))).toBe(true);
  });

  it("warns about unknown sections", () => {
    const sections = {
      referrers: {
        headers: ["name", "family_limit", "phone_number"],
        rows: [["Acme", "5", "555"]],
      },
      unknown_stuff: {
        headers: ["foo", "bar"],
        rows: [["a", "b"]],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("Unknown section"))).toBe(true);
    expect(result.stats.unknownSections).toContain("unknown_stuff");
  });

  it("reports error when section has no header row", () => {
    const sections = {
      referrers: {
        headers: [],
        rows: [],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("no header row"))).toBe(true);
  });

  it("warns when section has no data rows", () => {
    const sections = {
      referrers: {
        headers: ["name", "family_limit", "phone_number"],
        rows: [],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("no data rows"))).toBe(true);
  });

  it("reports correct stats", () => {
    const sections = {
      referrers: {
        headers: ["name", "family_limit", "phone_number"],
        rows: [
          ["Acme", "5", "555"],
          ["Beta", "3", "555"],
        ],
      },
      families: {
        headers: ["referrer_name", "family_name", "family_wish", "contact_name", "bio", "address", "phone_number"],
        rows: [["Acme", "Smiths", "Pizza", "John", "", "", "555"]],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.stats.sections).toBe(2);
    expect(result.stats.totalRows).toBe(3);
    expect(result.stats.unknownSections).toEqual([]);
  });

  it("handles people section headers", () => {
    const sections = {
      people: {
        headers: ["family_name", "given_name", "age", "practical_wish", "fun_wish", "title", "note"],
        rows: [["Smiths", "Alice", "8", "Bike", "Lego", "", ""]],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.valid).toBe(true);
  });

  it("handles users section headers with display_name", () => {
    const sections = {
      users: {
        headers: ["email", "password", "role", "referrer_name_or_id", "family_name_or_id", "display_name"],
        rows: [["admin@test.com", "secret", "admin", "", "", "Admin User"]],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.valid).toBe(true);
  });

  it("errors when users section is missing display_name", () => {
    const sections = {
      users: {
        headers: ["email", "password", "role", "referrer_name_or_id", "family_name_or_id"],
        rows: [["admin@test.com", "secret", "admin", "", ""]],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("display_name"))).toBe(true);
  });

  it("aggregates errors across multiple sections", () => {
    const sections = {
      referrers: {
        headers: ["name"], // missing columns
        rows: [["Acme"]],
      },
      families: {
        headers: [], // no headers
        rows: [],
      },
    };
    const result = validateCsvForImport(sections);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* isValidCsvFile                                                      */
/* ------------------------------------------------------------------ */

describe("isValidCsvFile", () => {
  it("returns true for .csv files", () => {
    expect(isValidCsvFile({ name: "data.csv" })).toBe(true);
    expect(isValidCsvFile({ name: "Data.CSV" })).toBe(true);
    expect(isValidCsvFile({ name: "import.Csv" })).toBe(true);
  });

  it("returns false for non-csv files", () => {
    expect(isValidCsvFile({ name: "data.txt" })).toBe(false);
    expect(isValidCsvFile({ name: "data.xlsx" })).toBe(false);
    expect(isValidCsvFile({ name: "data.csv.bak" })).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isValidCsvFile(null)).toBe(false);
    expect(isValidCsvFile(undefined)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

describe("KNOWN_SECTIONS", () => {
  it("contains all four expected section names", () => {
    expect(KNOWN_SECTIONS).toEqual(["referrers", "families", "people", "users"]);
  });
});

describe("EXPECTED_HEADERS", () => {
  it("defines headers for all four sections", () => {
    expect(Object.keys(EXPECTED_HEADERS)).toEqual(["referrers", "families", "people", "users"]);
  });

  it("has correct referrer headers", () => {
    expect(EXPECTED_HEADERS.referrers).toEqual(["name", "family_limit", "phone_number"]);
  });

  it("has correct family headers", () => {
    expect(EXPECTED_HEADERS.families.length).toBe(7);
    expect(EXPECTED_HEADERS.families).toContain("referrer_name");
    expect(EXPECTED_HEADERS.families).toContain("family_name");
  });

  it("has correct people headers", () => {
    expect(EXPECTED_HEADERS.people.length).toBe(7);
    expect(EXPECTED_HEADERS.people).toContain("given_name");
    expect(EXPECTED_HEADERS.people).toContain("age");
  });

  it("has correct users headers", () => {
    expect(EXPECTED_HEADERS.users).toEqual(["email", "password", "role", "referrer_name_or_id", "family_name_or_id", "display_name"]);
  });
});

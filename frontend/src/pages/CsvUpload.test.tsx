import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import CsvUpload from "./CsvUpload";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const VALID_CSV = `# referrers
name,family_limit,phone_number
Acme Corp,5,555-0100
Beta Inc,3,555-0200
`;

// Missing expected columns → validation errors
const INVALID_CSV = `# referrers
name
Acme Corp
`;

const makeCsvFile = (text: string, name = "import.csv") => new File([text], name, { type: "text/csv" });

const wrap = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/admin/csv-upload"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>{ui}</ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

/**
 * Set a file on the hidden file input. The input is display:none (the button
 * opens the native picker), which userEvent can't drive, so set `files`
 * directly and dispatch the change event the browser would fire.
 */
function uploadFile(container: HTMLElement, file: File) {
  const input = container.querySelector("input[type='file']");
  if (!input) throw new Error("file input not found");
  fireEvent.change(input, { target: { files: [file] } });
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("CsvUpload", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("rejects non-CSV files with an alert", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { container } = wrap(<CsvUpload />);

    uploadFile(container, new File(["x"], "notes.txt", { type: "text/plain" }));

    expect(alertSpy).toHaveBeenCalledWith("Please select a .csv file.");
    // No validation stats for a rejected file
    expect(screen.queryByText(/section/)).not.toBeInTheDocument();
  });

  it("validates a CSV client-side and shows section/row stats", async () => {
    vi.spyOn(api, "adminImportCsv").mockResolvedValue({});
    const { container } = wrap(<CsvUpload />);

    uploadFile(container, makeCsvFile(VALID_CSV));

    await waitFor(() => {
      expect(screen.getByText("1 section")).toBeInTheDocument();
    });
    expect(screen.getByText("2 rows")).toBeInTheDocument();
    expect(screen.getByText("import.csv")).toBeInTheDocument();
  });

  it("blocks import when validation found errors", async () => {
    const importSpy = vi.spyOn(api, "adminImportCsv").mockResolvedValue({});
    const { container } = wrap(<CsvUpload />);

    uploadFile(container, makeCsvFile(INVALID_CSV));

    // The validation error is shown and the import button is disabled
    expect(await screen.findByText('Section "referrers" is missing columns: "family_limit", "phone_number".')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeDisabled();
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("sends the raw file text to the import API on success", async () => {
    const user = userEvent.setup();
    const sectionStat = { created: 0, skipped: 0, errors: 0 };
    const importSpy = vi
      .spyOn(api, "adminImportCsv")
      .mockResolvedValue({ summary: { referrers: sectionStat, families: sectionStat, people: sectionStat, users: sectionStat }, rows: [] });
    const { container } = wrap(<CsvUpload />);

    uploadFile(container, makeCsvFile(VALID_CSV));

    // Wait for client-side validation, then import
    await waitFor(() => {
      expect(screen.getByText("2 rows")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Import CSV" }));

    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledWith(VALID_CSV);
    });
    expect(await screen.findByText("CSV imported successfully")).toBeInTheDocument();
  });

  it("loads the template from the API and shows it", async () => {
    const user = userEvent.setup();
    const sampleSpy = vi.spyOn(api, "adminGetCsvSample").mockResolvedValue({ csv_template: "# referrers\nname,family_limit,phone_number" });

    wrap(<CsvUpload />);

    await user.click(await screen.findByRole("button", { name: /Show Template/ }));

    expect(await screen.findByText(/CSV Template/)).toBeInTheDocument();
    expect(sampleSpy).toHaveBeenCalledTimes(1);
    // Template renders in a <pre> as one text node — match partially
    expect(screen.getByText(/# referrers/)).toBeInTheDocument();
  });
});

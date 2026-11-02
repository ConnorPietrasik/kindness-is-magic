import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import { HeaderBar } from "./HeaderBar";

/** A mounted app-data query — the header's refresh button only renders while one is active. */
function Probe() {
  useQuery({ queryKey: ["probe"], queryFn: () => 1 });
  return null;
}

function renderHeaderBar(right?: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <ToastContainer>
        <QueryClientProvider client={queryClient}>
          <HeaderBar title="Test" right={right} />
          <Probe />
        </QueryClientProvider>
      </ToastContainer>
    </MemoryRouter>
  );
}

describe("HeaderBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the refresh button", async () => {
    renderHeaderBar();
    // The probe query's observer attaches in an effect, so the button appears
    // on the re-render that follows — wait for it rather than asserting at once.
    expect(await screen.findByRole("button", { name: "Refresh data" })).toBeInTheDocument();
  });

  it("renders custom right content alongside the refresh button", async () => {
    renderHeaderBar(<button type="button">Sign out</button>);
    expect(await screen.findByRole("button", { name: "Refresh data" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import { auth } from "../lib/queryKeys";
import { RefreshButton } from "./RefreshButton";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** A mounted query with a controllable queryFn — the target of the refetch. */
function Probe({ queryFn }: { queryFn: () => Promise<number> }) {
  const { data } = useQuery({ queryKey: ["probe"], queryFn });
  return <span data-testid="probe">{data ?? "loading"}</span>;
}

/** Second query key, used to verify inactive queries are left alone. */
function ProbeB({ queryFn }: { queryFn: () => Promise<number> }) {
  const { data } = useQuery({ queryKey: ["probeB"], queryFn });
  return <span data-testid="probe-b">{data ?? "loading"}</span>;
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithProbe(queryFn: () => Promise<number>) {
  const queryClient = makeClient();
  return render(
    <ToastContainer>
      <QueryClientProvider client={queryClient}>
        <Probe queryFn={queryFn} />
        <RefreshButton />
      </QueryClientProvider>
    </ToastContainer>
  );
}

const getButton = () => screen.getByRole("button", { name: "Refresh data" });

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("RefreshButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("refetches active queries and shows a success toast", async () => {
    const event = userEvent.setup();
    const queryFn = vi.fn().mockResolvedValue(1);
    renderWithProbe(queryFn);

    await screen.findByTestId("probe");
    expect(queryFn).toHaveBeenCalledTimes(1);

    await event.click(getButton());

    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Data refreshed")).toBeInTheDocument();
  });

  it("shows an error toast when a refetch fails", async () => {
    const event = userEvent.setup();
    const queryFn = vi.fn().mockRejectedValue(new Error("Network error"));
    renderWithProbe(queryFn);

    // Initial fetch fails (retry: false) — the button is enabled either way.
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    await event.click(getButton());

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("is disabled while the refetch is in flight", async () => {
    const event = userEvent.setup();
    let resolveSecond: (value: number) => void = () => {};
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockImplementationOnce(() => new Promise<number>((resolve) => (resolveSecond = resolve)));
    renderWithProbe(queryFn);

    await screen.findByTestId("probe");

    await event.click(getButton());

    expect(getButton()).toBeDisabled();
    expect(queryFn).toHaveBeenCalledTimes(2);

    resolveSecond(2);
    await waitFor(() => expect(getButton()).toBeEnabled());
    expect(screen.getByText("Data refreshed")).toBeInTheDocument();
  });

  it("only refetches active queries — unmounted (cached) queries are left alone", async () => {
    const event = userEvent.setup();
    const queryFnA = vi.fn().mockResolvedValue(1);
    const queryFnB = vi.fn().mockResolvedValue(2);
    const queryClient = makeClient();

    const utils = render(
      <ToastContainer>
        <QueryClientProvider client={queryClient}>
          <Probe queryFn={queryFnA} />
          <ProbeB queryFn={queryFnB} />
          <RefreshButton />
        </QueryClientProvider>
      </ToastContainer>
    );

    await screen.findByTestId("probe-b");
    expect(queryFnA).toHaveBeenCalledTimes(1);
    expect(queryFnB).toHaveBeenCalledTimes(1);

    // Unmount ProbeB — its query stays in the cache but has no active observer.
    utils.rerender(
      <ToastContainer>
        <QueryClientProvider client={queryClient}>
          <Probe queryFn={queryFnA} />
          <RefreshButton />
        </QueryClientProvider>
      </ToastContainer>
    );

    await event.click(getButton());

    await waitFor(() => expect(queryFnA).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Data refreshed")).toBeInTheDocument();
    expect(queryFnB).toHaveBeenCalledTimes(1);
  });

  it("does not render when the page has no active app-data queries", () => {
    render(
      <ToastContainer>
        <QueryClientProvider client={makeClient()}>
          <RefreshButton />
        </QueryClientProvider>
      </ToastContainer>
    );
    expect(screen.queryByRole("button", { name: "Refresh data" })).not.toBeInTheDocument();
  });

  it("ignores the root auth query when deciding to render", () => {
    // The auth session query stays mounted on every page (AuthProvider at the
    // app root) — a page whose only active query is auth has no data to
    // refetch, so the button must stay hidden.
    function AuthProbe() {
      useQuery({ queryKey: auth, queryFn: () => null, staleTime: Infinity });
      return null;
    }
    render(
      <ToastContainer>
        <QueryClientProvider client={makeClient()}>
          <AuthProbe />
          <RefreshButton />
        </QueryClientProvider>
      </ToastContainer>
    );
    expect(screen.queryByRole("button", { name: "Refresh data" })).not.toBeInTheDocument();
  });

  it("counts and refetches a query nested under the auth segment — only the exact session key is excluded", async () => {
    const event = userEvent.setup();
    const sessionFn = vi.fn().mockResolvedValue(null);
    const subFn = vi.fn().mockResolvedValue(1);
    const queryClient = makeClient();

    function SessionProbe() {
      useQuery({ queryKey: auth, queryFn: sessionFn, staleTime: Infinity });
      return null;
    }
    function AuthSubProbe() {
      useQuery({ queryKey: [auth[0], "deadlines"], queryFn: subFn });
      return null;
    }

    render(
      <ToastContainer>
        <QueryClientProvider client={queryClient}>
          <SessionProbe />
          <AuthSubProbe />
          <RefreshButton />
        </QueryClientProvider>
      </ToastContainer>
    );

    // The sub-query keeps the button visible even though the session query is
    // excluded — and clicking refetches it while the session query stays put.
    await event.click(await screen.findByRole("button", { name: "Refresh data" }));

    await waitFor(() => expect(subFn).toHaveBeenCalledTimes(2));
    expect(sessionFn).toHaveBeenCalledTimes(1);
  });
});

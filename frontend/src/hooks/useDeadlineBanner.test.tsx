import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Deadline, DeadlineListResponse } from "../types";
import { useDeadlineBanner } from "./useDeadlineBanner";

function makeDeadline(overrides: Partial<Deadline> = {}): Deadline {
  return {
    id: 1,
    type: "family_info",
    label: "Family information",
    due_date: "2099-01-02",
    mode: "display",
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const wrap = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe("useDeadlineBanner", () => {
  it("returns null when the list is empty", async () => {
    const listFn = vi.fn().mockResolvedValue({ deadlines: [] } satisfies DeadlineListResponse);
    const { result } = renderHook(() => useDeadlineBanner("family_info", listFn), { wrapper: wrap() });

    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it("returns the banner deadline for the requested type", async () => {
    const listFn = vi.fn().mockResolvedValue({ deadlines: [makeDeadline()] } satisfies DeadlineListResponse);
    const { result } = renderHook(() => useDeadlineBanner("family_info", listFn), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current).toEqual({ label: "Family information", dueDate: "2099-01-02", status: "upcoming" });
    });
  });

  it("returns null when no row matches the type", async () => {
    const listFn = vi.fn().mockResolvedValue({ deadlines: [makeDeadline({ type: "gift_dropoff" })] } satisfies DeadlineListResponse);
    const { result } = renderHook(() => useDeadlineBanner("family_info", listFn), { wrapper: wrap() });

    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });
});

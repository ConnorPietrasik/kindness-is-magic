import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { DisplayId } from "./DisplayId";

function renderDisplayId(props: React.ComponentProps<typeof DisplayId>) {
  return render(<DisplayId {...props} />, { wrapper: MemoryRouter });
}

afterEach(() => {
  // Clean up between tests to avoid stale DOM elements confusing queries
  document.body.innerHTML = "";
});

describe("DisplayId", () => {
  describe("family format (R-F)", () => {
    it("renders referrer part as link when referrerId is provided", () => {
      renderDisplayId({ displayId: "2-1", familyId: 10, referrerId: 2 });
      const referrerLink = screen.getByRole("link", { name: "2" });
      expect(referrerLink).toHaveAttribute("href", "/admin/referrers/2/families");
    });

    it("renders family part as link", () => {
      renderDisplayId({ displayId: "2-1", familyId: 10, referrerId: 2 });
      const familyLink = screen.getByRole("link", { name: "1" });
      expect(familyLink).toHaveAttribute("href", "/admin/families/10/people");
    });

    it("parses referrerId from display_id when not provided", () => {
      renderDisplayId({ displayId: "3-2", familyId: 15 });
      const referrerLink = screen.getByRole("link", { name: "3" });
      expect(referrerLink).toHaveAttribute("href", "/admin/referrers/3/families");
    });

    it("renders orphan referrer (0) without a referrer link", () => {
      renderDisplayId({ displayId: "0-1", familyId: 10, referrerId: 0 });
      expect(screen.queryByRole("link", { name: "0" })).not.toBeInTheDocument();
      // Family part should still link
      const familyLink = screen.getByRole("link", { name: "1" });
      expect(familyLink).toHaveAttribute("href", "/admin/families/10/people");
    });

    it("renders orphan referrer (0) without link when referrerId is null", () => {
      renderDisplayId({ displayId: "0-1", familyId: 10, referrerId: null });
      expect(screen.queryByRole("link", { name: "0" })).not.toBeInTheDocument();
    });
  });

  describe("person format (R-F-P)", () => {
    it("renders referrer part as link when referrerId is provided", () => {
      renderDisplayId({ displayId: "2-1-1", familyId: 10, referrerId: 2 });
      const referrerLink = screen.getByRole("link", { name: "2" });
      expect(referrerLink).toHaveAttribute("href", "/admin/referrers/2/families");
    });

    it("renders family part as link", () => {
      renderDisplayId({ displayId: "2-1-1", familyId: 10, referrerId: 2 });
      const familyLink = screen.getByRole("link", { name: "1" });
      expect(familyLink).toHaveAttribute("href", "/admin/families/10/people");
    });

    it("renders person part as plain text (only 2 links total)", () => {
      renderDisplayId({ displayId: "2-1-1", familyId: 10, referrerId: 2 });
      const links = screen.getAllByRole("link");
      expect(links).toHaveLength(2);
    });

    it("parses referrerId from display_id when not provided", () => {
      renderDisplayId({ displayId: "5-3-2", familyId: 20 });
      const referrerLink = screen.getByRole("link", { name: "5" });
      expect(referrerLink).toHaveAttribute("href", "/admin/referrers/5/families");
    });
  });

  describe("special / scoped values", () => {
    it("renders PENDING as plain text", () => {
      renderDisplayId({ displayId: "PENDING", familyId: 10 });
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByText("PENDING")).toBeInTheDocument();
    });

    it("renders REJECTED as plain text", () => {
      renderDisplayId({ displayId: "REJECTED", familyId: 10 });
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByText("REJECTED")).toBeInTheDocument();
    });

    it("renders DELETED as plain text", () => {
      renderDisplayId({ displayId: "DELETED", familyId: 10 });
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByText("DELETED")).toBeInTheDocument();
    });

    it("renders single-segment scoped ID as plain text", () => {
      const { container } = renderDisplayId({ displayId: "1", familyId: 10 });
      expect(container.textContent).toBe("1");
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });
});

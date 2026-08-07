import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WishLockBadge } from "./WishLockBadge";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WishLockBadge", () => {
  describe("default labels and colors", () => {
    it("renders 'Editable' for family lock level", () => {
      render(<WishLockBadge level="family" />);
      expect(screen.getByText("Editable")).toBeInTheDocument();
    });

    it("renders 'Referrer reviewed' for referrer lock level", () => {
      render(<WishLockBadge level="referrer" />);
      expect(screen.getByText("Referrer reviewed")).toBeInTheDocument();
    });

    it("renders 'Admin approved' for admin lock level", () => {
      render(<WishLockBadge level="admin" />);
      expect(screen.getByText("Admin approved")).toBeInTheDocument();
    });

    it("uses gray colors for family level", () => {
      const { container } = render(<WishLockBadge level="family" />);
      expect(container.firstChild).toHaveClass("bg-gray-100", "text-gray-600");
    });

    it("uses blue colors for referrer level", () => {
      const { container } = render(<WishLockBadge level="referrer" />);
      expect(container.firstChild).toHaveClass("bg-blue-100", "text-blue-700");
    });

    it("uses emerald colors for admin level", () => {
      const { container } = render(<WishLockBadge level="admin" />);
      expect(container.firstChild).toHaveClass("bg-emerald-100", "text-emerald-700");
    });
  });

  describe("custom label overrides", () => {
    it("applies custom label for a specific level", () => {
      render(<WishLockBadge level="admin" labels={{ admin: "Locked" }} />);
      expect(screen.getByText("Locked")).toBeInTheDocument();
    });

    it("keeps default labels for levels not in override", () => {
      render(<WishLockBadge level="family" labels={{ admin: "Locked" }} />);
      expect(screen.getByText("Editable")).toBeInTheDocument();
    });
  });

  describe("custom color overrides", () => {
    it("applies custom color for a specific level", () => {
      const { container } = render(<WishLockBadge level="admin" colors={{ admin: "bg-red-100 text-red-700" }} />);
      expect(container.firstChild).toHaveClass("bg-red-100", "text-red-700");
    });

    it("keeps default colors for levels not in override", () => {
      const { container } = render(<WishLockBadge level="family" colors={{ admin: "bg-red-100 text-red-700" }} />);
      expect(container.firstChild).toHaveClass("bg-gray-100", "text-gray-600");
    });
  });
});

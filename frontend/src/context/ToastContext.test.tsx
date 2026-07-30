import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ToastApi } from "./ToastContext";
import { ToastContainer, useToast } from "./ToastContext";

// Helper component that uses the toast hook
function TestToastComponent({ action }: { action: (toast: ToastApi) => void }) {
  const toast = useToast();
  action(toast);
  return <div>Test</div>;
}

describe("ToastContext", () => {
  it("shows an error toast", () => {
    const action = (t: ToastApi) => t.error("Something went wrong");
    render(
      <ToastContainer>
        <TestToastComponent action={action} />
      </ToastContainer>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("shows a success toast", () => {
    const action = (t: ToastApi) => t.success("Saved successfully");
    render(
      <ToastContainer>
        <TestToastComponent action={action} />
      </ToastContainer>
    );

    expect(screen.getByText("Saved successfully")).toBeInTheDocument();
  });

  it("shows an info toast", () => {
    const action = (t: ToastApi) => t.info("Here is some info");
    render(
      <ToastContainer>
        <TestToastComponent action={action} />
      </ToastContainer>
    );

    expect(screen.getByText("Here is some info")).toBeInTheDocument();
  });

  it("renders dismiss button on each toast", () => {
    const action = (t: ToastApi) => t.error("Has dismiss button");
    render(
      <ToastContainer>
        <TestToastComponent action={action} />
      </ToastContainer>
    );

    const dismissButtons = screen.getAllByRole("button", { name: /dismiss/i });
    expect(dismissButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("throws when useToast is called outside provider", () => {
    function NoProvider() {
      useToast();
      return null;
    }

    expect(() => render(<NoProvider />)).toThrow("useToast must be used inside <ToastProvider>");
  });

  it("stacks multiple toasts", () => {
    const action = (t: ToastApi) => {
      t.error("First error");
      t.success("Success message");
      t.info("Info message");
    };
    render(
      <ToastContainer>
        <TestToastComponent action={action} />
      </ToastContainer>
    );

    expect(screen.getByText("First error")).toBeInTheDocument();
    expect(screen.getByText("Success message")).toBeInTheDocument();
    expect(screen.getByText("Info message")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <ToastContainer>
        <div data-testid="child">Child content</div>
      </ToastContainer>
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});

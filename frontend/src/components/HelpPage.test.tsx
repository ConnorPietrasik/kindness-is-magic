import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import { ROLE_HOME, ROUTES } from "../lib/routes";
import { HelpImage } from "./HelpImage";
import { HelpPage, type HelpSection } from "./HelpPage";

const mockUseAuth = useAuth as unknown as Mock;

const sections: HelpSection[] = [
  { id: "first", title: "First Section", body: <p>Body one</p> },
  { id: "second", title: "Second Section", body: <p>Body two</p> },
];

const renderGuide = (props: Partial<React.ComponentProps<typeof HelpPage>> = {}) => {
  mockUseAuth.mockReturnValue({ user: null, isLoading: false });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/help/admin"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <HelpPage title="Admin Guide" intro={<p>Intro text</p>} sections={sections} backTo="/dashboard" {...props} />
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

describe("HelpPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the title, intro, and every section with its id", () => {
    renderGuide();

    expect(screen.getByRole("heading", { level: 1, name: "Admin Guide" })).toBeInTheDocument();
    expect(screen.getByText("Intro text")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "First Section" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Second Section" })).toBeInTheDocument();
    expect(screen.getByText("Body one")).toBeInTheDocument();
    expect(screen.getByText("Body two")).toBeInTheDocument();
  });

  it("builds a table of contents with one anchor per section", () => {
    renderGuide();

    const toc = screen.getByRole("navigation", { name: "On this page" });
    expect(within(toc).getByRole("link", { name: "First Section" })).toHaveAttribute("href", "#first");
    expect(within(toc).getByRole("link", { name: "Second Section" })).toHaveAttribute("href", "#second");
    expect(within(toc).getAllByRole("link")).toHaveLength(2);
  });

  it("links back to the role home for role guides", () => {
    renderGuide({ backTo: ROLE_HOME.admin });

    expect(screen.getByRole("link", { name: "← Back" })).toHaveAttribute("href", "/dashboard");
  });

  it("links back to the brochure for public guides and renders the site footer", () => {
    renderGuide({ backTo: ROUTES.HOME, backLabel: "Home", renderFooter: true });

    expect(screen.getByRole("link", { name: "← Home" })).toHaveAttribute("href", "/home");
    // The footer carries the brochure links
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Wish List Guide" })).toHaveAttribute("href", "/wish-list-guide");
    expect(within(footer).getByRole("link", { name: "Sponsor Guide" })).toHaveAttribute("href", "/help/donor");
  });

  it("renders no footer when renderFooter is off (ProtectedRoute provides it)", () => {
    renderGuide();

    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("HelpImage renders the screenshot with a caption", () => {
    const { container } = render(<HelpImage src="test.png" alt="The dashboard" caption="Your dashboard" />);

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "test.png");
    expect(img).toHaveAttribute("alt", "The dashboard");
    expect(screen.getByText("Your dashboard")).toBeInTheDocument();
  });

  it("HelpImage reserves the capture's intrinsic size so anchor jumps land correctly", () => {
    const { container } = render(<HelpImage src="test.png" alt="The dashboard" />);

    /* 1440x1000 is the capture standard (e2e capture config); the attributes
       give the lazy image a pre-load height so TOC jumps don't drift */
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("width", "1440");
    expect(img).toHaveAttribute("height", "1000");
  });
});

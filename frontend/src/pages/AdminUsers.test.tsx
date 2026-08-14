import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { FamilyDropdownItem, ReferrerDropdownItem, UserDetail, UserListResponse } from "../types";
import AdminUsers from "./AdminUsers";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeUser(overrides: Partial<UserDetail>): UserDetail {
  return {
    id: 0,
    email: "user@example.org",
    display_name: "Some User",
    role: "family",
    referrer_id: null,
    family_id: null,
    deleted_at: null,
    created_at: "2025-01-01T00:00:00Z",
    referrer_name: null,
    family_name: null,
    ...overrides,
  };
}

const mockUser1 = makeUser({ id: 1, email: "admin@example.org", display_name: "Admin A", role: "admin" });
const mockUser2 = makeUser({
  id: 2,
  email: "ref@example.org",
  display_name: "Ref R",
  role: "referrer",
  referrer_id: 1,
  referrer_name: "Hope Referrer",
});
const mockUserDeleted = makeUser({
  id: 3,
  email: "gone@example.org",
  display_name: "Gone G",
  role: "family",
  family_id: 5,
  family_name: "The Johnsons",
  deleted_at: "2025-02-02T00:00:00Z",
});

const mockListResponse: UserListResponse = { users: [mockUser1, mockUser2], total: 2, page: 1, page_size: 20, total_pages: 1 };
const mockDeletedResponse: UserListResponse = { users: [mockUserDeleted], total: 1, page: 1, page_size: 20, total_pages: 1 };

const mockReferrer: ReferrerDropdownItem = { id: 1, name: "Hope Referrer" };
const mockFamily: FamilyDropdownItem = { id: 5, family_name: "The Johnsons" };

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={["/admin/users"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>{ui}</ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

function mockListApis() {
  vi.spyOn(api, "adminListUsers").mockResolvedValue(mockListResponse);
  vi.spyOn(api, "adminListDeletedUsers").mockResolvedValue(mockDeletedResponse);
  vi.spyOn(api, "adminGetReferrersDropdown").mockResolvedValue([mockReferrer]);
  vi.spyOn(api, "adminGetFamiliesDropdown").mockResolvedValue([mockFamily]);
}

/** The form's role select (unlike the page filters, its first option has value "admin"). */
function getFormRoleSelect(): HTMLSelectElement {
  const selects = Array.from(document.querySelectorAll("select"));
  const select = selects.find((s) => s.options[0]?.value === "admin");
  expect(select).not.toBeUndefined();
  return select!;
}

/** Finds the FK select by its placeholder option text. */
function getFkSelect(placeholderText: string): HTMLSelectElement {
  const selects = Array.from(document.querySelectorAll("select"));
  const select = selects.find((s) => Array.from(s.options).some((o) => o.textContent === placeholderText));
  expect(select).not.toBeUndefined();
  return select!;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminUsers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("renders loading state initially", () => {
    vi.spyOn(api, "adminListUsers").mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, "adminGetReferrersDropdown").mockResolvedValue([]);
    vi.spyOn(api, "adminGetFamiliesDropdown").mockResolvedValue([]);

    wrap(<AdminUsers />);
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("renders user list with mocked data", async () => {
    mockListApis();

    wrap(<AdminUsers />);

    await waitFor(() => {
      expect(screen.getByText("admin@example.org")).toBeInTheDocument();
    });

    expect(screen.getByText("Admin A")).toBeInTheDocument();
    expect(screen.getByText("ref@example.org")).toBeInTheDocument();
    expect(screen.getByText("Ref R")).toBeInTheDocument();
    // Role badges
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("referrer")).toBeInTheDocument();
    // Linked referrer renders as a link
    expect(screen.getByText("Hope Referrer")).toBeInTheDocument();
  });

  it("shows empty state when no users", async () => {
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
    vi.spyOn(api, "adminGetReferrersDropdown").mockResolvedValue([]);
    vi.spyOn(api, "adminGetFamiliesDropdown").mockResolvedValue([]);

    wrap(<AdminUsers />);

    await waitFor(() => {
      expect(screen.getByText("No users found.")).toBeInTheDocument();
    });
  });

  it("role filter refetches with the selected role", async () => {
    const user = userEvent.setup();
    mockListApis();

    wrap(<AdminUsers />);

    await waitFor(() => {
      expect(screen.getByText("admin@example.org")).toBeInTheDocument();
    });

    const roleSelect = screen.getByText("All roles").closest("select");
    expect(roleSelect).not.toBeNull();
    await user.selectOptions(roleSelect!, "referrer");

    await waitFor(() => {
      expect(api.adminListUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: "referrer" }));
    });
  });

  it("create user as referrer sends referrer_id and null family_id", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminCreateUser").mockImplementation((data: Parameters<typeof api.adminCreateUser>[0]) =>
      Promise.resolve(makeUser({ ...mockUser2, ...data, display_name: data.display_name ?? "New Ref" }))
    );

    wrap(<AdminUsers />);

    await waitFor(() => {
      expect(screen.getByText("admin@example.org")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "+ Add User" }));

    await waitFor(() => {
      expect(screen.getByText("Add User")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Email"), "newref@example.org");
    await user.type(screen.getByLabelText("Display Name"), "New Ref");
    // Default role is referrer — pick the referrer
    await user.selectOptions(getFkSelect("Select a referrer…"), "1");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "password123");

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(api.adminCreateUser).toHaveBeenCalledWith(
        {
          email: "newref@example.org",
          password: "password123",
          role: "referrer",
          display_name: "New Ref",
          referrer_id: 1,
          family_id: null,
        },
        expect.anything()
      );
    });
    await waitFor(() => {
      expect(screen.getByText("User created")).toBeInTheDocument();
    });
  });

  it("create user as family swaps the FK dropdown and sends family_id", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminCreateUser").mockImplementation((data: Parameters<typeof api.adminCreateUser>[0]) =>
      Promise.resolve(makeUser({ ...mockUserDeleted, ...data, display_name: data.display_name ?? "Fam F", deleted_at: null }))
    );

    wrap(<AdminUsers />);

    await waitFor(() => {
      expect(screen.getByText("admin@example.org")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "+ Add User" }));

    await waitFor(() => {
      expect(screen.getByText("Add User")).toBeInTheDocument();
    });

    // Switch role to family — referrer select disappears, family select appears
    await user.selectOptions(getFormRoleSelect(), "family");
    const remainingReferrerSelects = Array.from(document.querySelectorAll("select")).filter((s) =>
      Array.from(s.options).some((o) => o.textContent === "Select a referrer…")
    );
    expect(remainingReferrerSelects).toHaveLength(0);
    await user.selectOptions(getFkSelect("Select a family…"), "5");

    await user.type(screen.getByLabelText("Email"), "newfam@example.org");
    await user.type(screen.getByLabelText("Display Name"), "Fam F");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "password123");

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(api.adminCreateUser).toHaveBeenCalledWith(
        {
          email: "newfam@example.org",
          password: "password123",
          role: "family",
          display_name: "Fam F",
          referrer_id: null,
          family_id: 5,
        },
        expect.anything()
      );
    });
  });

  it("create user with mismatched passwords shows error and does not call API", async () => {
    const user = userEvent.setup();
    mockListApis();
    const createSpy = vi.spyOn(api, "adminCreateUser").mockResolvedValue(mockUser2);

    wrap(<AdminUsers />);

    await waitFor(() => {
      expect(screen.getByText("admin@example.org")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "+ Add User" }));

    await waitFor(() => {
      expect(screen.getByText("Add User")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Email"), "newref@example.org");
    await user.selectOptions(getFkSelect("Select a referrer…"), "1");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "different123");

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("edit user submits only changed fields", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminGetUser").mockImplementation((id: number) => Promise.resolve(id === 1 ? mockUser1 : mockUser2));
    vi.spyOn(api, "adminUpdateUser").mockResolvedValue(makeUser({ ...mockUser1, display_name: "Admin A2" }));

    wrap(<AdminUsers />);

    await waitFor(() => {
      expect(screen.getByText("admin@example.org")).toBeInTheDocument();
    });

    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText("Edit User")).toBeInTheDocument();
    });

    // Email is locked in edit mode
    expect((screen.getByLabelText("Email") as HTMLInputElement).disabled).toBe(true);

    await user.clear(screen.getByLabelText("Display Name"));
    await user.type(screen.getByLabelText("Display Name"), "Admin A2");

    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(api.adminUpdateUser).toHaveBeenCalledWith(1, {
        display_name: "Admin A2",
        referrer_id: 0,
        family_id: 0,
      });
    });
    await waitFor(() => {
      expect(screen.getByText("User updated")).toBeInTheDocument();
    });
  });

  it("changing role to family nulls the referrer via the 0 sentinel", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminGetUser").mockImplementation((id: number) => Promise.resolve(id === 1 ? mockUser1 : mockUser2));
    vi.spyOn(api, "adminUpdateUser").mockResolvedValue(makeUser({ ...mockUser2, role: "family", referrer_id: null, family_id: 5 }));

    wrap(<AdminUsers />);

    await waitFor(() => {
      expect(screen.getByText("ref@example.org")).toBeInTheDocument();
    });

    // Edit user 2 (referrer linked to referrer 1)
    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[1]!);

    await waitFor(() => {
      expect(screen.getByText("Edit User")).toBeInTheDocument();
    });

    await user.selectOptions(getFormRoleSelect(), "family");
    await user.selectOptions(getFkSelect("Select a family…"), "5");

    await user.click(screen.getByRole("button", { name: "Update" }));

    // referrer_id 0 is the backend sentinel for "set FK to NULL"
    await waitFor(() => {
      expect(api.adminUpdateUser).toHaveBeenCalledWith(2, {
        role: "family",
        referrer_id: 0,
        family_id: 5,
      });
    });
  });

  it("reset password validates match before calling API", async () => {
    const user = userEvent.setup();
    mockListApis();
    const resetSpy = vi.spyOn(api, "adminResetUserPassword").mockResolvedValue(mockUser2);

    wrap(<AdminUsers />);

    await waitFor(() => {
      expect(screen.getByText("ref@example.org")).toBeInTheDocument();
    });

    // Open the row dropdown (row 1 = user 2)
    const triggers = screen.getAllByRole("button", { name: "More actions" });
    await user.click(triggers[1]!);
    await user.click(screen.getByRole("menuitem", { name: "Reset Pw" }));

    await waitFor(() => {
      expect(screen.getByText(/Reset password for user/)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("New password"), "newpass123");
    await user.type(screen.getByLabelText("Confirm password"), "mismatch123");
    await user.click(screen.getByRole("button", { name: "Set Password" }));

    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    expect(resetSpy).not.toHaveBeenCalled();

    // Fix the confirm field and submit again
    await user.clear(screen.getByLabelText("Confirm password"));
    await user.type(screen.getByLabelText("Confirm password"), "newpass123");
    await user.click(screen.getByRole("button", { name: "Set Password" }));

    await waitFor(() => {
      expect(resetSpy).toHaveBeenCalledWith(2, { password: "newpass123" });
    });
    await waitFor(() => {
      expect(screen.getByText("Password reset")).toBeInTheDocument();
    });
  });

  it("delete flow confirms and calls API", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminDeleteUser").mockResolvedValue(undefined);

    wrap(<AdminUsers />);

    await waitFor(() => {
      expect(screen.getByText("admin@example.org")).toBeInTheDocument();
    });

    const triggers = screen.getAllByRole("button", { name: "More actions" });
    await user.click(triggers[0]!);
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText(/Delete user/)).toBeInTheDocument();
    });
    expect(api.adminDeleteUser).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => {
      expect(api.adminDeleteUser).toHaveBeenCalledWith(1, expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByText("User deleted")).toBeInTheDocument();
    });
  });

  it("deleted tab restores users", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminRestoreUser").mockResolvedValue(makeUser({ ...mockUserDeleted, deleted_at: null }));

    wrap(<AdminUsers />);

    await waitFor(() => {
      expect(screen.getByText("admin@example.org")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "Deleted" }));

    await waitFor(() => {
      expect(api.adminListDeletedUsers).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("Gone G")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.getByText(/Restore user/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Yes, restore" }));

    await waitFor(() => {
      expect(api.adminRestoreUser).toHaveBeenCalledWith(3, expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByText("User restored")).toBeInTheDocument();
    });
  });
});

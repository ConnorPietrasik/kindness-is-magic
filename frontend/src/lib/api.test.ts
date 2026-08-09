import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// We need to mock axios before importing the api module.
// The module registers an interceptor at import time, so we capture it.
// The axios instance is both a callable function AND has .get/.post/etc methods.
// Use `var` so vi.mock (hoisted) can assign to it before `let` would be available.
interface MockAxiosInstance extends Mock {
  get: Mock;
  post: Mock;
  put: Mock;
  patch: Mock;
  delete: Mock;
  interceptors: {
    request: {
      use: Mock;
    };
    response: {
      use: Mock;
    };
  };
}

var mockAxiosInstance: MockAxiosInstance;

vi.mock("axios", () => {
  // Create a callable mock (axios instances are functions with extra methods)
  mockAxiosInstance = vi.fn().mockResolvedValue({ data: null }) as unknown as MockAxiosInstance;
  mockAxiosInstance.get = vi.fn();
  mockAxiosInstance.post = vi.fn();
  mockAxiosInstance.put = vi.fn();
  mockAxiosInstance.patch = vi.fn();
  mockAxiosInstance.delete = vi.fn();
  mockAxiosInstance.interceptors = {
    request: {
      use: vi.fn(),
    },
    response: {
      use: vi.fn(),
    },
  };

  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
    },
  };
});

// Import after mocking — this registers the interceptor on our mock
import * as apiModule from "./api";

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
describe("auth API functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetchCurrentUser — GET /api/auth/me, returns .data", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 1, role: "admin" } });
    const result = await apiModule.fetchCurrentUser();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/auth/me");
    expect(result).toEqual({ id: 1, role: "admin" });
  });

  it("fetchCurrentUser — returns null on 401", async () => {
    const error = Object.assign(new Error("Unauthorized"), {
      response: { status: 401, data: { detail: "Not authenticated" } },
    });
    mockAxiosInstance.get.mockRejectedValueOnce(error);
    const result = await apiModule.fetchCurrentUser();
    expect(result).toBeNull();
  });

  it("fetchCurrentUser — re-throws non-401 errors", async () => {
    const error = Object.assign(new Error("Server error"), {
      response: { status: 500, data: { detail: "Internal error" } },
    });
    mockAxiosInstance.get.mockRejectedValueOnce(error);
    await expect(apiModule.fetchCurrentUser()).rejects.toBe(error);
  });

  it("loginRequest — POST /api/auth/login with body, returns raw axios response", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { token: "abc" } });
    const result = await apiModule.loginRequest("a@b.com", "pass");
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/auth/login", {
      email: "a@b.com",
      password: "pass",
    });
    // loginRequest does NOT strip .data — returns full axios response
    expect(result).toEqual({ data: { token: "abc" } });
  });

  it("logoutRequest — POST /api/auth/logout", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: null });
    await apiModule.logoutRequest();
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/auth/logout");
  });

  it("forgotPasswordRequest — POST /api/auth/forgot-password with email", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { ok: true } });
    await apiModule.forgotPasswordRequest("user@example.com");
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/auth/forgot-password", {
      email: "user@example.com",
    });
  });

  it("resetPasswordRequest — POST /api/auth/reset-password with token and new_password", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { ok: true } });
    await apiModule.resetPasswordRequest("tok123", "newpass");
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/auth/reset-password", {
      token: "tok123",
      new_password: "newpass",
    });
  });

  it("changePasswordRequest — PUT /api/auth/me/password", async () => {
    mockAxiosInstance.put.mockResolvedValueOnce({ data: { ok: true } });
    await apiModule.changePasswordRequest("old", "new");
    expect(mockAxiosInstance.put).toHaveBeenCalledWith("/api/auth/me/password", {
      old_password: "old",
      new_password: "new",
    });
  });

  it("updateMyProfile — PATCH /api/auth/me with display_name", async () => {
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 1, email: "a@b.com", display_name: "Alice" } });
    const result = await apiModule.updateMyProfile("Alice");
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/auth/me", { display_name: "Alice" });
    expect(result).toEqual({ id: 1, email: "a@b.com", display_name: "Alice" });
  });

  it("updateMyProfile — PATCH /api/auth/me with empty string to clear", async () => {
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 1, email: "a@b.com", display_name: "a" } });
    const result = await apiModule.updateMyProfile("");
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/auth/me", { display_name: "" });
    expect(result).toEqual({ id: 1, email: "a@b.com", display_name: "a" });
  });
});

// ---------------------------------------------------------------------------
// Admin — Referrers
// ---------------------------------------------------------------------------
describe("admin referrer API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adminListReferrers — GET /api/admin/referrers", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1 }] });
    const result = await apiModule.adminListReferrers();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/referrers");
    expect(result).toEqual([{ id: 1 }]);
  });

  it("adminGetReferrer — GET /api/admin/referrers/:id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 5 } });
    await apiModule.adminGetReferrer(5);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/referrers/5");
  });

  it("adminCreateReferrer — POST /api/admin/referrers with data", async () => {
    const body = { name: "Test Referrer" };
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 10 } });
    const result = await apiModule.adminCreateReferrer(body);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/referrers", body);
    expect(result).toEqual({ id: 10 });
  });

  it("adminUpdateReferrer — PATCH /api/admin/referrers/:id", async () => {
    const body = { name: "Updated Referrer" };
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 5, name: "Updated Referrer" } });
    await apiModule.adminUpdateReferrer(5, body);
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/admin/referrers/5", body);
  });

  it("adminDeleteReferrer — DELETE /api/admin/referrers/:id", async () => {
    mockAxiosInstance.delete.mockResolvedValueOnce({ data: null });
    await apiModule.adminDeleteReferrer(5);
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/api/admin/referrers/5");
  });

  it("adminRestoreReferrer — POST /api/admin/referrers/:id/restore", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5 } });
    await apiModule.adminRestoreReferrer(5);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/referrers/5/restore");
  });

  it("adminApproveReferrer — POST /api/admin/referrers/:id/approve", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5, approval_status: "approved" } });
    const result = await apiModule.adminApproveReferrer(5);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/referrers/5/approve");
    expect(result).toEqual({ id: 5, approval_status: "approved" });
  });

  it("adminRejectReferrer — POST /api/admin/referrers/:id/reject", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5, approval_status: "rejected" } });
    const result = await apiModule.adminRejectReferrer(5);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/referrers/5/reject");
    expect(result).toEqual({ id: 5, approval_status: "rejected" });
  });

  it("adminListDeletedReferrers — GET /api/admin/referrers/deleted", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { referrers: [], total: 0, page: 1, page_size: 50, total_pages: 0 } });
    await apiModule.adminListDeletedReferrers();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/referrers/deleted");
  });

  it("adminListDeletedReferrers with params", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { referrers: [], total: 0, page: 1, page_size: 50, total_pages: 0 } });
    await apiModule.adminListDeletedReferrers({ page: 2, page_size: 10 });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/referrers/deleted", {
      params: { page: 2, page_size: 10 },
    });
  });

  it("adminGetReferrersDropdown — GET /api/admin/referrers/dropdown", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, name: "Smith Org" }] });
    const result = await apiModule.adminGetReferrersDropdown();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/referrers/dropdown");
    expect(result).toEqual([{ id: 1, name: "Smith Org" }]);
  });
});

// ---------------------------------------------------------------------------
// Admin — Invite Tokens
// ---------------------------------------------------------------------------
describe("admin invite API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adminListInvites — GET /api/admin/invites", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { invites: [], total: 0, page: 1, page_size: 50, total_pages: 0 } });
    const result = await apiModule.adminListInvites();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/invites");
    expect(result).toEqual({ invites: [], total: 0, page: 1, page_size: 50, total_pages: 0 });
  });

  it("adminListInvites with params", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { invites: [], total: 0, page: 1, page_size: 50, total_pages: 0 } });
    await apiModule.adminListInvites({ page: 2, page_size: 10, redeemed: true, expired: false });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/invites", {
      params: { page: 2, page_size: 10, redeemed: true, expired: false },
    });
  });

  it("adminGetInvite — GET /api/admin/invites/:id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 3, code: "KMG-ABC" } });
    await apiModule.adminGetInvite(3);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/invites/3");
  });

  it("adminRevokeInvite — POST /api/admin/invites/:id/revoke", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 3, code: "KMG-ABC" } });
    const result = await apiModule.adminRevokeInvite(3);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/invites/3/revoke");
    expect(result).toEqual({ id: 3, code: "KMG-ABC" });
  });
});

// ---------------------------------------------------------------------------
// Admin — Families
// ---------------------------------------------------------------------------
describe("admin family API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adminListFamilies — GET /api/admin/families", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1 }] });
    await apiModule.adminListFamilies();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/families");
  });

  it("adminGetFamily — GET /api/admin/families/:id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 3 } });
    await apiModule.adminGetFamily(3);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/families/3");
  });

  it("adminCreateFamily — POST /api/admin/families", async () => {
    const body = { family_name: "Smith", contact_name: "Contact", family_wish: "Wish" };
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 7 } });
    await apiModule.adminCreateFamily(body);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/families", body);
  });

  it("adminUpdateFamily — PATCH /api/admin/families/:id", async () => {
    const body = { family_name: "Jones" };
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 3, family_name: "Jones" } });
    await apiModule.adminUpdateFamily(3, body);
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/admin/families/3", body);
  });

  it("adminDeleteFamily — DELETE /api/admin/families/:id", async () => {
    mockAxiosInstance.delete.mockResolvedValueOnce({ data: null });
    await apiModule.adminDeleteFamily(3);
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/api/admin/families/3");
  });

  it("adminGetFamiliesDropdown — GET /api/admin/families/dropdown", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, family_name: "The Smiths" }] });
    const result = await apiModule.adminGetFamiliesDropdown();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/families/dropdown");
    expect(result).toEqual([{ id: 1, family_name: "The Smiths" }]);
  });
});

// ---------------------------------------------------------------------------
// Admin — Users
// ---------------------------------------------------------------------------
describe("admin user API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adminListUsers — GET /api/admin/users", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [], total: 0, page: 1, page_size: 20, total_pages: 0 } });
    const result = await apiModule.adminListUsers();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/users");
    expect(result).toEqual({ users: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
  });

  it("adminListUsers with params — merges filters", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [], total: 0, page: 1, page_size: 20, total_pages: 0 } });
    await apiModule.adminListUsers({ page: 2, page_size: 10, role: "admin", search: "test" });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/users", {
      params: { page: 2, page_size: 10, role: "admin", search: "test" },
    });
  });

  it("adminGetUser — GET /api/admin/users/:id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 5 } });
    await apiModule.adminGetUser(5);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/users/5");
  });

  it("adminCreateUser — POST /api/admin/users", async () => {
    const body = { email: "test@example.com", password: "secret123", role: "referrer" as const, referrer_id: 1 };
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 10 } });
    const result = await apiModule.adminCreateUser(body);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/users", body);
    expect(result).toEqual({ id: 10 });
  });

  it("adminUpdateUser — PATCH /api/admin/users/:id", async () => {
    const body = { display_name: "Updated Name" };
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 5 } });
    await apiModule.adminUpdateUser(5, body);
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/admin/users/5", body);
  });

  it("adminResetUserPassword — POST /api/admin/users/:id/reset-password", async () => {
    const body = { password: "newpass123" };
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5 } });
    await apiModule.adminResetUserPassword(5, body);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/users/5/reset-password", body);
  });

  it("adminDeleteUser — DELETE /api/admin/users/:id", async () => {
    mockAxiosInstance.delete.mockResolvedValueOnce({ data: null });
    await apiModule.adminDeleteUser(5);
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/api/admin/users/5");
  });

  it("adminRestoreUser — POST /api/admin/users/:id/restore", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5 } });
    await apiModule.adminRestoreUser(5);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/users/5/restore");
  });

  it("adminListDeletedUsers — GET /api/admin/users/deleted", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [], total: 0, page: 1, page_size: 20, total_pages: 0 } });
    await apiModule.adminListDeletedUsers();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/users/deleted");
  });

  it("adminListDeletedUsers with params", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [], total: 0, page: 1, page_size: 20, total_pages: 0 } });
    await apiModule.adminListDeletedUsers({ page: 2, page_size: 10, role: "admin", search: "test" });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/users/deleted", {
      params: { page: 2, page_size: 10, role: "admin", search: "test" },
    });
  });

  it("adminGetUsersDropdown — GET /api/admin/users/dropdown", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, display_name: "Alice" }] });
    const result = await apiModule.adminGetUsersDropdown();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/users/dropdown");
    expect(result).toEqual([{ id: 1, display_name: "Alice" }]);
  });

  it("adminGetUsersDropdown with roles — GET /api/admin/users/dropdown?roles=delivery", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 2, display_name: "Bob" }] });
    const result = await apiModule.adminGetUsersDropdown("delivery");
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/users/dropdown", { params: { roles: "delivery" } });
    expect(result).toEqual([{ id: 2, display_name: "Bob" }]);
  });
});

// ---------------------------------------------------------------------------
// Admin — People
// ---------------------------------------------------------------------------
describe("admin people API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adminListPeople — GET /api/admin/people", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1 }] });
    await apiModule.adminListPeople();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/people");
  });

  it("adminGetPerson — GET /api/admin/people/:id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 2 } });
    await apiModule.adminGetPerson(2);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/people/2");
  });

  it("adminCreatePerson — POST /api/admin/people", async () => {
    const body = {
      given_name: "Jane",
      age: 10,
      wishes: [
        { type: "practical" as const, description: "Wish" },
        { type: "fun" as const, description: "Wish" },
      ],
    };
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 9 } });
    await apiModule.adminCreatePerson(body);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/people", body);
  });

  it("adminUpdatePerson — PATCH /api/admin/people/:id", async () => {
    const body = { given_name: "Updated" };
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 2 } });
    await apiModule.adminUpdatePerson(2, body);
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/admin/people/2", body);
  });

  it("adminDeletePerson — DELETE /api/admin/people/:id", async () => {
    mockAxiosInstance.delete.mockResolvedValueOnce({ data: null });
    await apiModule.adminDeletePerson(2);
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/api/admin/people/2");
  });

  it("adminListFamilyPeople — GET /api/admin/people?family_id=fid", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { people: [{ id: 1 }], total: 1, page: 1, page_size: 50, total_pages: 1 } });
    await apiModule.adminListFamilyPeople(5);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/people", { params: { family_id: 5 } });
  });

  it("adminListFamilyPeople with pagination — merges params with family_id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { people: [{ id: 1 }], total: 1, page: 1, page_size: 50, total_pages: 1 } });
    await apiModule.adminListFamilyPeople(5, { page: 2, page_size: 25 });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/people", {
      params: { page: 2, page_size: 25, family_id: 5 },
    });
  });

  it("adminListDeletedFamilies — GET /api/admin/families/deleted", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { families: [], total: 0, page: 1, page_size: 50, total_pages: 0 } });
    await apiModule.adminListDeletedFamilies();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/families/deleted");
  });

  it("adminListDeletedFamilies with params", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { families: [], total: 0, page: 1, page_size: 50, total_pages: 0 } });
    await apiModule.adminListDeletedFamilies({ page: 2, page_size: 10, referrer_id: 3 });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/families/deleted", {
      params: { page: 2, page_size: 10, referrer_id: 3 },
    });
  });

  it("adminListDeletedPeople — GET /api/admin/people/deleted", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { people: [], total: 0, page: 1, page_size: 50, total_pages: 0 } });
    await apiModule.adminListDeletedPeople();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/people/deleted");
  });

  it("adminListDeletedPeople with params", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { people: [], total: 0, page: 1, page_size: 50, total_pages: 0 } });
    await apiModule.adminListDeletedPeople({ page: 2, page_size: 10, family_id: 5 });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/people/deleted", {
      params: { page: 2, page_size: 10, family_id: 5 },
    });
  });

  it("adminListReferrerFamilies — GET /api/admin/families?referrer_id=rid", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { families: [{ id: 1 }], total: 1, page: 1, page_size: 50, total_pages: 1 } });
    await apiModule.adminListReferrerFamilies(3);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/families", { params: { referrer_id: 3 } });
  });

  it("adminListReferrerFamilies with pagination — merges params with referrer_id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { families: [{ id: 1 }], total: 1, page: 1, page_size: 50, total_pages: 1 } });
    await apiModule.adminListReferrerFamilies(3, { page: 2, page_size: 10 });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/families", {
      params: { page: 2, page_size: 10, referrer_id: 3 },
    });
  });
});

// ---------------------------------------------------------------------------
// Admin — CSV Import
// ---------------------------------------------------------------------------
describe("admin CSV API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adminGetCsvSample — GET /api/admin/csv-sample", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: "name,email\n" });
    await apiModule.adminGetCsvSample();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/csv-sample");
  });

  it("adminImportCsv with plain string — POST /api/admin/import-csv", async () => {
    const csv = "name,email\nJane,j@e.com";
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { imported: 1 } });
    await apiModule.adminImportCsv(csv);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/import-csv", csv, {
      headers: { "Content-Type": "text/csv" },
    });
  });
});

// ---------------------------------------------------------------------------
// Referrer — Self
// ---------------------------------------------------------------------------
describe("referrer self API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getReferrerMe — GET /api/referrer/me", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 1 } });
    await apiModule.getReferrerMe();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/referrer/me");
  });

  it("patchReferrerMe — PATCH /api/referrer/me", async () => {
    const body = { name: "New Name" };
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 1 } });
    await apiModule.patchReferrerMe(body);
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/referrer/me", body);
  });
});

// ---------------------------------------------------------------------------
// Referrer — Families
// ---------------------------------------------------------------------------
describe("referrer family API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listReferrerFamilies — GET /api/referrer/families", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1 }] });
    await apiModule.listReferrerFamilies();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/referrer/families");
  });

  it("getReferrerFamily — GET /api/referrer/families/:id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 4 } });
    await apiModule.getReferrerFamily(4);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/referrer/families/4");
  });

  it("createReferrerFamily — POST /api/referrer/families", async () => {
    const body = { family_name: "Doe", contact_name: "Contact", family_wish: "Wish" };
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 8 } });
    await apiModule.createReferrerFamily(body);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/referrer/families", body);
  });

  it("updateReferrerFamily — PATCH /api/referrer/families/:id", async () => {
    const body = { family_name: "Doe Updated" };
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 4 } });
    await apiModule.updateReferrerFamily(4, body);
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/referrer/families/4", body);
  });

  it("deleteReferrerFamily — DELETE /api/referrer/families/:id", async () => {
    mockAxiosInstance.delete.mockResolvedValueOnce({ data: null });
    await apiModule.deleteReferrerFamily(4);
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/api/referrer/families/4");
  });
});

// ---------------------------------------------------------------------------
// Referrer — People within a family
// ---------------------------------------------------------------------------
describe("referrer family people API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listReferrerFamilyPeople — GET /api/referrer/families/:fid/people", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1 }] });
    await apiModule.listReferrerFamilyPeople(4);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/referrer/families/4/people");
  });

  it("createReferrerFamilyPerson — POST /api/referrer/families/:fid/people", async () => {
    const body = {
      given_name: "Bob",
      age: 10,
      wishes: [
        { type: "practical" as const, description: "Wish" },
        { type: "fun" as const, description: "Wish" },
      ],
    };
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 11 } });
    await apiModule.createReferrerFamilyPerson(4, body);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/referrer/families/4/people", body);
  });
});

// ---------------------------------------------------------------------------
// Family — Self
// ---------------------------------------------------------------------------
describe("family self API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getFamilyMe — GET /api/family/me", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 1 } });
    await apiModule.getFamilyMe();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/family/me");
  });

  it("patchFamilyMe — PATCH /api/family/me", async () => {
    const body = { family_name: "Updated Family" };
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 1 } });
    await apiModule.patchFamilyMe(body);
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/family/me", body);
  });
});

// ---------------------------------------------------------------------------
// Family — People
// ---------------------------------------------------------------------------
describe("family people API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listFamilyPeople — GET /api/family/people", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1 }] });
    await apiModule.listFamilyPeople();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/family/people");
  });

  it("createFamilyPerson — POST /api/family/people", async () => {
    const body = {
      given_name: "Alice",
      age: 10,
      wishes: [
        { type: "practical" as const, description: "Wish" },
        { type: "fun" as const, description: "Wish" },
      ],
    };
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 12 } });
    await apiModule.createFamilyPerson(body);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/family/people", body);
  });
});

// ---------------------------------------------------------------------------
// Shared — Person (multi-role)
// ---------------------------------------------------------------------------
describe("shared person API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getPerson — GET /api/people/:id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 7 } });
    await apiModule.getPerson(7);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/people/7");
  });

  it("updatePerson — PATCH /api/people/:id", async () => {
    const body = { given_name: "Updated" };
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 7 } });
    await apiModule.updatePerson(7, body);
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/people/7", body);
  });

  it("deletePerson — DELETE /api/people/:id", async () => {
    mockAxiosInstance.delete.mockResolvedValueOnce({ data: null });
    await apiModule.deletePerson(7);
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/api/people/7");
  });
});

// ---------------------------------------------------------------------------
// Family — Wish Review
// ---------------------------------------------------------------------------
describe("family wish review API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requestFamilyReview — POST /api/family/me/request-review", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 1, wish_lock_level: "family" } });
    const result = await apiModule.requestFamilyReview();
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/family/me/request-review");
    expect(result).toEqual({ id: 1, wish_lock_level: "family" });
  });

  it("cancelFamilyReview — POST /api/family/me/cancel-review", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 1, wish_lock_level: "family" } });
    const result = await apiModule.cancelFamilyReview();
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/family/me/cancel-review");
    expect(result).toEqual({ id: 1, wish_lock_level: "family" });
  });
});

// ---------------------------------------------------------------------------
// Referrer — Wish Review Queue
// ---------------------------------------------------------------------------
describe("referrer wish review API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listReferrerReviewQueue — GET /api/referrer/review-queue", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, family_name: "Smiths" }] });
    const result = await apiModule.listReferrerReviewQueue();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/referrer/review-queue");
    expect(result).toEqual([{ id: 1, family_name: "Smiths" }]);
  });

  it("referrerApproveWishes — POST /api/referrer/families/:id/approve-wishes", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5, wish_lock_level: "referrer" } });
    const result = await apiModule.referrerApproveWishes(5);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/referrer/families/5/approve-wishes");
    expect(result).toEqual({ id: 5, wish_lock_level: "referrer" });
  });

  it("referrerRejectWishes — POST /api/referrer/families/:id/reject-wishes with reason", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5, wish_lock_level: "family" } });
    const result = await apiModule.referrerRejectWishes(5, "Needs more detail");
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/referrer/families/5/reject-wishes", {
      reason: "Needs more detail",
    });
    expect(result).toEqual({ id: 5, wish_lock_level: "family" });
  });
});

// ---------------------------------------------------------------------------
// Admin — Wish Review Queue
// ---------------------------------------------------------------------------
describe("admin wish review API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listAdminReviewQueue — GET /api/admin/families/review-queue", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, family_name: "Smiths", referrer_name: "Jane" }] });
    const result = await apiModule.listAdminReviewQueue();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/families/review-queue");
    expect(result).toEqual([{ id: 1, family_name: "Smiths", referrer_name: "Jane" }]);
  });

  it("adminApproveWishes — POST /api/admin/families/:id/approve-wishes", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5, wish_lock_level: "admin" } });
    const result = await apiModule.adminApproveWishes(5);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/families/5/approve-wishes");
    expect(result).toEqual({ id: 5, wish_lock_level: "admin" });
  });

  it("adminRejectWishes — POST /api/admin/families/:id/reject-wishes with reason", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5, wish_lock_level: "referrer" } });
    const result = await apiModule.adminRejectWishes(5, "Wishes too vague");
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/families/5/reject-wishes", {
      reason: "Wishes too vague",
    });
    expect(result).toEqual({ id: 5, wish_lock_level: "referrer" });
  });

  it("adminResetWishState — POST /api/admin/families/:id/reset-wish-state", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5, wish_lock_level: "family" } });
    const result = await apiModule.adminResetWishState(5);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/families/5/reset-wish-state");
    expect(result).toEqual({ id: 5, wish_lock_level: "family" });
  });
});

// ---------------------------------------------------------------------------
// Admin — Wishes
// ---------------------------------------------------------------------------
describe("admin wish API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adminListWishes — GET /api/admin/wishes", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { wishes: [], total: 0, page: 1, page_size: 20, total_pages: 0 } });
    await apiModule.adminListWishes();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/wishes");
  });

  it("adminListWishes with params — serializes columns as CSV", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { wishes: [], total: 0, page: 1, page_size: 20, total_pages: 0 } });
    await apiModule.adminListWishes({ page: 2, page_size: 20, columns: ["name", "status"] });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/wishes", {
      params: { page: 2, page_size: 20, columns: "name,status" },
    });
  });

  it("adminGetWish — GET /api/admin/wishes/:id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 7, description: "Jacket" } });
    const result = await apiModule.adminGetWish(7);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/wishes/7");
    expect(result).toEqual({ id: 7, description: "Jacket" });
  });

  it("adminUpdateWish — PATCH /api/admin/wishes/:id", async () => {
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 7 } });
    await apiModule.adminUpdateWish(7, { purchaser_note: "Got it" });
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/admin/wishes/7", { purchaser_note: "Got it" });
  });

  it("adminMarkPurchased — POST /api/admin/wishes/:id/mark-purchased", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 7, purchased_at: "2025-01-01" } });
    await apiModule.adminMarkPurchased(7, { purchased_where: "Target" });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/wishes/7/mark-purchased", {
      purchased_where: "Target",
    });
  });

  it("adminBatchAssignWishes — POST /api/admin/wishes/batch-assign", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { assigned_count: 3 } });
    const result = await apiModule.adminBatchAssignWishes({ wish_ids: [1, 2, 3], assigned_to_id: 5 });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/wishes/batch-assign", {
      wish_ids: [1, 2, 3],
      assigned_to_id: 5,
    });
    expect(result).toEqual({ assigned_count: 3 });
  });
});

// ---------------------------------------------------------------------------
// Admin — Restore (family/person)
// ---------------------------------------------------------------------------
describe("admin restore API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adminRestoreFamily — POST /api/admin/families/:id/restore", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5 } });
    const result = await apiModule.adminRestoreFamily(5);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/families/5/restore");
    expect(result).toEqual({ id: 5 });
  });

  it("adminRestorePerson — POST /api/admin/people/:id/restore", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 12 } });
    const result = await apiModule.adminRestorePerson(12);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/admin/people/12/restore");
    expect(result).toEqual({ id: 12 });
  });
});

// ---------------------------------------------------------------------------
// Admin — Packing Slips
// ---------------------------------------------------------------------------
describe("admin packing slips API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adminGetPackingSlips — GET /api/admin/families/packing-slips (no filter)", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });
    await apiModule.adminGetPackingSlips();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/families/packing-slips");
  });

  it("adminGetPackingSlips with familyIds — serializes as CSV", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });
    await apiModule.adminGetPackingSlips([1, 3, 5]);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/families/packing-slips", {
      params: { family_ids: "1,3,5" },
    });
  });

  it("adminGetPackingSlips with empty array — no filter", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });
    await apiModule.adminGetPackingSlips([]);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/families/packing-slips");
  });
});

// ---------------------------------------------------------------------------
// Auth — Referrer Invite
// ---------------------------------------------------------------------------
describe("auth invite API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createReferrerInvite — POST /api/auth/invite-referrer", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { code: "KMG-ABC", expires_at: "2025-12-31" } });
    const result = await apiModule.createReferrerInvite({ family_limit: 10, email: "new@example.com" });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/auth/invite-referrer", {
      family_limit: 10,
      email: "new@example.com",
    });
    expect(result).toEqual({ code: "KMG-ABC", expires_at: "2025-12-31" });
  });

  it("registerReferrerViaInvite — POST /api/auth/register-referrer", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { user: { id: 1 }, referrer: { id: 1 } } });
    const result = await apiModule.registerReferrerViaInvite({
      code: "KMG-ABC",
      name: "New Org",
      email: "new@example.com",
      phone_number: "555-1234",
      password: "secret123",
    });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/auth/register-referrer", {
      code: "KMG-ABC",
      name: "New Org",
      email: "new@example.com",
      phone_number: "555-1234",
      password: "secret123",
    });
    expect(result).toEqual({ user: { id: 1 }, referrer: { id: 1 } });
  });

  it("registerFamilyViaInvite — POST /api/auth/register-family", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { user: { id: 2 }, family: { id: 5 } } });
    const result = await apiModule.registerFamilyViaInvite({
      code: "KFI-XYZ",
      family_name: "The Smiths",
      family_wish: "A warm blanket",
      contact_name: "Mom",
      email: "family@example.com",
      password: "secret123",
    });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/auth/register-family", {
      code: "KFI-XYZ",
      family_name: "The Smiths",
      family_wish: "A warm blanket",
      contact_name: "Mom",
      email: "family@example.com",
      password: "secret123",
    });
    expect(result).toEqual({ user: { id: 2 }, family: { id: 5 } });
  });
});

// ---------------------------------------------------------------------------
// Referrer — Pending Families (invite approvals)
// ---------------------------------------------------------------------------
describe("referrer pending family API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listPendingFamilies — GET /api/referrer/pending-families", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, family_name: "Smiths" }] });
    const result = await apiModule.listPendingFamilies();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/referrer/pending-families");
    expect(result).toEqual([{ id: 1, family_name: "Smiths" }]);
  });

  it("approveFamily — POST /api/referrer/families/:id/approve", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5, approval_status: "approved" } });
    const result = await apiModule.approveFamily(5);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/referrer/families/5/approve");
    expect(result).toEqual({ id: 5, approval_status: "approved" });
  });

  it("rejectFamily — POST /api/referrer/families/:id/reject", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5, approval_status: "rejected" } });
    const result = await apiModule.rejectFamily(5);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/referrer/families/5/reject");
    expect(result).toEqual({ id: 5, approval_status: "rejected" });
  });

  it("sendReferrerFamilyInvite — POST /api/referrer/send-family-invite with email", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { invite_code: "KFI-NEW" } });
    const result = await apiModule.sendReferrerFamilyInvite("friend@example.com");
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/referrer/send-family-invite", {
      email: "friend@example.com",
    });
    expect(result).toEqual({ invite_code: "KFI-NEW" });
  });
});

// ---------------------------------------------------------------------------
// Public — Family Wish List
// ---------------------------------------------------------------------------
describe("public wish list API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getFamilyWishList — GET /api/families/:id/wish-list", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { family: { id: 5 }, wishes: [] } });
    const result = await apiModule.getFamilyWishList(5);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/families/5/wish-list");
    expect(result).toEqual({ family: { id: 5 }, wishes: [] });
  });
});

// ---------------------------------------------------------------------------
// Purchaser — Assigned Wishes
// ---------------------------------------------------------------------------
describe("purchaser API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("purchaserListWishes — GET /api/purchaser/wishes", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { wishes: [], total: 0, page: 1, page_size: 20, total_pages: 0 } });
    await apiModule.purchaserListWishes();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/purchaser/wishes");
  });

  it("purchaserListWishes with purchased filter", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { wishes: [], total: 0, page: 1, page_size: 20, total_pages: 0 } });
    await apiModule.purchaserListWishes({ purchased: "true", page: 2, page_size: 20 });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/purchaser/wishes", {
      params: { purchased: "true", page: 2, page_size: 20 },
    });
  });

  it("purchaserGetWish — GET /api/purchaser/wishes/:id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 7, description: "Jacket" } });
    const result = await apiModule.purchaserGetWish(7);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/purchaser/wishes/7");
    expect(result).toEqual({ id: 7, description: "Jacket" });
  });

  it("purchaserMarkPurchased — POST /api/purchaser/wishes/:id/mark-purchased", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 7, purchased_at: "2025-01-01" } });
    await apiModule.purchaserMarkPurchased(7, { purchased_where: "Amazon" });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/purchaser/wishes/7/mark-purchased", {
      purchased_where: "Amazon",
    });
  });

  it("purchaserUpdateWish — PATCH /api/purchaser/wishes/:id", async () => {
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 7 } });
    await apiModule.purchaserUpdateWish(7, { purchaser_note: "Left at door" });
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/purchaser/wishes/7", {
      purchaser_note: "Left at door",
    });
  });
});

// ---------------------------------------------------------------------------
// Delivery — Assigned Families
// ---------------------------------------------------------------------------
describe("delivery API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deliveryListFamilies — GET /api/delivery/families", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, family_name: "Smiths" }] });
    const result = await apiModule.deliveryListFamilies();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/delivery/families");
    expect(result).toEqual([{ id: 1, family_name: "Smiths" }]);
  });

  it("deliveryGetPackingSlips — GET /api/delivery/packing-slips", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });
    const result = await apiModule.deliveryGetPackingSlips();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/delivery/packing-slips");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Auth — setAuthQueryData / _registerSetAuthQueryData
// ---------------------------------------------------------------------------
describe("auth query data registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("setAuthQueryData is a no-op before registration", async () => {
    // _registerSetAuthQueryData was already called by the api module import,
    // but the internal ref starts as null until AuthProvider registers it.
    // Calling setAuthQueryData should not throw.
    expect(() => apiModule.setAuthQueryData(null)).not.toThrow();
  });

  it("_registerSetAuthQueryData stores the callback", () => {
    const fn = vi.fn();
    apiModule._registerSetAuthQueryData(fn);
    apiModule.setAuthQueryData(null);
    expect(fn).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// Donor — Self-Registration
// ---------------------------------------------------------------------------
describe("donor self-registration API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registerDonor — POST /api/auth/register-donor", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { user: { id: 1, role: "donor" } } });
    const result = await apiModule.registerDonor({
      display_name: "Jane Donor",
      email: "donor@example.com",
      password: "secret123",
    });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/auth/register-donor", {
      display_name: "Jane Donor",
      email: "donor@example.com",
      password: "secret123",
    });
    expect(result).toEqual({ user: { id: 1, role: "donor" } });
  });
});

// ---------------------------------------------------------------------------
// Donor — Profile
// ---------------------------------------------------------------------------
describe("donor profile API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("donorGetMe — GET /api/donor/me", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 1, role: "donor" } });
    const result = await apiModule.donorGetMe();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/donor/me");
    expect(result).toEqual({ id: 1, role: "donor" });
  });
});

// ---------------------------------------------------------------------------
// Donor — Claims
// ---------------------------------------------------------------------------
describe("donor claims API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("donorListClaims — GET /api/donor/claims", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, fulfilled_at: null }] });
    const result = await apiModule.donorListClaims();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/donor/claims");
    expect(result).toEqual([{ id: 1, fulfilled_at: null }]);
  });

  it("donorListClaims with fulfilled filter", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 1, fulfilled_at: null }] });
    await apiModule.donorListClaims({ fulfilled: false });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/donor/claims", { params: { fulfilled: false } });
  });

  it("donorGetClaim — GET /api/donor/claims/:id", async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 5, status: "active" } });
    await apiModule.donorGetClaim(5);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/donor/claims/5");
  });

  it("donorUpdateClaim — PATCH /api/donor/claims/:id", async () => {
    mockAxiosInstance.patch.mockResolvedValueOnce({ data: { id: 5, notes: "Updated" } });
    await apiModule.donorUpdateClaim(5, { notes: "Updated" });
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/api/donor/claims/5", { notes: "Updated" });
  });

  it("donorCancelClaim — DELETE /api/donor/claims/:id", async () => {
    mockAxiosInstance.delete.mockResolvedValueOnce({ data: null });
    await apiModule.donorCancelClaim(5);
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/api/donor/claims/5");
  });

  it("donorMarkWishPurchased — POST /api/donor/claims/:claimId/wishes/:wishId/mark-purchased", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 10, purchased_at: "2025-01-01" } });
    await apiModule.donorMarkWishPurchased(5, 10, { purchased_where: "Target" });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/donor/claims/5/wishes/10/mark-purchased", {
      purchased_where: "Target",
    });
  });

  it("donorFulfillClaim — POST /api/donor/claims/:id/fulfill", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 5, status: "fulfilled" } });
    await apiModule.donorFulfillClaim(5);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/donor/claims/5/fulfill");
  });
});

// ---------------------------------------------------------------------------
// Public — Claim Family
// ---------------------------------------------------------------------------
describe("claim family API functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claimFamily — POST /api/families/:id/claim with commitment_type", async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 1, status: "active", commitment_type: "gifts" } });
    const result = await apiModule.claimFamily(42, "gifts");
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/families/42/claim", { commitment_type: "gifts" });
    expect(result).toEqual({ id: 1, status: "active", commitment_type: "gifts" });
  });
});

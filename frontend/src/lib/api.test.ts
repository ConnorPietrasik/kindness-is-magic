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

  it("registerRequest — POST /api/auth/register with data, returns raw axios response", async () => {
    const body = { email: "x@y.com", password: "secret", full_name: "Test" };
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 2 } });
    const result = await apiModule.registerRequest(body);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/auth/register", body);
    // registerRequest does NOT strip .data — returns full axios response
    expect(result).toEqual({ data: { id: 2 } });
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
    const body = { given_name: "Jane", age: 10, practical_wish: "Wish", fun_wish: "Wish" };
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
    await apiModule.adminListFamilyPeople(5, { page: 2, page_size: 25, include_deleted: true });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/admin/people", {
      params: { page: 2, page_size: 25, include_deleted: true, family_id: 5 },
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
    const body = { given_name: "Bob", age: 10, practical_wish: "Wish", fun_wish: "Wish" };
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
    const body = { given_name: "Alice", age: 10, practical_wish: "Wish", fun_wish: "Wish" };
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

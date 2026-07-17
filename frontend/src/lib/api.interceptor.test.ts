import type { Mock } from "vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// We can't use static import + vi.mock here because the api module is
// already cached from api.test.js. Instead, we reset modules and
// dynamically import with our own mock.

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

describe("response interceptor — 401 token refresh", () => {
  let mockApi: MockAxiosInstance;
  let rejectedHandler: ((error: unknown) => Promise<unknown>) | undefined;

  beforeAll(async () => {
    vi.resetModules();

    mockApi = vi.fn().mockResolvedValue({ data: null }) as unknown as MockAxiosInstance;
    mockApi.get = vi.fn();
    mockApi.post = vi.fn();
    mockApi.put = vi.fn();
    mockApi.patch = vi.fn();
    mockApi.delete = vi.fn();
    mockApi.interceptors = {
      request: {
        use: vi.fn(),
      },
      response: {
        use: vi.fn((_fulfilled: unknown, rejected: (error: unknown) => Promise<unknown>) => {
          rejectedHandler = rejected;
        }),
      },
    };

    vi.doMock("axios", () => ({
      default: {
        create: () => mockApi,
      },
    }));

    void (await import("./api"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attempts refresh on 401 and retries on success", async () => {
    mockApi.post.mockResolvedValueOnce({ data: { user: { id: 1 } } });
    mockApi.mockResolvedValueOnce({ data: "recovered" });

    const error = {
      response: { status: 401, data: {} },
      config: { url: "/api/auth/me", method: "get", _retry: false },
    };

    const result = await rejectedHandler!(error);
    expect(mockApi.post).toHaveBeenCalledWith("/api/auth/refresh");
    expect(mockApi).toHaveBeenCalledWith(expect.objectContaining({ url: "/api/auth/me" }));
    expect(result).toEqual({ data: "recovered" });
  });

  it("rejects non-401 errors without refresh", async () => {
    const error = { response: { status: 500, data: {} }, config: {} };
    await expect(rejectedHandler!(error)).rejects.toBe(error);
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it("skips refresh when the original request IS the refresh endpoint", async () => {
    const error = {
      response: { status: 401, data: {} },
      config: { url: "/api/auth/refresh", method: "post", _retry: false },
    };
    await expect(rejectedHandler!(error)).rejects.toBe(error);
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it("rejects with original error when refresh fails", async () => {
    mockApi.post.mockRejectedValueOnce(new Error("refresh failed"));

    const error = {
      response: { status: 401, data: {} },
      config: { url: "/api/auth/me", method: "get", _retry: false },
    };

    await expect(rejectedHandler!(error)).rejects.toBe(error);
  });

  it("does not refresh if _retry is already true", async () => {
    const error = {
      response: { status: 401, data: {} },
      config: { url: "/api/auth/me", method: "get", _retry: true },
    };
    await expect(rejectedHandler!(error)).rejects.toBe(error);
    expect(mockApi.post).not.toHaveBeenCalled();
  });
});

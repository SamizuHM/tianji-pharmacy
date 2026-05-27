import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildUser } from "../../../helpers/factories";

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/services/users", () => ({
  listManagedUsers: vi.fn(),
  createManagedUser: vi.fn(),
  updateManagedUser: vi.fn(),
  deleteManagedUser: vi.fn(),
}));

import { GET, POST } from "@/app/api/admin/users/route";
import { PUT, DELETE } from "@/app/api/admin/users/[id]/route";
import { getCurrentUser } from "@/lib/auth/session";
import {
  listManagedUsers,
  createManagedUser,
  updateManagedUser,
  deleteManagedUser,
} from "@/lib/services/users";

const adminUser = buildUser({ id: "admin-1", role: "admin" });
const staffUser = buildUser({ id: "staff-1", role: "staff" });

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未登录返回 401", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("未登录");
  });

  it("非 admin 返回 403", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(staffUser);

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("admin 正常获取用户列表", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);
    (listManagedUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
      buildUser({ id: "u1" }),
      buildUser({ id: "u2" }),
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.users).toHaveLength(2);
  });
});

describe("POST /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未登录返回 401", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const request = new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: "u", displayName: "d", role: "staff" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("非 admin 返回 403", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(staffUser);

    const request = new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: "u", displayName: "d", role: "staff" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("参数不合法返回 400", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);

    const request = new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: "", displayName: "d", role: "staff" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("用户参数不合法");
  });

  it("role 不在枚举范围返回 400", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);

    const request = new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: "u", displayName: "d", role: "superadmin" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("成功创建用户", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);
    const newUser = buildUser({ id: "new-1", username: "newuser" });
    (createManagedUser as ReturnType<typeof vi.fn>).mockResolvedValue(newUser);

    const request = new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: "newuser",
        displayName: "新用户",
        password: "pass123",
        role: "staff",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.id).toBe("new-1");
  });

  it("服务层抛错返回 400", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);
    (createManagedUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("新建用户必须设置密码")
    );

    const request = new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: "u",
        displayName: "d",
        password: "",
        role: "staff",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("新建用户必须设置密码");
  });
});

describe("PUT /api/admin/users/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未登录返回 401", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const request = new Request("http://localhost/api/admin/users/u1", {
      method: "PUT",
      body: JSON.stringify({ username: "u", displayName: "d", role: "staff" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PUT(request, { params: Promise.resolve({ id: "u1" }) });
    expect(response.status).toBe(401);
  });

  it("非 admin 返回 403", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(staffUser);

    const request = new Request("http://localhost/api/admin/users/u1", {
      method: "PUT",
      body: JSON.stringify({ username: "u", displayName: "d", role: "staff" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PUT(request, { params: Promise.resolve({ id: "u1" }) });
    expect(response.status).toBe(403);
  });

  it("成功更新用户", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);
    const updated = buildUser({ id: "u1", displayName: "更新后" });
    (updateManagedUser as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const request = new Request("http://localhost/api/admin/users/u1", {
      method: "PUT",
      body: JSON.stringify({
        username: "user",
        displayName: "更新后",
        role: "staff",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PUT(request, { params: Promise.resolve({ id: "u1" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.displayName).toBe("更新后");
    expect(updateManagedUser).toHaveBeenCalledWith("u1", expect.any(Object));
  });

  it("参数不合法返回 400", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);

    const request = new Request("http://localhost/api/admin/users/u1", {
      method: "PUT",
      body: JSON.stringify({ username: "", displayName: "d", role: "staff" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PUT(request, { params: Promise.resolve({ id: "u1" }) });
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/admin/users/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未登录返回 401", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const request = new Request("http://localhost/api/admin/users/u1", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "u1" }) });
    expect(response.status).toBe(401);
  });

  it("非 admin 返回 403", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(staffUser);

    const request = new Request("http://localhost/api/admin/users/u1", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "u1" }) });
    expect(response.status).toBe(403);
  });

  it("不能删除自己", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);

    const request = new Request("http://localhost/api/admin/users/admin-1", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "admin-1" }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("不能删除当前登录账号");
  });

  it("成功删除其他用户", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);
    (deleteManagedUser as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const request = new Request("http://localhost/api/admin/users/u1", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "u1" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(deleteManagedUser).toHaveBeenCalledWith("u1");
  });

  it("服务层抛错返回 400", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser);
    (deleteManagedUser as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("删除用户失败"));

    const request = new Request("http://localhost/api/admin/users/u1", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "u1" }) });
    expect(response.status).toBe(400);
  });
});

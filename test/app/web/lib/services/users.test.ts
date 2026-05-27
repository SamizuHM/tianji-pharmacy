import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { buildUser, buildDepartment } from "../../../../helpers/factories";

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn((pw: string) => Promise.resolve(`hashed:${pw}`)),
    compare: vi.fn(),
  },
}));

import {
  listManagedUsers,
  createManagedUser,
  updateManagedUser,
  deleteManagedUser,
} from "@/lib/services/users";

describe("users service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listManagedUsers", () => {
    it("返回所有用户列表（含部门信息）", async () => {
      const users = [
        buildUser({ id: "u1", role: "staff" }),
        buildUser({ id: "u2", role: "department", departmentId: "dept-1" }),
        buildUser({ id: "u3", role: "admin" }),
      ];
      prisma.user.findMany.mockResolvedValue(users);

      const result = await listManagedUsers();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        include: { department: true },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      });
      expect(result).toHaveLength(3);
    });

    it("无用户时返回空数组", async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await listManagedUsers();
      expect(result).toEqual([]);
    });
  });

  describe("createManagedUser", () => {
    it("成功创建 staff 用户", async () => {
      const created = buildUser({ id: "new-1", username: "newstaff", role: "staff" });
      prisma.user.create.mockResolvedValue(created);

      const result = await createManagedUser({
        username: "newstaff",
        displayName: "新员工",
        password: "pass123",
        role: "staff",
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: "newstaff",
          displayName: "新员工",
          passwordHash: "hashed:pass123",
          role: "staff",
          departmentId: null,
          enabled: true,
        }),
        include: { department: true },
      });
    });

    it("成功创建 department 用户（带 departmentId）", async () => {
      const created = buildUser({
        id: "new-2",
        role: "department",
        departmentId: "dept-1",
      });
      prisma.user.create.mockResolvedValue(created);

      await createManagedUser({
        username: "deptuser",
        displayName: "部门人员",
        password: "pass123",
        role: "department",
        departmentId: "dept-1",
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: "department",
          departmentId: "dept-1",
        }),
        include: { department: true },
      });
    });

    it("department 用户缺少 departmentId 时抛错", async () => {
      await expect(
        createManagedUser({
          username: "deptuser",
          displayName: "部门人员",
          password: "pass123",
          role: "department",
        })
      ).rejects.toThrow("部门人员必须选择所属部门");
    });

    it("密码为空时抛错", async () => {
      await expect(
        createManagedUser({
          username: "user",
          displayName: "用户",
          password: "",
          role: "staff",
        })
      ).rejects.toThrow("新建用户必须设置密码");
    });

    it("密码为 undefined 时抛错", async () => {
      await expect(
        createManagedUser({
          username: "user",
          displayName: "用户",
          role: "staff",
        })
      ).rejects.toThrow("新建用户必须设置密码");
    });

    it("密码仅空格时抛错", async () => {
      await expect(
        createManagedUser({
          username: "user",
          displayName: "用户",
          password: "   ",
          role: "staff",
        })
      ).rejects.toThrow("新建用户必须设置密码");
    });

    it("admin 用户 departmentId 会被忽略（设为 null）", async () => {
      const created = buildUser({ id: "new-3", role: "admin" });
      prisma.user.create.mockResolvedValue(created);

      await createManagedUser({
        username: "admin",
        displayName: "管理员",
        password: "pass123",
        role: "admin",
        departmentId: "dept-1",
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: "admin",
          departmentId: null,
        }),
        include: { department: true },
      });
    });

    it("默认 enabled 为 true", async () => {
      prisma.user.create.mockResolvedValue(buildUser());

      await createManagedUser({
        username: "user",
        displayName: "用户",
        password: "pass123",
        role: "staff",
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ enabled: true }),
        include: { department: true },
      });
    });

    it("可显式设置 enabled 为 false", async () => {
      prisma.user.create.mockResolvedValue(buildUser({ enabled: false }));

      await createManagedUser({
        username: "user",
        displayName: "用户",
        password: "pass123",
        role: "staff",
        enabled: false,
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ enabled: false }),
        include: { department: true },
      });
    });

    it("username 和 displayName 会 trim", async () => {
      prisma.user.create.mockResolvedValue(buildUser());

      await createManagedUser({
        username: "  spaced  ",
        displayName: "  名字  ",
        password: "pass123",
        role: "staff",
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: "spaced",
          displayName: "名字",
        }),
        include: { department: true },
      });
    });
  });

  describe("updateManagedUser", () => {
    it("成功更新用户信息（不改密码）", async () => {
      const updated = buildUser({ id: "u1", displayName: "新名字" });
      prisma.user.update.mockResolvedValue(updated);

      await updateManagedUser("u1", {
        username: "test-user",
        displayName: "新名字",
        role: "staff",
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: expect.not.objectContaining({ passwordHash: expect.anything() }),
        include: { department: true },
      });
    });

    it("提供新密码时更新密码", async () => {
      prisma.user.update.mockResolvedValue(buildUser());

      await updateManagedUser("u1", {
        username: "test-user",
        displayName: "用户",
        password: "newpass",
        role: "staff",
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: expect.objectContaining({ passwordHash: "hashed:newpass" }),
        include: { department: true },
      });
    });

    it("密码为空字符串时不更新密码", async () => {
      prisma.user.update.mockResolvedValue(buildUser());

      await updateManagedUser("u1", {
        username: "test-user",
        displayName: "用户",
        password: "",
        role: "staff",
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: expect.not.objectContaining({ passwordHash: expect.anything() }),
        include: { department: true },
      });
    });

    it("department 用户缺少 departmentId 时抛错", async () => {
      await expect(
        updateManagedUser("u1", {
          username: "user",
          displayName: "用户",
          role: "department",
        })
      ).rejects.toThrow("部门人员必须选择所属部门");
    });

    it("切换角色从 department 到 staff", async () => {
      prisma.user.update.mockResolvedValue(buildUser({ role: "staff" }));

      await updateManagedUser("u1", {
        username: "user",
        displayName: "用户",
        role: "staff",
        departmentId: "dept-1",
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: expect.objectContaining({ role: "staff", departmentId: null }),
        include: { department: true },
      });
    });
  });

  describe("deleteManagedUser", () => {
    it("成功删除用户", async () => {
      prisma.user.delete.mockResolvedValue(buildUser({ id: "u1" }));

      await deleteManagedUser("u1");

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
    });

    it("删除不存在的用户时 Prisma 抛错", async () => {
      prisma.user.delete.mockRejectedValue(new Error("Record to delete does not exist"));

      await expect(deleteManagedUser("nonexistent")).rejects.toThrow();
    });
  });
});

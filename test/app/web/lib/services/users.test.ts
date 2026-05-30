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

const userInclude = { department: true, store: true };

describe("users service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listManagedUsers", () => {
    it("返回所有用户列表（含部门和门店城市信息）", async () => {
      const users = [
        buildUser({ id: "u1", role: "staff" }),
        buildUser({ id: "u2", role: "department", departmentId: "dept-1" }),
        buildUser({ id: "u3", role: "admin" }),
      ];
      prisma.user.findMany.mockResolvedValue(users);

      const result = await listManagedUsers();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        include: userInclude,
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
          storeId: null,
          enabled: true,
        }),
        include: userInclude,
      });
    });

    it("创建 staff 用户时可绑定湖北城市对应的默认门店", async () => {
      prisma.store.findFirst.mockResolvedValue({
        id: "store-wuhan",
        name: "武汉默认门店",
        cityName: "武汉",
      });
      prisma.user.create.mockResolvedValue(buildUser({ role: "staff", storeId: "store-wuhan" }));

      await createManagedUser({
        username: "staff-wuhan",
        displayName: "武汉员工",
        password: "pass123",
        role: "staff",
        cityName: "武汉",
      });

      expect(prisma.store.findFirst).toHaveBeenCalledWith({
        where: { name: "武汉默认门店", cityName: "武汉" },
      });
      expect(prisma.store.create).not.toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: "staff", storeId: "store-wuhan" }),
        include: userInclude,
      });
    });

    it("绑定城市时没有默认门店则自动创建", async () => {
      prisma.store.findFirst.mockResolvedValue(null);
      prisma.store.create.mockResolvedValue({
        id: "store-yichang",
        name: "宜昌默认门店",
        cityName: "宜昌",
      });
      prisma.user.create.mockResolvedValue(buildUser({ role: "staff", storeId: "store-yichang" }));

      await createManagedUser({
        username: "staff-yichang",
        displayName: "宜昌员工",
        password: "pass123",
        role: "staff",
        cityName: "宜昌",
      });

      expect(prisma.store.create).toHaveBeenCalledWith({
        data: { name: "宜昌默认门店", cityName: "宜昌", provinceName: "湖北" },
      });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ storeId: "store-yichang" }),
        include: userInclude,
      });
    });

    it("创建 staff 用户时拒绝绑定非湖北城市", async () => {
      await expect(
        createManagedUser({
          username: "staff-outside",
          displayName: "外地员工",
          password: "pass123",
          role: "staff",
          cityName: "杭州",
        })
      ).rejects.toThrow("药店工作人员所属城市必须为湖北省内城市");
      expect(prisma.user.create).not.toHaveBeenCalled();
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
          storeId: null,
        }),
        include: userInclude,
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
          storeId: null,
        }),
        include: userInclude,
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
        include: userInclude,
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
        include: userInclude,
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
        include: userInclude,
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
        include: userInclude,
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
        include: userInclude,
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
        include: userInclude,
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
        data: expect.objectContaining({ role: "staff", departmentId: null, storeId: null }),
        include: userInclude,
      });
    });

    it("更新 staff 用户时可修改所属城市", async () => {
      prisma.store.findFirst.mockResolvedValue({
        id: "store-xiangyang",
        name: "襄阳默认门店",
        cityName: "襄阳",
      });
      prisma.user.update.mockResolvedValue(
        buildUser({ role: "staff", storeId: "store-xiangyang" })
      );

      await updateManagedUser("u1", {
        username: "user",
        displayName: "用户",
        role: "staff",
        cityName: "襄阳",
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: expect.objectContaining({ role: "staff", storeId: "store-xiangyang" }),
        include: userInclude,
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

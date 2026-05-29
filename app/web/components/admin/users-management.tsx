"use client";

import { useMemo, useState, useTransition } from "react";
import type { Department, Region, User, UserRole } from "@prisma/client";
import { Plus, Save, Trash2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { roleLabel } from "@/lib/presentation";

type DepartmentWithRegion = Department & { region: Region | null };
type UserWithDepartment = User & { department: DepartmentWithRegion | null; region: Region };

type UserForm = {
  id?: string;
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
  departmentId: string;
  regionId: string;
  enabled: boolean;
};

const emptyForm: UserForm = {
  username: "",
  displayName: "",
  password: "",
  role: "department",
  departmentId: "",
  regionId: "",
  enabled: true,
};

export function UsersManagement(props: {
  initialUsers: UserWithDepartment[];
  departments: DepartmentWithRegion[];
  regions: Region[];
}) {
  const [users, setUsers] = useState(props.initialUsers);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const isEditing = Boolean(form.id);
  const departmentOptions = useMemo(() => props.departments, [props.departments]);

  function editUser(user: UserWithDepartment) {
    setError("");
    setForm({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      password: "",
      role: user.role,
      departmentId: user.departmentId ?? "",
      regionId: user.regionId ?? "",
      enabled: user.enabled,
    });
  }

  function submit() {
    setError("");
    startTransition(async () => {
      const response = await fetch(form.id ? `/api/admin/users/${form.id}` : "/api/admin/users", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          displayName: form.displayName,
          password: form.password || undefined,
          role: form.role,
          departmentId: form.role === "department" ? form.departmentId : null,
          regionId: form.regionId,
          enabled: form.enabled,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "保存失败");
        return;
      }
      setUsers((current) =>
        form.id
          ? current.map((user) => (user.id === data.user.id ? data.user : user))
          : [data.user, ...current]
      );
      setForm(emptyForm);
    });
  }

  function removeUser(user: UserWithDepartment) {
    const confirmed = window.confirm(`确认删除人员“${user.displayName}（${user.username}）”？`);
    if (!confirmed) {
      return;
    }

    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "删除失败");
        return;
      }
      setUsers((current) => current.filter((item) => item.id !== user.id));
      if (form.id === user.id) {
        setForm(emptyForm);
      }
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "编辑人员" : "新增人员"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            placeholder="账号"
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
          />
          <Input
            placeholder="姓名"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
          />
          <Input
            placeholder={isEditing ? "新密码（留空不修改）" : "密码"}
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
          <select
            className="border-input h-10 rounded border bg-white px-3 text-sm dark:bg-card"
            value={form.role}
            onChange={(event) =>
              setForm({
                ...form,
                role: event.target.value as UserRole,
                departmentId: event.target.value === "department" ? form.departmentId : "",
              })
            }
          >
            <option value="staff">药店工作人员</option>
            <option value="department">部门人员</option>
            <option value="admin">管理员</option>
          </select>
          {form.role === "department" ? (
            <select
              className="border-input h-10 rounded border bg-white px-3 text-sm dark:bg-card"
              value={form.departmentId}
              onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
            >
              <option value="">请选择部门</option>
              {departmentOptions.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.region?.name ? `${dept.region.name} - ${dept.name}` : dept.name}
                </option>
              ))}
            </select>
          ) : null}
          <select
            className="border-input h-10 rounded border bg-white px-3 text-sm dark:bg-card"
            value={form.regionId}
            onChange={(event) => setForm({ ...form, regionId: event.target.value })}
          >
            <option value="">请选择区域</option>
            {props.regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            启用账号
          </label>
          {error ? (
            <Alert className="border-destructive bg-red-50 text-destructive">{error}</Alert>
          ) : null}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={
                pending ||
                !form.username.trim() ||
                !form.displayName.trim() ||
                (!isEditing && !form.password.trim()) ||
                (form.role === "department" && !form.departmentId) ||
                !form.regionId
              }
              onClick={submit}
            >
              {isEditing ? <Save className="size-4" /> : <Plus className="size-4" />}
              {isEditing ? "保存" : "新增"}
            </Button>
            {isEditing ? (
              <Button variant="outline" onClick={() => setForm(emptyForm)} disabled={pending}>
                取消
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <THead>
              <tr>
                <TH>账号</TH>
                <TH>姓名</TH>
                <TH>角色</TH>
                <TH>部门</TH>
                <TH>区域</TH>
                <TH>状态</TH>
                <TH className="text-right">操作</TH>
              </tr>
            </THead>
            <TBody>
              {users.map((user) => (
                <tr key={user.id}>
                  <TD className="font-medium">{user.username}</TD>
                  <TD>{user.displayName}</TD>
                  <TD>{roleLabel(user.role)}</TD>
                  <TD>
                    {user.department
                      ? user.department.region
                        ? `${user.department.region.name} - ${user.department.name}`
                        : user.department.name
                      : "-"}
                  </TD>
                  <TD>{user.region?.name ?? "-"}</TD>
                  <TD>
                    <Badge
                      className={
                        user.enabled
                          ? "border-emerald-100 bg-emerald-50 text-emerald-600"
                          : "border-slate-100 bg-slate-100 text-slate-500"
                      }
                    >
                      {user.enabled ? "启用" : "禁用"}
                    </Badge>
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => editUser(user)}>
                        编辑
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeUser(user)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

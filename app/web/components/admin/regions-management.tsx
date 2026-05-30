"use client";

import { useMemo, useState, useTransition } from "react";

import type { Region } from "@prisma/client";
import { Plus, Save, Trash2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";

type RegionForm = {
  id?: string;
  name: string;
  code: string;
  description: string;
};

const emptyForm: RegionForm = {
  name: "",
  code: "",
  description: "",
};

export function RegionsManagement(props: { initialRegions: Region[] }) {
  const [regions, setRegions] = useState(props.initialRegions);
  const [form, setForm] = useState<RegionForm>(emptyForm);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const isEditing = Boolean(form.id);

  function editRegion(region: Region) {
    setError("");
    setForm({
      id: region.id,
      name: region.name,
      code: region.code ?? "",
      description: region.description ?? "",
    });
  }

  function submit() {
    setError("");
    startTransition(async () => {
      const response = await fetch(
        form.id ? `/api/admin/regions/${form.id}` : "/api/admin/regions",
        {
          method: form.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            code: form.code || undefined,
            description: form.description || undefined,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "保存失败");
        return;
      }
      setRegions((current) =>
        form.id
          ? current.map((r) => (r.id === data.region.id ? data.region : r))
          : [...current, data.region]
      );
      setForm(emptyForm);
    });
  }

  function removeRegion(region: Region) {
    const confirmed = window.confirm(`确认删除区域"${region.name}"？`);
    if (!confirmed) return;

    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/admin/regions/${region.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "删除失败");
        return;
      }
      setRegions((current) => current.filter((r) => r.id !== region.id));
      if (form.id === region.id) setForm(emptyForm);
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "编辑区域" : "新增区域"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            placeholder="区域名称（如：武汉）"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            placeholder="区域编码（如：wuhan，可选）"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <Input
            placeholder="描述（可选）"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          {error ? (
            <Alert className="border-destructive bg-red-50 text-destructive">{error}</Alert>
          ) : null}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={pending || !form.name.trim()} onClick={submit}>
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
          <Table className="min-w-[500px]">
            <THead>
              <tr>
                <TH>名称</TH>
                <TH>编码</TH>
                <TH>描述</TH>
                <TH className="text-right">操作</TH>
              </tr>
            </THead>
            <TBody>
              {regions.map((region) => (
                <tr key={region.id}>
                  <TD className="font-medium">{region.name}</TD>
                  <TD className="text-muted">{region.code ?? "-"}</TD>
                  <TD className="text-muted">{region.description ?? "-"}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => editRegion(region)}>
                        编辑
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeRegion(region)}>
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

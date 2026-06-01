"use client";

import { Building2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Department = {
  id: string;
  name: string;
  region?: { name: string } | null;
  users: Array<{ id: string; displayName: string }>;
};

export function OrgTreeSelect(props: {
  departments: Department[];
  onSelect: (target: { targetDept: string; targetDepartmentId: string }) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<{
    targetDept: string;
    targetDepartmentId: string;
    label: string;
  } | null>(null);

  function departmentLabel(dept: Department) {
    return dept.region?.name ? `${dept.region.name}${dept.name}` : dept.name;
  }

  function selectDept(dept: Department) {
    setSelected({
      targetDept: dept.name,
      targetDepartmentId: dept.id,
      label: departmentLabel(dept),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-slate-900 dark:text-foreground">选择转派部门</div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        {props.departments
          .filter((dept) => dept.users.length > 0)
          .map((dept) => {
            const label = departmentLabel(dept);
            const isDeptSelected = selected?.targetDepartmentId === dept.id;

            return (
              <div key={dept.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded px-2 py-2 text-left text-sm transition-colors",
                    isDeptSelected
                      ? "bg-blue-50 font-medium text-primary dark:bg-primary/10"
                      : "hover:bg-slate-50 dark:hover:bg-secondary"
                  )}
                  onClick={() => selectDept(dept)}
                >
                  <Building2 className="size-4 text-slate-400 dark:text-muted" />
                  {label}
                  <span className="ml-auto text-xs text-muted">{dept.users.length} 人</span>
                </button>
              </div>
            );
          })}
      </div>
      {selected ? (
        <div className="rounded bg-blue-50 px-3 py-2 text-xs text-primary dark:border dark:border-border dark:bg-secondary">
          已选择：{selected.label}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!selected}
          onClick={() =>
            selected &&
            props.onSelect({
              targetDept: selected.targetDept,
              targetDepartmentId: selected.targetDepartmentId,
            })
          }
        >
          确认转派
        </Button>
        <Button size="sm" variant="outline" onClick={props.onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

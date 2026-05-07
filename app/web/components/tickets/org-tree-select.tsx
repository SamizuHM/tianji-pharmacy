"use client";

import { ChevronDown, ChevronRight, Building2, User } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Department = {
  id: string;
  name: string;
  users: Array<{ id: string; displayName: string }>;
};

export function OrgTreeSelect(props: {
  departments: Department[];
  onSelect: (target: { targetDept: string; targetUserId?: string }) => void;
  onCancel: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ targetDept: string; targetUserId?: string } | null>(null);

  function toggle(name: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function selectDept(name: string) {
    setSelected({ targetDept: name });
  }

  function selectUser(deptName: string, userId: string) {
    setSelected({ targetDept: deptName, targetUserId: userId });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-slate-900 dark:text-foreground">选择升级目标</div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        {props.departments.map((dept) => {
          const isExpanded = expanded.has(dept.name);
          const isDeptSelected = selected?.targetDept === dept.name && !selected.targetUserId;

          return (
            <div key={dept.id} className="border-b border-border last:border-b-0">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex shrink-0 items-center justify-center p-1.5 text-slate-400 transition-colors hover:text-slate-600 dark:text-muted dark:hover:text-foreground"
                  onClick={() => toggle(dept.name)}
                >
                  {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded px-2 py-2 text-left text-sm transition-colors",
                    isDeptSelected ? "bg-blue-50 text-primary font-medium dark:bg-primary/10" : "hover:bg-slate-50 dark:hover:bg-secondary"
                  )}
                  onClick={() => selectDept(dept.name)}
                >
                  <Building2 className="size-4 text-slate-400 dark:text-muted" />
                  {dept.name}
                  <span className="ml-auto text-xs text-muted">{dept.users.length} 人</span>
                </button>
              </div>
              {isExpanded ? (
                <div className="ml-8 pb-1">
                  {dept.users.map((u) => {
                    const isUserSelected = selected?.targetDept === dept.name && selected.targetUserId === u.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm transition-colors",
                          isUserSelected ? "bg-blue-50 text-primary font-medium dark:bg-primary/10" : "text-slate-600 hover:bg-slate-50 dark:text-muted dark:hover:bg-secondary"
                        )}
                        onClick={() => selectUser(dept.name, u.id)}
                      >
                        <User className="size-3.5 text-slate-400 dark:text-muted" />
                        {u.displayName}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {selected ? (
        <div className="rounded bg-blue-50 px-3 py-2 text-xs text-primary dark:border dark:border-border dark:bg-secondary">
          已选择：{selected.targetDept}
          {selected.targetUserId ? " > 指定人员" : "（整个部门）"}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!selected}
          onClick={() => selected && props.onSelect(selected)}
        >
          确认升级
        </Button>
        <Button size="sm" variant="outline" onClick={props.onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

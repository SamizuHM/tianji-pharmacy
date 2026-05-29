"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RuntimeSettingsInput } from "@/lib/services/settings";

export function SettingsForm({ initialSettings }: { initialSettings: RuntimeSettingsInput }) {
  const [settings, setSettings] = useState({
    ...initialSettings,
    cityScopeWeight: initialSettings.cityScopeWeight ?? 1.3,
  });
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function update<K extends keyof RuntimeSettingsInput>(key: K, value: string) {
    setSettings((current) => ({
      ...current,
      [key]: Number(value),
    }));
  }

  function submit() {
    setMessage("");
    startTransition(async () => {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || "保存失败");
        return;
      }
      setSettings(data.settings);
      setMessage("设置已保存，后续检索请求将使用最新配置。");
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardTitle>检索与问答参数</CardTitle>
          <CardDescription>这些参数全局共享，修改后对所有用户立即生效。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <Field
            label="召回数量"
            description="从向量库召回的候选知识数量。"
            value={settings.retrievalTopK}
            onChange={(value) => update("retrievalTopK", value)}
          />
          <Field
            label="重排数量"
            description="进入多模态重排的候选数量，不能大于召回数量。"
            value={settings.rerankTopN}
            onChange={(value) => update("rerankTopN", value)}
          />
          <Field
            label="命中阈值"
            description="重排分数达到该阈值才视为知识库命中。"
            value={settings.kbHitThreshold}
            step="0.01"
            onChange={(value) => update("kbHitThreshold", value)}
          />
          <Field
            label="上下文轮数"
            description="改写问题时保留的最近对话轮数。"
            value={settings.maxContextTurns}
            onChange={(value) => update("maxContextTurns", value)}
          />
          <Field
            label="城市政策权重"
            description="同类证据同时命中时，城市专属政策的排序加权。"
            value={settings.cityScopeWeight ?? 1.3}
            step="0.1"
            onChange={(value) => update("cityScopeWeight", value)}
          />
          <div className="md:col-span-2">
            <Button onClick={submit} disabled={pending}>
              <Save data-icon="inline-start" />
              {pending ? "保存中..." : "保存设置"}
            </Button>
            {message ? (
              <Alert className="mt-4 border-primary/30 bg-primary/10 text-foreground">
                {message}
              </Alert>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>运行说明</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm leading-6 text-muted">
          <p>
            命中阈值越高，系统越谨慎，更多问题会进入大模型兜底；阈值越低，知识库命中率更高，但需要关注答案准确性。
          </p>
          <p>
            召回数量和重排数量会影响响应速度。门店高频问答场景建议先保持默认值，再结合统计页命中率逐步调优。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field(props: {
  label: string;
  description: string;
  value: number;
  step?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{props.label}</Label>
      <Input
        type="number"
        value={props.value}
        step={props.step}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <p className="text-xs text-muted">{props.description}</p>
    </div>
  );
}

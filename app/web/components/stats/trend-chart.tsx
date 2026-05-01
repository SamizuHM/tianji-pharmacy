"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function TrendChart(props: {
  data: Array<{
    day: string;
    questionCount: number;
    kbHitCount: number;
    llmAnswerCount: number;
    ticketCreatedCount: number;
    ticketClosedCount: number;
  }>;
}) {
  return (
    <div className="h-[300px] min-w-0 w-full overflow-hidden">
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={300}>
        <LineChart data={props.data}>
          <XAxis dataKey="day" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="questionCount" name="总提问数" stroke="#2563eb" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="kbHitCount" name="知识库命中数" stroke="#14b8a6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="llmAnswerCount" name="大模型回答数" stroke="#8b5cf6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="ticketCreatedCount" name="转人工次数" stroke="#f97316" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

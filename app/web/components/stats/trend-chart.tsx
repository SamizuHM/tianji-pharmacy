"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function TrendChart(props: {
  data: Array<{
    day: string;
    questionCount: number;
    kbHitCount: number;
    ticketCreatedCount: number;
    ticketClosedCount: number;
  }>;
}) {
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={props.data}>
          <XAxis dataKey="day" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="questionCount" stroke="#1f6f54" strokeWidth={2} />
          <Line type="monotone" dataKey="kbHitCount" stroke="#d9a441" strokeWidth={2} />
          <Line type="monotone" dataKey="ticketCreatedCount" stroke="#45607f" strokeWidth={2} />
          <Line type="monotone" dataKey="ticketClosedCount" stroke="#8e5d5d" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}


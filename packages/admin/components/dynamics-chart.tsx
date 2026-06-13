"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";

export interface SeriesPoint {
  date: string;
  value: number;
  alert?: boolean;
}

export function DynamicsChart({
  data,
  color = "#013CA4",
  domain,
}: {
  data: SeriesPoint[];
  color?: string;
  domain?: [number, number];
}) {
  if (!data.length) {
    return <p className="text-sm text-slate-500">Недостаточно данных для графика.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F4" />
        <XAxis dataKey="date" fontSize={12} stroke="#AAAAAA" />
        <YAxis domain={domain ?? ["auto", "auto"]} fontSize={12} stroke="#AAAAAA" />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3 }} />
        {data.map((p, i) =>
          p.alert ? (
            <ReferenceDot key={i} x={p.date} y={p.value} r={5} fill="#C51929" stroke="none" />
          ) : null
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

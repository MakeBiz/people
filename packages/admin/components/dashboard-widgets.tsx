"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";

type Trend = "up" | "down" | "flat" | null;

export interface MetricCardProps {
  label: string;
  value: string;
  suffix?: string;
  note: string;
  series: number[];
  trend: Trend;
  delta: number | null;
  higherIsBetter: boolean;
}

// Спарклайн столбиками: c3, последний столбик — accent.
function Spark({ series, color }: { series: number[]; color: string }) {
  if (series.length < 2) return <div className="h-[30px]" />;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  return (
    <div className="mt-3.5 flex h-[30px] items-end gap-[3px]">
      {series.map((v, i) => {
        const h = 20 + ((v - min) / span) * 80; // 20–100%
        const last = i === series.length - 1;
        return (
          <span
            key={i}
            className="block flex-1 rounded-t-[3px]"
            style={{ height: `${h}%`, background: last ? color : "#9CB5DB" }}
          />
        );
      })}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  suffix,
  note,
  series,
  trend,
  delta,
  higherIsBetter,
}: MetricCardProps) {
  const [open, setOpen] = useState(false);
  const good = trend === "flat" || trend == null ? null : (trend === "up") === higherIsBetter;
  const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "▬";
  const accent = "#013CA4";
  const data = series.map((v, i) => ({ i: i + 1, v }));

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-lg"
      onClick={() => series.length >= 2 && setOpen((o) => !o)}
    >
      <CardContent className="p-5">
        <div className="text-[13px] text-muted-foreground">{label}</div>
        <div className="mt-2 text-[32px] font-bold leading-none tracking-tight">
          {value}
          {suffix && (
            <span className="ml-1 text-[15px] font-normal text-muted-foreground">{suffix}</span>
          )}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-[13px]">
          {trend && delta != null ? (
            <span
              className={`inline-flex items-center gap-1 font-bold ${
                good === null ? "text-muted-foreground" : good ? "text-mk-green" : "text-mk-red"
              }`}
            >
              {arrow} {Math.abs(delta)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          <span className="text-muted-foreground">{note}</span>
        </div>

        {open ? (
          <div className="mt-3 h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                <XAxis dataKey="i" hide />
                <YAxis domain={["auto", "auto"]} fontSize={11} stroke="#AAAAAA" />
                <Tooltip />
                <Line type="monotone" dataKey="v" stroke={accent} strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Spark series={series} color={accent} />
        )}
      </CardContent>
    </Card>
  );
}

export interface DonutSlice {
  label: string;
  color: string;
  count: number;
  pct: number;
}

export function MotivationDonut({ slices }: { slices: DonutSlice[] }) {
  if (!slices.length) {
    return <p className="text-[14px] text-muted-foreground">Тест Герчикова ещё никто не прошёл.</p>;
  }
  const total = slices.reduce((s, x) => s + x.count, 0);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-[150px] w-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="count"
              nameKey="label"
              innerRadius={48}
              outerRadius={72}
              paddingAngle={2}
              stroke="none"
            >
              {slices.map((s, i) => (
                <Cell key={i} fill={s.color} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-bold leading-none">{total}</span>
          <span className="text-[11px] text-muted-foreground">чел.</span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 text-[13px]">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="h-[11px] w-[11px] rounded-[3px]" style={{ background: s.color }} />
            {s.label} · {s.pct}%
          </div>
        ))}
      </div>
    </div>
  );
}

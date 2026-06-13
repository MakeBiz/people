import "server-only";
import { prisma } from "@/lib/db";
import type { TestContent } from "@/lib/db";
import { PRIVACY_MIN_RESPONSES } from "@/lib/dashboard-config";

// Агрегаты анонимных пульс-опросов. Работаем ТОЛЬКО с анонимными результатами
// (personId = null): никакой привязки к человеку, всё считается по отделу/компании
// и скрывается ниже приватного минимума ответов.

export type Trend = "up" | "down" | "flat" | null;

const round2 = (n: number) => Math.round(n * 100) / 100;
const meanOf = (xs: number[]): number | null =>
  xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;

function trendOf(cur: number | null, prev: number | null): Trend {
  if (cur == null || prev == null) return null;
  return cur > prev ? "up" : cur < prev ? "down" : "flat";
}

// eNPS = %промоутеров (9-10) − %критиков (0-6).
function enpsFromValues(values: number[]): number | null {
  if (!values.length) return null;
  let prom = 0;
  let det = 0;
  for (const v of values) {
    if (v >= 9) prom++;
    else if (v <= 6) det++;
  }
  return Math.round(((prom - det) / values.length) * 100);
}

interface AnonResult {
  departmentId: string | null;
  scores: Record<string, number>;
  createdAt: Date;
}

export interface PulseScale {
  key: string;
  label: string;
  mean: number | null;
  delta: number | null; // динамика свежей половины против предыдущей
  trend: Trend;
}

export interface PulseDeptRow {
  id: string;
  name: string;
  count: number;
  hidden: boolean; // ответы есть, но < приватного минимума → скрыто
  scales: { key: string; mean: number | null }[];
  enps: number | null;
}

export interface PulseTest {
  code: string;
  title: string;
  category: string;
  method: string;
  isEnps: boolean;
  total: number;
  enough: boolean; // total >= приватного минимума
  lastResponseAt: Date | null;
  scales: PulseScale[]; // для не-eNPS
  enps: { value: number | null; delta: number | null; trend: Trend } | null;
  departments: PulseDeptRow[];
}

// Делим отсортированные по времени ответы пополам: старая половина → новая половина.
function halves<T>(rows: T[]): { prev: T[]; cur: T[] } | null {
  if (rows.length < 2 * PRIVACY_MIN_RESPONSES) return null; // мало данных для честной динамики
  const h = Math.floor(rows.length / 2);
  return { prev: rows.slice(0, h), cur: rows.slice(h) };
}

function meanKey(rows: AnonResult[], key: string): number | null {
  const xs = rows
    .map((r) => r.scores[key])
    .filter((v): v is number => typeof v === "number");
  const m = meanOf(xs);
  return m == null ? null : round2(m);
}

function enpsKey(rows: AnonResult[]): number | null {
  const xs = rows
    .map((r) => r.scores.enps)
    .filter((v): v is number => typeof v === "number");
  return enpsFromValues(xs);
}

export async function getPulseAggregates(): Promise<PulseTest[]> {
  const [tests, departments, results] = await Promise.all([
    prisma.test.findMany({ select: { id: true, code: true, title: true, category: true, content: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.result.findMany({
      where: { personId: null },
      orderBy: { createdAt: "asc" },
      select: { testId: true, departmentId: true, scores: true, createdAt: true },
    }),
  ]);

  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const byTest = new Map<string, AnonResult[]>();
  for (const r of results) {
    const arr = byTest.get(r.testId) ?? [];
    arr.push({
      departmentId: r.departmentId,
      scores: r.scores as Record<string, number>,
      createdAt: r.createdAt,
    });
    byTest.set(r.testId, arr);
  }

  const out: PulseTest[] = [];
  for (const t of tests) {
    const rows = byTest.get(t.id);
    if (!rows || rows.length === 0) continue; // показываем только тесты с анонимными ответами

    const content = t.content as unknown as TestContent;
    const method = content.scoring?.method ?? "";
    const isEnps = method === "enps";
    const total = rows.length;
    const enough = total >= PRIVACY_MIN_RESPONSES;
    const lastResponseAt = rows[rows.length - 1]?.createdAt ?? null;
    const split = halves(rows);

    // Ключи шкал: приоритет scales_meta, иначе — все числовые ключи из ответов.
    const scalesMeta = (content.scales_meta ?? {}) as Record<string, string>;
    let keys = Object.keys(scalesMeta);
    if (keys.length === 0) {
      const set = new Set<string>();
      for (const r of rows) {
        for (const [k, v] of Object.entries(r.scores)) if (typeof v === "number") set.add(k);
      }
      keys = [...set];
    }

    let scales: PulseScale[] = [];
    let enps: PulseTest["enps"] = null;

    if (isEnps) {
      const value = enough ? enpsKey(rows) : null;
      const prevV = split ? enpsKey(split.prev) : null;
      const curV = split ? enpsKey(split.cur) : null;
      enps = {
        value,
        delta: curV != null && prevV != null ? curV - prevV : null,
        trend: trendOf(curV, prevV),
      };
    } else {
      scales = keys.map((key) => {
        const mean = enough ? meanKey(rows, key) : null;
        const prevM = split ? meanKey(split.prev, key) : null;
        const curM = split ? meanKey(split.cur, key) : null;
        return {
          key,
          label: scalesMeta[key] ?? key,
          mean,
          delta: curM != null && prevM != null ? round2(curM - prevM) : null,
          trend: trendOf(curM, prevM),
        };
      });
    }

    // Срез по отделам (с приватным минимумом на каждый отдел).
    const byDept = new Map<string, AnonResult[]>();
    for (const r of rows) {
      if (!r.departmentId) continue;
      const arr = byDept.get(r.departmentId) ?? [];
      arr.push(r);
      byDept.set(r.departmentId, arr);
    }
    const deptRows: PulseDeptRow[] = [...byDept.entries()]
      .map(([id, drows]) => {
        const ok = drows.length >= PRIVACY_MIN_RESPONSES;
        return {
          id,
          name: deptName.get(id) ?? "—",
          count: drows.length,
          hidden: !ok,
          enps: isEnps && ok ? enpsKey(drows) : null,
          scales: isEnps
            ? []
            : keys.map((key) => ({ key, mean: ok ? meanKey(drows, key) : null })),
        };
      })
      .sort((a, b) => b.count - a.count);

    out.push({
      code: t.code,
      title: t.title,
      category: t.category,
      method,
      isEnps,
      total,
      enough,
      lastResponseAt,
      scales,
      enps,
      departments: deptRows,
    });
  }

  // Сначала тесты с бОльшим числом ответов.
  return out.sort((a, b) => b.total - a.total);
}

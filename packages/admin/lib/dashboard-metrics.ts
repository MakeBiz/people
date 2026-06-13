import "server-only";
import { prisma } from "@/lib/db";
import {
  PRIVACY_MIN_RESPONSES,
  MBI_EXHAUSTION_HIGH,
  engagementZone,
  stressZone,
  enpsZone,
  type Zone,
} from "@/lib/dashboard-config";

export type Trend = "up" | "down" | "flat" | null;

export interface Metric {
  value: number | null;
  delta: number | null;
  trend: Trend;
  zone: Zone;
  series: number[]; // история для спарклайна (от старых к новым)
}

// --- helpers ---
const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

function trendOf(cur: number | null, prev: number | null): Trend {
  if (cur == null || prev == null) return null;
  return cur > prev ? "up" : cur < prev ? "down" : "flat";
}

interface PersonMetric {
  personId: string;
  departmentId: string | null;
  latest: number;
  prev: number | null;
}

// Последнее и предыдущее значение метрики по каждому человеку (для среднего и динамики).
async function latestPerPerson(
  testCode: string,
  metric: string,
  deptFilter?: string
): Promise<PersonMetric[]> {
  const test = await prisma.test.findUnique({ where: { code: testCode } });
  if (!test) return [];
  const results = await prisma.result.findMany({
    where: {
      testId: test.id,
      personId: { not: null },
      ...(deptFilter ? { departmentId: deptFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { personId: true, departmentId: true, scores: true },
  });
  const byPerson = new Map<string, PersonMetric>();
  for (const r of results) {
    const v = (r.scores as Record<string, number>)[metric];
    if (typeof v !== "number" || !r.personId) continue;
    const e = byPerson.get(r.personId);
    if (!e) byPerson.set(r.personId, { personId: r.personId, departmentId: r.departmentId, latest: v, prev: null });
    else if (e.prev == null) e.prev = v;
  }
  return [...byPerson.values()];
}

function avgMetric(rows: PersonMetric[], series: number[] = []): Metric {
  const cur = mean(rows.map((r) => r.latest));
  const prev = mean(rows.filter((r) => r.prev != null).map((r) => r.prev as number));
  return {
    value: cur == null ? null : round2(cur),
    delta: cur != null && prev != null ? round2(cur - prev) : null,
    trend: trendOf(cur, prev),
    zone: "none",
    series,
  };
}

// Корзины значений метрики по индексу свежести (0 = последний замер каждого человека).
const POINTS = 6;
async function recencyBuckets(
  testCode: string,
  metric: string,
  deptFilter?: string
): Promise<number[][]> {
  const test = await prisma.test.findUnique({ where: { code: testCode } });
  if (!test) return [];
  const results = await prisma.result.findMany({
    where: { testId: test.id, personId: { not: null }, ...(deptFilter ? { departmentId: deptFilter } : {}) },
    orderBy: { createdAt: "desc" },
    select: { personId: true, scores: true },
  });
  const perPerson = new Map<string, number[]>();
  for (const r of results) {
    const v = (r.scores as Record<string, number>)[metric];
    if (typeof v !== "number" || !r.personId) continue;
    const arr = perPerson.get(r.personId) ?? [];
    if (arr.length < POINTS) {
      arr.push(v);
      perPerson.set(r.personId, arr);
    }
  }
  const buckets: number[][] = Array.from({ length: POINTS }, () => []);
  for (const arr of perPerson.values()) arr.forEach((v, i) => buckets[i].push(v));
  return buckets; // index 0 = свежие
}

// Спарклайн среднего: непустые корзины, от старых к новым.
function seriesMean(buckets: number[][]): number[] {
  return buckets
    .map((b) => mean(b))
    .filter((v): v is number => v != null)
    .reverse()
    .map(round2);
}

// Спарклайн счётчика «высокой зоны» (выгорание).
function seriesCountHigh(buckets: number[][], threshold: number): number[] {
  return buckets
    .filter((b) => b.length > 0)
    .map((b) => b.filter((v) => v >= threshold).length)
    .reverse();
}

// eNPS = %промоутеров (9-10) − %критиков (0-6). Анонимный, агрегируется без person_id.
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

async function enpsValues(deptFilter?: string): Promise<number[]> {
  const test = await prisma.test.findUnique({ where: { code: "enps" } });
  if (!test) return [];
  const rows = await prisma.result.findMany({
    where: { testId: test.id, ...(deptFilter ? { departmentId: deptFilter } : {}) },
    select: { scores: true },
  });
  return rows
    .map((r) => (r.scores as Record<string, number>).enps)
    .filter((v): v is number => typeof v === "number");
}

// --- Виджет 2: здоровье команды ---
export interface CompanyHealth {
  enps: Metric;
  engagement: Metric;
  stress: Metric;
  burnout: { count: number; series: number[] };
}

export async function getCompanyHealth(deptFilter?: string): Promise<CompanyHealth> {
  const [uwes, pss, mbi, enpsVals, uwesB, pssB, mbiB, enpsSer] = await Promise.all([
    latestPerPerson("uwes9", "total", deptFilter),
    latestPerPerson("pss10", "stress", deptFilter),
    latestPerPerson("mbi", "exhaustion", deptFilter),
    enpsValues(deptFilter),
    recencyBuckets("uwes9", "total", deptFilter),
    recencyBuckets("pss10", "stress", deptFilter),
    recencyBuckets("mbi", "exhaustion", deptFilter),
    enpsSeries(deptFilter),
  ]);

  const engagement = avgMetric(uwes, seriesMean(uwesB));
  engagement.zone = engagementZone(engagement.value);
  const stress = avgMetric(pss, seriesMean(pssB));
  stress.zone = stressZone(stress.value);

  const enpsVal = enpsFromValues(enpsVals);
  const enps: Metric = {
    value: enpsVal,
    delta: enpsSer.length >= 2 ? enpsSer[enpsSer.length - 1] - enpsSer[enpsSer.length - 2] : null,
    trend:
      enpsSer.length >= 2
        ? trendOf(enpsSer[enpsSer.length - 1], enpsSer[enpsSer.length - 2])
        : null,
    zone: enpsZone(enpsVal),
    series: enpsSer,
  };

  const burnoutCount = mbi.filter((r) => r.latest >= MBI_EXHAUSTION_HIGH).length;

  return { enps, engagement, stress, burnout: { count: burnoutCount, series: seriesCountHigh(mbiB, MBI_EXHAUSTION_HIGH) } };
}

// eNPS-серия: анонимные результаты делятся по времени на POINTS корзин.
async function enpsSeries(deptFilter?: string): Promise<number[]> {
  const test = await prisma.test.findUnique({ where: { code: "enps" } });
  if (!test) return [];
  const rows = await prisma.result.findMany({
    where: { testId: test.id, ...(deptFilter ? { departmentId: deptFilter } : {}) },
    orderBy: { createdAt: "asc" },
    select: { scores: true },
  });
  const vals = rows
    .map((r) => (r.scores as Record<string, number>).enps)
    .filter((v): v is number => typeof v === "number");
  if (vals.length < 2) return vals.length ? [enpsFromValues(vals) ?? 0] : [];
  const chunkSize = Math.max(1, Math.ceil(vals.length / POINTS));
  const out: number[] = [];
  for (let i = 0; i < vals.length; i += chunkSize) {
    const e = enpsFromValues(vals.slice(i, i + chunkSize));
    if (e != null) out.push(e);
  }
  return out;
}

// --- Виджет 3: срез по отделам (с приватным минимумом) ---
export interface DeptRow {
  id: string;
  name: string;
  headcount: number;
  engagement: { value: number | null; zone: Zone };
  stress: { value: number | null; zone: Zone };
  enps: { value: number | null; zone: Zone; hidden: boolean }; // hidden = мало данных
  alerts: number;
}

export async function getDepartmentBreakdown(deptFilter?: string): Promise<DeptRow[]> {
  const departments = await prisma.department.findMany({
    where: deptFilter ? { id: deptFilter } : {},
    orderBy: { name: "asc" },
  });
  const [uwes, pss, enpsRows, headcounts, alertGroups] = await Promise.all([
    latestPerPerson("uwes9", "total"),
    latestPerPerson("pss10", "stress"),
    enpsRowsByDept(),
    prisma.person.groupBy({ by: ["departmentId"], where: { status: { not: "archived" } }, _count: true }),
    activeAlertsByDept(),
  ]);

  const groupAvg = (rows: PersonMetric[], dept: string) =>
    mean(rows.filter((r) => r.departmentId === dept).map((r) => r.latest));
  const headByDept = new Map(headcounts.map((h) => [h.departmentId, h._count]));

  return departments.map((d) => {
    const eng = groupAvg(uwes, d.id);
    const str = groupAvg(pss, d.id);
    const enpsList = enpsRows.get(d.id) ?? [];
    const enoughEnps = enpsList.length >= PRIVACY_MIN_RESPONSES;
    const enpsVal = enoughEnps ? enpsFromValues(enpsList) : null;
    return {
      id: d.id,
      name: d.name,
      headcount: headByDept.get(d.id) ?? 0,
      engagement: { value: eng == null ? null : round2(eng), zone: engagementZone(eng) },
      stress: { value: str == null ? null : round2(str), zone: stressZone(str) },
      enps: { value: enpsVal, zone: enpsZone(enpsVal), hidden: !enoughEnps && enpsList.length > 0 },
      alerts: alertGroups.get(d.id) ?? 0,
    };
  });
}

async function enpsRowsByDept(): Promise<Map<string, number[]>> {
  const test = await prisma.test.findUnique({ where: { code: "enps" } });
  if (!test) return new Map();
  const rows = await prisma.result.findMany({
    where: { testId: test.id, departmentId: { not: null } },
    select: { departmentId: true, scores: true },
  });
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const v = (r.scores as Record<string, number>).enps;
    if (typeof v !== "number" || !r.departmentId) continue;
    if (!map.has(r.departmentId)) map.set(r.departmentId, []);
    map.get(r.departmentId)!.push(v);
  }
  return map;
}

async function activeAlertsByDept(): Promise<Map<string, number>> {
  // алерты людей отдела + системные алерты самого отдела
  const alerts = await prisma.alert.findMany({
    where: { status: { not: "resolved" } },
    select: { departmentId: true, person: { select: { departmentId: true } } },
  });
  const map = new Map<string, number>();
  for (const a of alerts) {
    const dept = a.departmentId ?? a.person?.departmentId;
    if (!dept) continue;
    map.set(dept, (map.get(dept) ?? 0) + 1);
  }
  return map;
}

// --- Виджет 4: список риска ---
export interface RiskPersonRow {
  id: string;
  name: string;
  department: string | null;
  level: string;
  reason: string;
  date: Date;
}

const RULE_REASON: Record<string, string> = {
  engagement_drop: "Падение вовлечённости",
  stress_rise: "Рост стресса",
  stress_high: "Высокий стресс",
  burnout_high: "Высокое выгорание",
  burnout_rise: "Рост истощения",
  cynism_high: "Высокий цинизм",
  invalid_session: "Сомнительная валидность",
  enps_drop: "Падение eNPS отдела",
};

export async function getRiskList(deptFilter?: string): Promise<RiskPersonRow[]> {
  const alerts = await prisma.alert.findMany({
    where: {
      status: { not: "resolved" },
      personId: { not: null },
      ...(deptFilter ? { person: { departmentId: deptFilter } } : {}),
    },
    include: { person: { include: { department: true } } },
    orderBy: { createdAt: "desc" },
  });
  // по человеку — самый серьёзный активный сигнал
  const byPerson = new Map<string, RiskPersonRow>();
  for (const a of alerts) {
    if (!a.person) continue;
    const existing = byPerson.get(a.person.id);
    const better = !existing || (existing.level !== "red" && a.level === "red");
    if (better) {
      byPerson.set(a.person.id, {
        id: a.person.id,
        name: a.person.fullName,
        department: a.person.department?.name ?? null,
        level: a.level,
        reason: RULE_REASON[a.ruleCode] ?? a.ruleCode,
        date: a.createdAt,
      });
    }
  }
  return [...byPerson.values()].sort((x, y) => {
    if (x.level !== y.level) return x.level === "red" ? -1 : 1;
    return y.date.getTime() - x.date.getTime();
  });
}

// --- Виджет 5: прогресс замеров ---
export interface MonitoringProgress {
  code: string;
  title: string;
  total: number;
  completed: number;
  pct: number;
  deadline: Date | null;
}

// --- Распределение мотивации (донат, по тесту Герчикова) ---
export interface MotivationSlice {
  type: string;
  label: string;
  color: string;
  count: number;
  pct: number;
}

const GERCHIKOV_TYPES: Record<string, { label: string; color: string }> = {
  PR: { label: "Профессионалы", color: "#013CA4" },
  IN: { label: "Инструментальный (деньги)", color: "#074EE8" },
  PA: { label: "Патриоты (команда)", color: "#9CB5DB" },
  HO: { label: "Хозяйский (автономия)", color: "#F4C800" },
  LU: { label: "Избегательный", color: "#1FA971" },
};

export async function getMotivationDistribution(deptFilter?: string): Promise<MotivationSlice[]> {
  const test = await prisma.test.findUnique({ where: { code: "gerchikov" } });
  if (!test) return [];
  const results = await prisma.result.findMany({
    where: { testId: test.id, personId: { not: null }, ...(deptFilter ? { departmentId: deptFilter } : {}) },
    orderBy: { createdAt: "desc" },
    select: { personId: true, scores: true },
  });
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const r of results) {
    if (!r.personId || seen.has(r.personId)) continue;
    seen.add(r.personId);
    const scores = r.scores as Record<string, number>;
    let top: string | null = null;
    let max = -Infinity;
    for (const k of Object.keys(GERCHIKOV_TYPES)) {
      if ((scores[k] ?? -Infinity) > max) {
        max = scores[k] ?? -Infinity;
        top = k;
      }
    }
    if (top) counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((s, v) => s + v, 0);
  if (!total) return [];
  return Object.entries(GERCHIKOV_TYPES)
    .map(([type, meta]) => ({
      type,
      label: meta.label,
      color: meta.color,
      count: counts.get(type) ?? 0,
      pct: Math.round(((counts.get(type) ?? 0) / total) * 100),
    }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
}

export async function getMonitoringProgress(deptFilter?: string): Promise<MonitoringProgress[]> {
  const tests = await prisma.test.findMany({
    where: { category: "monitoring" },
    select: { id: true, code: true, title: true },
  });
  const out: MonitoringProgress[] = [];
  for (const t of tests) {
    const where = {
      testId: t.id,
      ...(deptFilter ? { departmentId: deptFilter } : {}),
    };
    const [total, completed, nextDeadline] = await Promise.all([
      prisma.assignment.count({ where }),
      prisma.assignment.count({ where: { ...where, status: "completed" } }),
      prisma.assignment.findFirst({
        where: { ...where, deadline: { not: null }, status: { not: "completed" } },
        orderBy: { deadline: "asc" },
        select: { deadline: true },
      }),
    ]);
    if (total === 0) continue;
    out.push({
      code: t.code,
      title: t.title,
      total,
      completed,
      pct: Math.round((completed / total) * 100),
      deadline: nextDeadline?.deadline ?? null,
    });
  }
  return out;
}

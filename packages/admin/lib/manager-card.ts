import "server-only";
import {
  CARD_TESTS,
  MONITORING_TESTS,
  BLOCK,
  ALL_BLOCK_LABELS,
  BIGFIVE_ROUTING,
  FEEDBACK_BY_N,
  TKI_RISK,
  TENSION_RULES,
  type TensionCond,
} from "./manager-card-config";

const YEAR_MS = 365 * 24 * 3600 * 1000;

export interface ResultInput {
  createdAt: Date;
  scores: unknown;
  interpretation: unknown;
  test: { code: string; title: string };
}

interface InterpEntry {
  scale: string;
  level: string;
  text: string;
  value?: number;
}
interface ParsedEntry {
  scale: string;
  level: string;
  lead: string;
  intro: string;
  blocks: Record<string, string>;
}
interface ParsedTest {
  code: string;
  date: Date;
  stale: boolean;
  entries: ParsedEntry[];
  scales: string[];
  levels: Record<string, string>; // scale → level (для Big Five)
}

// --- Парсер текста интерпретации в lead + intro + помеченные блоки ---
function parseText(text: string): { lead: string; intro: string; blocks: Record<string, string> } {
  const dot = text.indexOf(". ");
  const lead = (dot > 0 ? text.slice(0, dot) : text).trim();
  const rest = dot > 0 ? text.slice(dot + 2) : "";
  const labelRe = /([А-ЯЁ][А-ЯЁ ]{2,}?):\s*/g;
  const matches = [...rest.matchAll(labelRe)].filter((m) =>
    ALL_BLOCK_LABELS.includes(m[1].trim())
  );
  const blocks: Record<string, string> = {};
  let intro = rest;
  if (matches.length) {
    intro = rest.slice(0, matches[0].index ?? 0);
    for (let i = 0; i < matches.length; i++) {
      const label = matches[i][1].trim();
      const start = (matches[i].index ?? 0) + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index ?? rest.length : rest.length;
      blocks[label] = clean(rest.slice(start, end));
    }
  }
  return { lead: clean(lead), intro: clean(intro), blocks };
}
const clean = (s: string) => s.trim().replace(/[.\s]+$/, "").trim();
const entryText = (e: ParsedEntry) => [e.lead, e.intro].filter(Boolean).join(". ");

function parseTest(now: number, r: ResultInput): ParsedTest {
  const interp = (r.interpretation as InterpEntry[] | null) ?? [];
  const entries: ParsedEntry[] = interp.map((e) => ({
    scale: e.scale,
    level: e.level,
    ...parseText(e.text),
  }));
  const levels: Record<string, string> = {};
  for (const e of entries) levels[e.scale] = e.level;
  return {
    code: r.test.code,
    date: r.createdAt,
    stale: now - r.createdAt.getTime() > YEAR_MS,
    entries,
    scales: entries.map((e) => e.scale),
    levels,
  };
}

// --- Типы выходных данных карточки ---
export interface SlotItem {
  source: string;
  label?: string;
  text: string;
  date?: string;
  stale?: boolean;
}
export interface Slot {
  id: string;
  title: string;
  items: SlotItem[];
  missing: Array<{ code: string; label: string }>;
}
export interface MonitoringRow {
  code: string;
  label: string;
  value: number;
  level: string | null;
  levelText: string | null;
  trend: "up" | "down" | "flat" | null;
  worse: boolean; // тренд в плохую сторону
  date: string;
}
export interface ManagerCard {
  portrait: string | null;
  slots: Slot[];
  tensions: string[];
  monitoring: MonitoringRow[];
  passedTests: string[];
  missingTests: Array<{ code: string; label: string }>;
  anyData: boolean;
}

function ru(d: Date) {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function buildManagerCard(results: ResultInput[], nowMs: number): ManagerCard {
  // последний результат по каждому коду (results отсортированы desc по дате)
  const latest = new Map<string, ParsedTest>();
  for (const r of results) {
    if (!latest.has(r.test.code)) latest.set(r.test.code, parseTest(nowMs, r));
  }
  const t = (code: string) => latest.get(code);

  const item = (
    code: string,
    text: string | undefined,
    label?: string
  ): SlotItem | null => {
    const pt = t(code);
    if (!pt || !text) return null;
    return { source: CARD_TESTS[code]?.label ?? code, label, text, date: ru(pt.date), stale: pt.stale };
  };
  const block = (code: string, lbl: string) => t(code)?.entries[0]?.blocks[lbl];
  const lead = (code: string) => t(code)?.entries[0]?.lead;
  const intro = (code: string) => t(code)?.entries[0]?.intro;

  // --- Слот 1: краткий портрет ---
  const portraitParts = [lead("disc"), lead("spiral"), lead("gerchikov")].filter(Boolean);
  const portrait = portraitParts.length ? portraitParts.join(" · ") : null;

  // --- Слот 2: задачи и общение ---
  const s2: SlotItem[] = [
    item("disc", block("disc", BLOCK.tasks), "Как ставить задачи"),
    item("spiral", block("spiral", BLOCK.talk), "Как общаться"),
  ].filter(Boolean) as SlotItem[];

  // --- Слот 3: обратная связь ---
  const s3: SlotItem[] = [item("disc", block("disc", BLOCK.feedback))].filter(Boolean) as SlotItem[];
  const nLevel = t("bigfive")?.levels.N;
  if (nLevel && FEEDBACK_BY_N[nLevel]) {
    s3.push({ source: CARD_TESTS.bigfive.label, label: "Нейротизм", text: FEEDBACK_BY_N[nLevel] });
  }

  // --- Слот 4: что мотивирует ---
  const s4: SlotItem[] = [
    item("gerchikov", [lead("gerchikov"), intro("gerchikov")].filter(Boolean).join(". ")),
    item("spiral", [lead("spiral"), intro("spiral")].filter(Boolean).join(". "), "Ценностный смысл"),
  ].filter(Boolean) as SlotItem[];
  // якоря Шейна (1-2): что удерживает
  for (const e of t("schein")?.entries ?? []) {
    s4.push({
      source: CARD_TESTS.schein.label,
      label: "Якорь",
      text: [e.lead, e.intro].filter(Boolean).join(". "),
      date: ru(t("schein")!.date),
      stale: t("schein")!.stale,
    });
  }

  // --- Слот 5: чего НЕ делать ---
  const s5: SlotItem[] = [
    item("disc", block("disc", BLOCK.dont)),
    item("spiral", block("spiral", BLOCK.dont)),
  ].filter(Boolean) as SlotItem[];

  // --- Слот 6: в конфликте ---
  const tkiConflict = [lead("tki"), block("tki", BLOCK.howWork)].filter(Boolean).join(". ");
  const s6: SlotItem[] = [
    item("tki", tkiConflict),
    item("disc", block("disc", BLOCK.conflict)),
  ].filter(Boolean) as SlotItem[];

  // --- Слот 7: сильные стороны ---
  const s7: SlotItem[] = [];
  for (const e of t("bigfive")?.entries ?? []) {
    const route = BIGFIVE_ROUTING[e.scale];
    if (route && ((e.level === "high" && route.high === "strength") || (e.level === "low" && route.low === "strength"))) {
      s7.push({ source: CARD_TESTS.bigfive.label, text: entryText(e), date: ru(t("bigfive")!.date), stale: t("bigfive")!.stale });
    }
  }
  const paeiStrength = [block("paei", BLOCK.strength), block("paei", BLOCK.goodAt)]
    .filter(Boolean)
    .join(". ХОРОШ: ");
  const ps = item("paei", paeiStrength, lead("paei") ?? undefined);
  if (ps) s7.push(ps);

  // --- Слот 8: слепые зоны и риски ---
  const s8: SlotItem[] = [];
  for (const e of t("bigfive")?.entries ?? []) {
    const route = BIGFIVE_ROUTING[e.scale];
    if (route && ((e.level === "high" && route.high === "blind") || (e.level === "low" && route.low === "blind"))) {
      s8.push({ source: CARD_TESTS.bigfive.label, text: entryText(e), date: ru(t("bigfive")!.date), stale: t("bigfive")!.stale });
    }
  }
  const pb = item("paei", block("paei", BLOCK.blind), lead("paei") ?? undefined);
  if (pb) s8.push(pb);
  for (const sc of t("tki")?.scales ?? []) {
    if (TKI_RISK[sc]) s8.push({ source: CARD_TESTS.tki.label, text: TKI_RISK[sc] });
  }

  // --- Слот 9: развитие и удержание ---
  const s9: SlotItem[] = [];
  for (const e of t("schein")?.entries ?? []) {
    const dev = [e.blocks[BLOCK.develop] && `Развитие: ${e.blocks[BLOCK.develop]}`, e.blocks[BLOCK.leaveIf] && `Уйдёт если: ${e.blocks[BLOCK.leaveIf]}`]
      .filter(Boolean)
      .join(". ");
    if (dev) s9.push({ source: CARD_TESTS.schein.label, label: e.lead, text: dev, date: ru(t("schein")!.date), stale: t("schein")!.stale });
  }
  const gerHold = item("gerchikov", intro("gerchikov"), "Чем удерживать");
  if (gerHold) s9.push(gerHold);

  const mk = (id: string, title: string, items: SlotItem[], sources: string[]): Slot => ({
    id,
    title,
    items,
    missing: sources
      .filter((c) => !latest.has(c))
      .map((c) => ({ code: c, label: CARD_TESTS[c]?.label ?? c })),
  });

  const slots: Slot[] = [
    mk("tasks", "Как ставить задачи и общаться", s2, ["disc", "spiral"]),
    mk("feedback", "Как давать обратную связь", s3, ["disc", "bigfive"]),
    mk("motivation", "Что мотивирует", s4, ["gerchikov", "spiral", "schein"]),
    mk("dont", "Чего НЕ делать", s5, ["disc", "spiral"]),
    mk("conflict", "В конфликте", s6, ["tki", "disc"]),
    mk("strengths", "Сильные стороны", s7, ["bigfive", "paei"]),
    mk("blind", "Слепые зоны и риски", s8, ["bigfive", "paei", "tki"]),
    mk("develop", "Развитие и удержание", s9, ["schein", "gerchikov"]),
  ];

  // --- Слой напряжений ---
  const matchCond = (c: TensionCond): boolean => {
    const pt = t(c.test);
    if (!pt) return false;
    if ("hasScale" in c) return pt.scales.includes(c.hasScale);
    return pt.levels[c.scale] === c.level;
  };
  const tensions = TENSION_RULES.filter((rule) => rule.when.every(matchCond)).map((r) => r.text);

  // --- Мониторинг (слот 10) со стрелками динамики ---
  const monitoring: MonitoringRow[] = [];
  for (const m of MONITORING_TESTS) {
    const series = results.filter((r) => r.test.code === m.code);
    if (!series.length) continue;
    const cur = series[0];
    const curVal = (cur.scores as Record<string, number>)[m.metric];
    if (typeof curVal !== "number") continue;
    const interp = (cur.interpretation as InterpEntry[] | null) ?? [];
    const match = interp.find((i) => i.scale === m.metric || i.scale === "total" || i.scale === "stress");
    let trend: MonitoringRow["trend"] = null;
    let worse = false;
    if (series[1]) {
      const prev = (series[1].scores as Record<string, number>)[m.metric];
      if (typeof prev === "number") {
        trend = curVal > prev ? "up" : curVal < prev ? "down" : "flat";
        worse = trend === (m.higherIsWorse ? "up" : "down");
      }
    }
    monitoring.push({
      code: m.code,
      label: m.label,
      value: Math.round(curVal * 100) / 100,
      level: match?.level ?? null,
      levelText: match?.text ?? null,
      trend,
      worse,
      date: ru(cur.createdAt),
    });
  }

  const passedTests = [...latest.keys()].filter((c) => CARD_TESTS[c]);
  const missingTests = Object.keys(CARD_TESTS)
    .filter((c) => !latest.has(c))
    .map((c) => ({ code: c, label: CARD_TESTS[c].label }));

  return {
    portrait,
    slots,
    tensions,
    monitoring,
    passedTests,
    missingTests,
    anyData: latest.size > 0,
  };
}

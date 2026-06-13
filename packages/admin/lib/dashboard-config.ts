// Конфиг дашборда: пороги светофора и приватность (раздел 3 спеки). Не хардкодить.

export type Zone = "red" | "yellow" | "green" | "none";

// Минимум ответов в отделе, чтобы показывать агрегат анонимного замера
// (защита от деанонимизации).
export const PRIVACY_MIN_RESPONSES = 4;

// Высокая зона истощения MBI (счётчик выгорания).
export const MBI_EXHAUSTION_HIGH = 27;

// Пороги светофора.
export const TRAFFIC = {
  // вовлечённость: красный < 2.5, жёлтый 2.5–4.5, зелёный > 4.5
  engagement: { red: 2.5, green: 4.5 },
  // стресс: зелёный < 14, жёлтый 14–26, красный >= 27 (рост = плохо)
  stress: { green: 14, red: 27 },
  // eNPS: красный < 0, жёлтый 0–29, зелёный >= 30
  enps: { red: 0, green: 30 },
};

export function engagementZone(v: number | null): Zone {
  if (v == null) return "none";
  if (v < TRAFFIC.engagement.red) return "red";
  if (v > TRAFFIC.engagement.green) return "green";
  return "yellow";
}

export function stressZone(v: number | null): Zone {
  if (v == null) return "none";
  if (v < TRAFFIC.stress.green) return "green";
  if (v >= TRAFFIC.stress.red) return "red";
  return "yellow";
}

export function enpsZone(v: number | null): Zone {
  if (v == null) return "none";
  if (v < TRAFFIC.enps.red) return "red";
  if (v >= TRAFFIC.enps.green) return "green";
  return "yellow";
}

// CSS-классы Badge/ячейки под зону (для UI).
export const ZONE_BADGE: Record<Zone, string> = {
  red: "bg-red-100 text-red-700",
  yellow: "bg-amber-100 text-amber-700",
  green: "bg-green-100 text-green-700",
  none: "bg-slate-100 text-slate-500",
};

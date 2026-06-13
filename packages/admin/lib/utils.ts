import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Утилита склейки классов Tailwind (shadcn/ui). Чистая, безопасна и в client-компонентах.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function deepLink(token: string): string {
  const username = process.env.BOT_USERNAME ?? "your_bot";
  return `https://t.me/${username}?start=${token}`;
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const STATUS_RU: Record<string, string> = {
  candidate: "Кандидат",
  employee: "Сотрудник",
  archived: "Архив",
  pending: "Ожидает",
  in_progress: "В процессе",
  completed: "Пройден",
  expired: "Истёк",
  new: "Новый",
  acknowledged: "В работе",
  resolved: "Решён",
};

export const RULE_RU: Record<string, string> = {
  engagement_drop: "Падение вовлечённости",
  stress_rise: "Рост стресса",
  burnout_high: "Высокое выгорание",
  enps_drop: "Падение eNPS",
  invalid_session: "Сомнительная валидность",
};

// BigInt (telegram_id) безопасная сериализация для клиентских компонентов
export function serializable<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

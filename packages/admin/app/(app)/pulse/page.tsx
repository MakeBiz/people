import { getPulseAggregates, type Trend } from "@/lib/pulse-metrics";
import { PRIVACY_MIN_RESPONSES } from "@/lib/dashboard-config";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const CATEGORY_RU: Record<string, string> = {
  candidate: "Кандидат",
  typing: "Типирование",
  deep: "Глубокий анализ",
  monitoring: "Мониторинг",
};

function TrendChip({ delta, trend }: { delta: number | null; trend: Trend }) {
  if (delta == null || trend == null || trend === "flat") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const up = trend === "up";
  return (
    <span className={`text-xs font-bold ${up ? "text-mk-green" : "text-mk-red"}`}>
      {up ? "▲" : "▼"} {delta > 0 ? "+" : ""}
      {delta}
    </span>
  );
}

export default async function PulsePage() {
  const tests = await getPulseAggregates();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Пульс-опросы (агрегат)</h1>
      <p className="text-sm text-muted-foreground">
        Сводка анонимных замеров без привязки к людям. Значения и срезы по отделам с числом
        ответов меньше {PRIVACY_MIN_RESPONSES} скрыты — чтобы по агрегату нельзя было вычислить
        конкретного сотрудника. Динамика (▲▼) — свежая половина ответов против предыдущей.
      </p>

      {tests.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Пока нет анонимных ответов. Создайте анонимную{" "}
            <a href="/campaigns" className="text-primary underline">
              кампанию мониторинга
            </a>{" "}
            — сводка появится здесь, как только сотрудники начнут отвечать.
          </CardContent>
        </Card>
      )}

      {tests.map((t) => (
        <Card key={t.code}>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">{t.title}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {CATEGORY_RU[t.category] ?? t.category}
                {t.lastResponseAt && <> · последний ответ {formatDateTime(t.lastResponseAt)}</>}
              </p>
            </div>
            <Badge variant={t.enough ? "blue" : "slate"}>
              {t.total}{" "}
              {t.total % 10 === 1 && t.total % 100 !== 11
                ? "ответ"
                : t.total % 10 >= 2 && t.total % 10 <= 4 && (t.total % 100 < 10 || t.total % 100 >= 20)
                  ? "ответа"
                  : "ответов"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {!t.enough ? (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Недостаточно ответов для показа агрегата ({t.total}/{PRIVACY_MIN_RESPONSES}). Значения
                скрыты для защиты анонимности.
              </p>
            ) : (
              <>
                {/* Сводка по компании */}
                <div className="flex flex-wrap gap-6">
                  {t.isEnps && t.enps ? (
                    <div>
                      <div className="text-xs text-muted-foreground">eNPS-индекс</div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold">{t.enps.value ?? "—"}</span>
                        <TrendChip delta={t.enps.delta} trend={t.enps.trend} />
                      </div>
                    </div>
                  ) : (
                    t.scales.map((s) => (
                      <div key={s.key}>
                        <div className="text-xs text-muted-foreground">{s.label}</div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold">{s.mean ?? "—"}</span>
                          <TrendChip delta={s.delta} trend={s.trend} />
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Срез по отделам */}
                {t.departments.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">Отдел</th>
                          <th className="py-2 pr-4 font-medium">Ответов</th>
                          {t.isEnps ? (
                            <th className="py-2 pr-4 font-medium">eNPS</th>
                          ) : (
                            t.scales.map((s) => (
                              <th key={s.key} className="py-2 pr-4 font-medium">
                                {s.label}
                              </th>
                            ))
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {t.departments.map((d) => (
                          <tr key={d.id} className="border-b last:border-0">
                            <td className="py-2 pr-4">{d.name}</td>
                            <td className="py-2 pr-4">{d.count}</td>
                            {d.hidden ? (
                              <td
                                className="py-2 pr-4 text-xs italic text-muted-foreground"
                                colSpan={t.isEnps ? 1 : t.scales.length}
                              >
                                скрыто (&lt;{PRIVACY_MIN_RESPONSES})
                              </td>
                            ) : t.isEnps ? (
                              <td className="py-2 pr-4 font-medium">{d.enps ?? "—"}</td>
                            ) : (
                              d.scales.map((s) => (
                                <td key={s.key} className="py-2 pr-4 font-medium">
                                  {s.mean ?? "—"}
                                </td>
                              ))
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

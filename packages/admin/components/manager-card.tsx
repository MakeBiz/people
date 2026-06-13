import { createAssignment } from "@/app/(app)/actions";
import { RULE_RU } from "@/lib/utils";
import type { ManagerCard as ManagerCardData, SlotItem } from "@/lib/manager-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ActiveAlert {
  id: string;
  level: string;
  ruleCode: string;
  details: unknown;
}

function AssignButton({ personId, code, label }: { personId: string; code: string; label: string }) {
  return (
    <form action={createAssignment} className="inline">
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="testId" value={code} />
      <Button type="submit" variant="outline" size="sm">
        Назначить: {label}
      </Button>
    </form>
  );
}

function ItemRow({ it }: { it: SlotItem }) {
  return (
    <li className="text-sm leading-relaxed">
      <span className="font-medium text-foreground/90">{it.source}</span>
      {it.label && <span className="text-muted-foreground"> · {it.label}</span>}
      {it.stale && (
        <Badge variant="yellow" className="ml-2">
          данные устарели
        </Badge>
      )}
      <div className="text-foreground/90">{it.text}</div>
    </li>
  );
}

export function ManagerCard({
  data,
  personId,
  testIdByCode,
  alerts,
}: {
  data: ManagerCardData;
  personId: string;
  testIdByCode: Record<string, string>; // code → test.id для назначения
  alerts: ActiveAlert[];
}) {
  if (!data.anyData) {
    return (
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="text-base">🧭 Как работать с сотрудником</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Профильные тесты ещё не пройдены. Карточка станет осмысленной уже после DISC + Герчиков.
          </p>
          <div className="flex flex-wrap gap-2">
            {data.missingTests.map((m) =>
              testIdByCode[m.code] ? (
                <AssignButton key={m.code} personId={personId} code={testIdByCode[m.code]} label={m.label} />
              ) : null
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          🧭 Как работать с сотрудником
          <Badge variant="slate">
            собрано из {data.passedTests.length} тест(ов)
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Краткий портрет */}
        {data.portrait && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Краткий портрет
            </div>
            <div className="mt-1 text-base font-medium">{data.portrait}</div>
          </div>
        )}

        {/* Напряжения */}
        {data.tensions.length > 0 && (
          <div className="space-y-2">
            {data.tensions.map((t, i) => (
              <div
                key={i}
                className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              >
                <span>⚖️</span>
                <span>{t}</span>
              </div>
            ))}
          </div>
        )}

        {/* Слоты 2–9 */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.slots.map((slot) => (
            <div key={slot.id} className="rounded-md border bg-muted/30 p-3">
              <div className="mb-2 text-sm font-semibold">{slot.title}</div>
              {slot.items.length > 0 ? (
                <ul className="space-y-2">
                  {slot.items.map((it, i) => (
                    <ItemRow key={i} it={it} />
                  ))}
                </ul>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Нет данных — не пройдено: {slot.missing.map((m) => m.label).join(", ")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {slot.missing.map((m) =>
                      testIdByCode[m.code] ? (
                        <AssignButton
                          key={m.code}
                          personId={personId}
                          code={testIdByCode[m.code]}
                          label={m.label.replace(/\s*\(.*\)$/, "")}
                        />
                      ) : null
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Слот 10: текущее состояние (мониторинг) */}
        <div className="rounded-md border p-3">
          <div className="mb-2 text-sm font-semibold">Текущее состояние (мониторинг)</div>
          {data.monitoring.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Мониторинговые тесты (UWES, PSS-10, MBI) ещё не проходились.
            </p>
          ) : (
            <div className="space-y-2">
              {data.monitoring.map((m) => (
                <div key={m.code} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-48 font-medium">{m.label}</span>
                  <span>{m.value}</span>
                  {m.level && (
                    <Badge
                      variant={
                        m.level === "high"
                          ? m.worse
                            ? "red"
                            : "green"
                          : m.level === "low"
                            ? "slate"
                            : "yellow"
                      }
                    >
                      {m.levelText ?? m.level}
                    </Badge>
                  )}
                  {m.trend && (
                    <span
                      className={
                        m.trend === "flat"
                          ? "text-muted-foreground"
                          : m.worse
                            ? "text-red-600"
                            : "text-green-600"
                      }
                      title="динамика к прошлому замеру"
                    >
                      {m.trend === "up" ? "↑" : m.trend === "down" ? "↓" : "→"}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">· {m.date}</span>
                </div>
              ))}
            </div>
          )}

          {alerts.length > 0 && (
            <div className="mt-3 space-y-1 border-t pt-2">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  <span>{a.level === "red" ? "🔴" : "🟡"}</span>
                  <span>{RULE_RU[a.ruleCode] ?? a.ruleCode}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="border-t pt-2 text-xs text-muted-foreground/70">
          Сводка собрана из пройденных тестов и является ориентиром для диалога и развития, а не
          основанием для кадровых решений.
        </p>
      </CardContent>
    </Card>
  );
}

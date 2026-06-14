import { getDepartmentBreakdown, getCompanyHealth } from "@/lib/dashboard-metrics";
import { ZONE_BADGE, type Zone } from "@/lib/dashboard-config";
import { getScope, isPrivileged } from "@/lib/access";
import { NoAccess } from "@/components/no-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Ячейка с цветом зоны светофора.
function ZoneCell({ value, zone, suffix = "" }: { value: number | null; zone: Zone; suffix?: string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`inline-block min-w-[44px] rounded-md px-2 py-0.5 text-center font-bold ${ZONE_BADGE[zone]}`}>
      {value}
      {suffix}
    </span>
  );
}

export default async function ComparePage() {
  const scope = await getScope();
  if (!isPrivileged(scope.role)) return <NoAccess />;

  const [depts, health] = await Promise.all([getDepartmentBreakdown(), getCompanyHealth()]);

  // Рейтинги (только отделы с данными).
  const withEng = depts.filter((d) => d.engagement.value != null);
  const withStr = depts.filter((d) => d.stress.value != null);
  const bestEng = withEng.length
    ? withEng.reduce((a, b) => (b.engagement.value! > a.engagement.value! ? b : a))
    : null;
  const worstEng = withEng.length
    ? withEng.reduce((a, b) => (b.engagement.value! < a.engagement.value! ? b : a))
    : null;
  const worstStr = withStr.length
    ? withStr.reduce((a, b) => (b.stress.value! > a.stress.value! ? b : a))
    : null;

  // Шкала для горизонтальных баров вовлечённости (UWES 0–6).
  const ENG_MAX = 6;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Сравнение команд</h1>
      <p className="text-sm text-muted-foreground">
        Отделы рядом по ключевым метрикам. Цвет — зона светофора. Анонимные срезы (eNPS) скрыты
        там, где ответов меньше порога приватности. Прочерк — данных пока нет.
      </p>

      {/* Карточки-итоги */}
      <div className="grid gap-3 sm:grid-cols-3">
        <HighlightCard
          title="Самая вовлечённая"
          name={bestEng?.name}
          value={bestEng ? `${bestEng.engagement.value}` : null}
          tone="green"
        />
        <HighlightCard
          title="Нужно внимание (вовлечённость)"
          name={worstEng?.name}
          value={worstEng ? `${worstEng.engagement.value}` : null}
          tone="red"
        />
        <HighlightCard
          title="Самый высокий стресс"
          name={worstStr?.name}
          value={worstStr ? `${worstStr.stress.value}` : null}
          tone="red"
        />
      </div>

      {/* Матрица сравнения */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Отдел</th>
                <th className="px-4 py-3 font-medium">Сотрудников</th>
                <th className="px-4 py-3 font-medium">Вовлечённость</th>
                <th className="px-4 py-3 font-medium">Стресс</th>
                <th className="px-4 py-3 font-medium">eNPS</th>
                <th className="px-4 py-3 font-medium">Открытых алертов</th>
              </tr>
            </thead>
            <tbody>
              {/* Строка «Компания» — ориентир */}
              <tr className="border-b bg-muted/30 font-medium">
                <td className="px-4 py-3">Вся компания</td>
                <td className="px-4 py-3">—</td>
                <td className="px-4 py-3">
                  <ZoneCell value={health.engagement.value} zone={health.engagement.zone} />
                </td>
                <td className="px-4 py-3">
                  <ZoneCell value={health.stress.value} zone={health.stress.zone} />
                </td>
                <td className="px-4 py-3">
                  <ZoneCell value={health.enps.value} zone={health.enps.zone} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">—</td>
              </tr>
              {depts.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.name}</div>
                    {d.engagement.value != null && (
                      <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(100, (d.engagement.value / ENG_MAX) * 100)}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">{d.headcount}</td>
                  <td className="px-4 py-3">
                    <ZoneCell value={d.engagement.value} zone={d.engagement.zone} />
                  </td>
                  <td className="px-4 py-3">
                    <ZoneCell value={d.stress.value} zone={d.stress.zone} />
                  </td>
                  <td className="px-4 py-3">
                    {d.enps.hidden ? (
                      <span className="text-xs italic text-muted-foreground">скрыто</span>
                    ) : (
                      <ZoneCell value={d.enps.value} zone={d.enps.zone} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {d.alerts > 0 ? (
                      <span className="font-bold text-mk-red">{d.alerts}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                </tr>
              ))}
              {depts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Нет отделов для сравнения. Создайте подразделения в «Настройках».
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function HighlightCard({
  title,
  name,
  value,
  tone,
}: {
  title: string;
  name?: string;
  value: string | null;
  tone: "green" | "red";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {name ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-bold">{name}</span>
            <span className={`text-xl font-bold ${tone === "green" ? "text-mk-green" : "text-mk-red"}`}>
              {value}
            </span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">нет данных</span>
        )}
      </CardContent>
    </Card>
  );
}

import Link from "next/link";
import { prisma } from "@/lib/db";
import { getScope } from "@/lib/access";
import { NoAccess } from "@/components/no-access";
import { formatDate } from "@/lib/utils";
import {
  getCompanyHealth,
  getDepartmentBreakdown,
  getRiskList,
  getMonitoringProgress,
  getMotivationDistribution,
} from "@/lib/dashboard-metrics";
import type { Zone } from "@/lib/dashboard-config";
import { acknowledgeAlert, resolveAlert } from "./actions";
import { MetricCard, MotivationDonut } from "@/components/dashboard-widgets";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const RULE_INFO: Record<string, { reason: string; reco: string }> = {
  engagement_drop: {
    reason: "Падение вовлечённости с прошлого замера (UWES)",
    reco: "Личная встреча на этой неделе, разговор о задачах и нагрузке",
  },
  stress_rise: {
    reason: "Стресс растёт второй замер подряд (PSS-10)",
    reco: "Стоит спросить про текущую нагрузку",
  },
  stress_high: { reason: "Высокий уровень стресса (PSS-10)", reco: "Рекомендуем личную встречу" },
  burnout_high: {
    reason: "Высокое эмоциональное истощение (MBI)",
    reco: "Личная встреча, разговор о нагрузке",
  },
  burnout_rise: { reason: "Истощение растёт (MBI)", reco: "Присмотреться к нагрузке" },
  cynism_high: { reason: "Высокий цинизм и отстранённость (MBI)", reco: "Разговор о мотивации" },
  invalid_session: { reason: "Сомнительная валидность прохождения", reco: "Перепроверить результат" },
  enps_drop: { reason: "Падение eNPS отдела", reco: "Системный сигнал — посмотреть процессы" },
};

const PILL: Record<Zone, string> = {
  green: "bg-[#E3F5EE] text-mk-green",
  yellow: "bg-[#FBF6E0] text-[#A98A00]",
  red: "bg-[#FCEEF0] text-mk-red",
  none: "bg-mk-c4 text-[#888]",
};

function Pill({ zone, children }: { zone: Zone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block min-w-[46px] rounded-[10px] px-2.5 py-1 text-center text-[13px] font-bold ${PILL[zone]}`}
    >
      {children}
    </span>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { dept?: string };
}) {
  // Ролевой фильтр: manager видит только свой отдел; owner/hr — клик по отделу.
  const scope = await getScope(searchParams.dept);
  const role = scope.role;
  if (scope.blocked) {
    return (
      <NoAccess message="Ваша учётная запись менеджера не привязана к отделу. Обратитесь к администратору." />
    );
  }
  const deptFilter = scope.deptFilter;

  const [health, depts, risk, progress, motivation, alerts, peopleCount] = await Promise.all([
    getCompanyHealth(deptFilter),
    getDepartmentBreakdown(role === "manager" ? deptFilter : undefined),
    getRiskList(deptFilter),
    getMonitoringProgress(deptFilter),
    getMotivationDistribution(deptFilter),
    prisma.alert.findMany({
      where: {
        status: { not: "resolved" },
        ...(deptFilter
          ? { OR: [{ person: { departmentId: deptFilter } }, { departmentId: deptFilter }] }
          : {}),
      },
      include: { person: { include: { department: true } }, department: true },
      orderBy: [{ level: "asc" }, { createdAt: "desc" }],
      take: 10,
    }),
    prisma.person.count({ where: { status: { not: "archived" } } }),
  ]);

  return (
    <div>
      {/* Топбар */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-[28px] font-bold tracking-tight">Дашборд</div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            MakeBiz Group · {peopleCount} сотрудников
            {deptFilter && role !== "manager" && (
              <Link href="/" className="ml-2 text-mk-text-emph hover:underline">
                · сбросить фильтр отдела
              </Link>
            )}
          </div>
        </div>
        <div className="inline-flex gap-0.5 rounded-[16px] border border-mk-border bg-card p-1 shadow-mk">
          {["Месяц", "Квартал", "Полгода"].map((p, i) => (
            <span
              key={p}
              className={`rounded-[12px] px-4 py-1.5 text-[14px] ${
                i === 1 ? "bg-primary font-bold text-white" : "text-foreground"
              }`}
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* 1. Активные алерты */}
      <div className="mb-6 flex flex-col gap-2.5">
        {alerts.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-[14px] text-muted-foreground">
              Активных алертов нет — команда в порядке.
            </CardContent>
          </Card>
        ) : (
          alerts.map((a) => {
            const info = RULE_INFO[a.ruleCode] ?? { reason: a.ruleCode, reco: "" };
            const isDept = !a.personId && a.departmentId;
            const who = isDept
              ? `${a.department?.name ?? "Отдел"} · системный сигнал`
              : a.person?.fullName ?? "—";
            const sub = isDept
              ? "агрегат отдела"
              : [a.person?.department?.name, a.person?.position].filter(Boolean).join(" · ");
            return (
              <div
                key={a.id}
                className={`flex items-start gap-3.5 rounded-[16px] border p-4 ${
                  a.level === "red"
                    ? "border-[#F3D2D7] bg-[#FCEEF0]"
                    : "border-[#F0E6BD] bg-[#FBF6E0]"
                }`}
              >
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                    a.level === "red" ? "bg-mk-red" : "bg-mk-yellow"
                  }`}
                />
                <div className="flex-1">
                  <div className="text-[15px] font-bold">
                    {who}
                    {sub && (
                      <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                        {sub}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[14px]">{info.reason}</div>
                  {info.reco && (
                    <div className="mt-1 text-[13px] font-bold text-mk-text-emph">{info.reco}</div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {a.status === "new" && (
                    <form action={acknowledgeAlert}>
                      <input type="hidden" name="id" value={a.id} />
                      <Button variant="outline" size="sm">
                        Взять в работу
                      </Button>
                    </form>
                  )}
                  <form action={resolveAlert}>
                    <input type="hidden" name="id" value={a.id} />
                    <Button variant="outline" size="sm">
                      Решено
                    </Button>
                  </form>
                  {a.person && (
                    <Button asChild size="sm">
                      <Link href={`/people/${a.person.id}`}>Открыть карточку</Link>
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 2. Здоровье команды */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="eNPS"
          value={health.enps.value == null ? "—" : (health.enps.value > 0 ? "+" : "") + health.enps.value}
          note="по последней кампании"
          series={health.enps.series}
          trend={health.enps.trend}
          delta={health.enps.delta}
          higherIsBetter
        />
        <MetricCard
          label="Вовлечённость"
          value={health.engagement.value == null ? "—" : String(health.engagement.value)}
          note="из 6 · UWES"
          series={health.engagement.series}
          trend={health.engagement.trend}
          delta={health.engagement.delta}
          higherIsBetter
        />
        <MetricCard
          label="Стресс"
          value={health.stress.value == null ? "—" : String(health.stress.value)}
          note="из 40 · PSS"
          series={health.stress.series}
          trend={health.stress.trend}
          delta={health.stress.delta}
          higherIsBetter={false}
        />
        <MetricCard
          label="Выгорание"
          value={String(health.burnout.count)}
          suffix="чел."
          note="высокое истощение"
          series={health.burnout.series}
          trend={null}
          delta={null}
          higherIsBetter={false}
        />
      </div>

      {/* 3 + 5 */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        {/* Срез по отделам */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[18px] font-bold">Срез по отделам</div>
              <Link href="/people" className="text-[13px] font-bold text-mk-text-emph hover:underline">
                Все отделы →
              </Link>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-secondary text-[13px] font-bold text-white">
                  <th className="rounded-l-[12px] px-3.5 py-2.5 text-left">Отдел</th>
                  <th className="px-3.5 py-2.5 text-center">Чел.</th>
                  <th className="px-3.5 py-2.5 text-center">Вовлечённость</th>
                  <th className="px-3.5 py-2.5 text-center">Стресс</th>
                  <th className="px-3.5 py-2.5 text-center">eNPS</th>
                  <th className="rounded-r-[12px] px-3.5 py-2.5 text-center">Алерты</th>
                </tr>
              </thead>
              <tbody>
                {depts.map((d) => (
                  <tr key={d.id} className="border-b border-[#EEF1F4] last:border-0 hover:bg-mk-bg">
                    <td className="px-3.5 py-3 text-[14px] font-bold">
                      <Link href={`/?dept=${d.id}`} className="hover:underline">
                        {d.name}
                      </Link>
                    </td>
                    <td className="px-3.5 py-3 text-center text-[14px]">{d.headcount}</td>
                    <td className="px-3.5 py-3 text-center">
                      <Pill zone={d.engagement.zone}>{d.engagement.value ?? "—"}</Pill>
                    </td>
                    <td className="px-3.5 py-3 text-center">
                      <Pill zone={d.stress.zone}>{d.stress.value ?? "—"}</Pill>
                    </td>
                    <td className="px-3.5 py-3 text-center">
                      {d.enps.hidden ? (
                        <Pill zone="none">мало данных</Pill>
                      ) : (
                        <Pill zone={d.enps.zone}>
                          {d.enps.value == null ? "—" : (d.enps.value > 0 ? "+" : "") + d.enps.value}
                        </Pill>
                      )}
                    </td>
                    <td
                      className={`px-3.5 py-3 text-center text-[14px] font-bold ${
                        d.alerts > 0 ? "text-mk-red" : ""
                      }`}
                    >
                      {d.alerts}
                    </td>
                  </tr>
                ))}
                {depts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3.5 py-6 text-center text-muted-foreground">
                      Нет данных по отделам
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="mt-3 text-[12px] text-muted-foreground">
              Отделы с менее чем 4 ответами по анонимному замеру скрыты для защиты анонимности.
            </div>
          </CardContent>
        </Card>

        {/* Прогресс замеров */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 text-[18px] font-bold">Прогресс замеров</div>
            <div className="flex flex-col gap-4">
              {progress.length === 0 ? (
                <p className="text-[14px] text-muted-foreground">Нет активных мониторинговых замеров.</p>
              ) : (
                progress.map((p) => (
                  <div key={p.code}>
                    <div className="mb-2 flex items-baseline justify-between">
                      <span className="text-[14px] font-bold">{p.title}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {p.deadline ? `до ${formatDate(p.deadline)}` : "без срока"}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-[6px] bg-mk-c1">
                      <div className="h-full rounded-[6px] bg-primary" style={{ width: `${p.pct}%` }} />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[12px]">
                      <span className="font-bold text-mk-text-emph">
                        {p.completed} из {p.total} прошли
                      </span>
                      <span className="text-muted-foreground">осталось {p.total - p.completed}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 4 + донат */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[18px] font-bold">
              Список риска
              <span className="ml-2 text-[14px] font-normal text-muted-foreground">
                с кем поговорить
              </span>
            </div>
          </div>
          {risk.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">Людей в зоне риска нет.</p>
          ) : (
            <div className="flex flex-col">
              {risk.map((r) => (
                <Link
                  key={r.id}
                  href={`/people/${r.id}`}
                  className="flex items-center gap-3 border-b border-[#EEF1F4] px-1 py-3 last:border-0 hover:rounded-[12px] hover:bg-mk-bg hover:px-2.5"
                >
                  <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-mk-c1 text-[14px] font-bold text-mk-text-emph">
                    {initials(r.name)}
                  </div>
                  <div>
                    <div className="text-[14px] font-bold">{r.name}</div>
                    <div className="text-[12px] text-muted-foreground">{r.department ?? "—"}</div>
                  </div>
                  <span
                    className={`ml-auto rounded-[10px] px-2.5 py-1 text-[12px] font-bold ${
                      r.level === "red" ? "bg-[#FCEEF0] text-mk-red" : "bg-[#FBF6E0] text-[#A98A00]"
                    }`}
                  >
                    {r.reason}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Распределение мотивации (донат) */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-4 text-[18px] font-bold">Распределение мотивации</div>
          <MotivationDonut slices={motivation} />
          <div className="mt-3 text-[12px] text-muted-foreground">
            По результатам теста Герчикова.
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

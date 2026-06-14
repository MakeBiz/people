import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { STATUS_RU, RULE_RU, formatDate, formatDateTime, deepLink } from "@/lib/utils";
import { createAssignment } from "../../actions";
import { DynamicsChart, type SeriesPoint } from "@/components/dynamics-chart";
import { CopyLink } from "@/components/copy-link";
import { AssignmentForm } from "@/components/assignment-form";
import { ManagerCard } from "@/components/manager-card";
import { buildManagerCard } from "@/lib/manager-card";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const DISCLAIMER =
  "Результаты тестов являются ориентиром для диалога и развития и не могут быть единственным основанием для кадровых решений.";

function buildSeries(
  results: { createdAt: Date; scores: unknown }[],
  alertDays: Set<string>
): SeriesPoint[] {
  return results
    .map((r) => {
      const total = (r.scores as Record<string, number>).total;
      return {
        date: formatDate(r.createdAt),
        value: typeof total === "number" ? total : 0,
        alert: alertDays.has(r.createdAt.toISOString().slice(0, 10)),
      };
    })
    .reverse();
}

export default async function PersonProfile({ params }: { params: { id: string } }) {
  const person = await prisma.person.findUnique({
    where: { id: params.id },
    include: {
      department: true,
      manager: true,
      results: { include: { test: true }, orderBy: { createdAt: "desc" } },
      assignments: { include: { test: true }, orderBy: { createdAt: "desc" } },
      alerts: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!person) notFound();

  // Доступ по ролям: manager видит только сотрудников своего отдела (раздел 5 спеки).
  const session = await auth();
  if (session?.user.role === "manager") {
    const viewer = session.user.personId
      ? await prisma.person.findUnique({ where: { id: session.user.personId } })
      : null;
    if (!viewer?.departmentId || viewer.departmentId !== person.departmentId) {
      return (
        <div className="space-y-4">
          <Link href="/people" className="text-sm text-primary hover:underline">
            ← Люди
          </Link>
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Нет доступа: вы можете просматривать профили только сотрудников своего отдела.
            </CardContent>
          </Card>
        </div>
      );
    }
  }

  const tests = await prisma.test.findMany({
    where: { isActive: true },
    orderBy: { title: "asc" },
  });
  const testIdByCode = Object.fromEntries(tests.map((t) => [t.code, t.id]));
  const managerCard = buildManagerCard(person.results, Date.now());
  const activeAlerts = person.alerts.filter((a) => a.status !== "resolved");

  // ИИ-профиль (последний снимок анамнеза) + метрики прохождения (раздел 5 спеки)
  const llmProfile = await prisma.personProfile.findFirst({
    where: { personId: person.id },
    orderBy: { version: "desc" },
  });
  const allSessions = await prisma.session.findMany({
    where: { assignment: { personId: person.id }, finishedAt: { not: null } },
    include: { assignment: { include: { test: true } }, result: true },
    orderBy: { startedAt: "desc" },
  });
  // последняя сессия по каждому тесту
  const metricRows = [...new Map(allSessions.map((s) => [s.assignment.testId, s])).values()];
  const testOptions = tests.map((t) => ({
    id: t.id,
    title: t.title,
    defaultAnonymous: (t.content as { default_anonymous?: boolean }).default_anonymous === true,
  }));

  const alertDays = new Set(person.alerts.map((a) => a.createdAt.toISOString().slice(0, 10)));
  const uwes = buildSeries(
    person.results.filter((r) => r.test.code === "uwes9"),
    alertDays
  );
  const pss = buildSeries(
    person.results.filter((r) => r.test.code === "pss10"),
    alertDays
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/people" className="hover:underline">
          Люди
        </Link>
        <span>/</span>
        <span>{person.fullName}</span>
      </div>

      {/* Карточка */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold">{person.fullName}</h1>
            <Link
              href={`/print/people/${person.id}`}
              target="_blank"
              className="shrink-0 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              📄 PDF-карточка
            </Link>
          </div>
          <p className="text-muted-foreground">
            {person.position ?? "—"} · {person.department?.name ?? "без отдела"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="slate">{STATUS_RU[person.status] ?? person.status}</Badge>
            {person.manager && (
              <Badge variant="slate">Руководитель: {person.manager.fullName}</Badge>
            )}
            <Badge variant="slate">
              Telegram: {person.telegramId ? "привязан ✓" : "не привязан"}
            </Badge>
            <Badge variant="slate">
              Согласие ПДн: {person.consentGivenAt ? formatDate(person.consentGivenAt) : "нет"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* ИИ-профиль руководителю (промт 2, накопительный анамнез) */}
      {llmProfile && (
        <Card className="border-primary/30">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">🤖 Профиль для руководителя (ИИ-сводка)</CardTitle>
            <span className="text-xs text-muted-foreground">
              v{llmProfile.version} · {formatDate(llmProfile.generatedAt)} · по {llmProfile.basedOnResultIds.length} тест(ам)
            </span>
          </CardHeader>
          <CardContent>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {llmProfile.managerText}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Карточка «Как работать с сотрудником» — слотовая сводка профильных тестов */}
      <ManagerCard
        data={managerCard}
        personId={person.id}
        testIdByCode={testIdByCode}
        alerts={activeAlerts}
      />

      {/* Метрики прохождения — контекст достоверности, НЕ оценка человека (раздел 5 спеки) */}
      {metricRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Метрики прохождения</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Тест</TableHead>
                  <TableHead>Длительность</TableHead>
                  <TableHead>Ср. на вопрос</TableHead>
                  <TableHead>Возвраты</TableHead>
                  <TableHead>Валидность</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metricRows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.assignment.test.title}</TableCell>
                    <TableCell>{s.durationSeconds != null ? `${Math.round(s.durationSeconds / 60)} мин` : "—"}</TableCell>
                    <TableCell>{s.avgResponseMs != null ? `${(s.avgResponseMs / 1000).toFixed(1)} с` : "—"}</TableCell>
                    <TableCell>{s.resumeCount}</TableCell>
                    <TableCell>
                      {s.result?.validityFlag && s.result.validityFlag !== "ok" ? (
                        <Badge variant="yellow">⚠ {s.result.validityFlag}</Badge>
                      ) : (
                        <Badge variant="green">ok</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground/70">
              Метрики — это контекст достоверности результата, а не оценка человека. Слишком
              быстрое + однообразное прохождение → результат под вопросом; долгое с возвратами →
              вдумчивость или сомнения. Не делайте выводов о личности по скорости.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Назначить тест */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Назначить тест</CardTitle>
        </CardHeader>
        <CardContent>
          <AssignmentForm action={createAssignment} tests={testOptions} fixedPersonId={person.id} />
        </CardContent>
      </Card>

      {/* Графики динамики */}
      {(uwes.length > 0 || pss.length > 0) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {uwes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Вовлечённость (UWES), 0–6</CardTitle>
              </CardHeader>
              <CardContent>
                <DynamicsChart data={uwes} color="#013CA4" domain={[0, 6]} />
              </CardContent>
            </Card>
          )}
          {pss.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Стресс (PSS-10), 0–40</CardTitle>
              </CardHeader>
              <CardContent>
                <DynamicsChart data={pss} color="#C51929" domain={[0, 40]} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Алерты */}
      {person.alerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Алерты</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Уровень</TableHead>
                  <TableHead>Правило</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Когда</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {person.alerts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.level === "red" ? "🔴" : "🟡"}</TableCell>
                    <TableCell>{RULE_RU[a.ruleCode] ?? a.ruleCode}</TableCell>
                    <TableCell>{STATUS_RU[a.status] ?? a.status}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(a.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* История результатов */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">История тестов</CardTitle>
        </CardHeader>
        <CardContent>
          {person.results.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пройденных тестов пока нет.</p>
          ) : (
            <div className="space-y-4">
              {person.results.map((r) => {
                const scores = r.scores as Record<string, number>;
                const interp = (r.interpretation as Array<{ text: string }>) ?? [];
                return (
                  <div key={r.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{r.test.title}</div>
                      <div className="text-sm text-muted-foreground">{formatDate(r.createdAt)}</div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {Object.entries(scores).map(([k, v]) => (
                        <Badge key={k} variant="blue">
                          {k}: {v}
                        </Badge>
                      ))}
                      {r.validityFlag && r.validityFlag !== "ok" && (
                        <Badge variant="yellow">⚠ {r.validityFlag}</Badge>
                      )}
                    </div>
                    {interp.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                        {interp.map((i, idx) => (
                          <li key={idx}>{i.text}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Назначения и ссылки */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Назначения и ссылки-приглашения</CardTitle>
        </CardHeader>
        <CardContent>
          {person.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Назначений нет.</p>
          ) : (
            <div className="space-y-3">
              {person.assignments.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0"
                >
                  <div>
                    <div className="font-medium">
                      {a.test.title}
                      {a.isAnonymous && (
                        <Badge variant="slate" className="ml-2">
                          🕶️ анонимно
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {STATUS_RU[a.status] ?? a.status}
                      {a.deadline ? ` · до ${formatDate(a.deadline)}` : ""}
                    </div>
                  </div>
                  {a.status !== "completed" && <CopyLink url={deepLink(a.inviteToken)} />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground/70">{DISCLAIMER}</p>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { buildManagerCard } from "@/lib/manager-card";
import { STATUS_RU, formatDate } from "@/lib/utils";
import { MakeBizLogo } from "@/components/logo";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

const DISCLAIMER =
  "Результаты тестов являются ориентиром для диалога и развития и не могут быть единственным основанием для кадровых решений.";

const TREND_ARROW: Record<string, string> = { up: "▲", down: "▼", flat: "→" };

export default async function PersonPrintCard({ params }: { params: { id: string } }) {
  const person = await prisma.person.findUnique({
    where: { id: params.id },
    include: {
      department: true,
      manager: true,
      results: { include: { test: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!person) notFound();

  // Доступ по ролям: manager — только сотрудники своего отдела.
  const session = await auth();
  if (session?.user.role === "manager") {
    const viewer = session.user.personId
      ? await prisma.person.findUnique({ where: { id: session.user.personId } })
      : null;
    if (!viewer?.departmentId || viewer.departmentId !== person.departmentId) {
      return (
        <p className="text-sm text-muted-foreground">
          Нет доступа: карточка доступна только для сотрудников вашего отдела.
        </p>
      );
    }
  }

  const card = buildManagerCard(person.results, Date.now());
  const llmProfile = await prisma.personProfile.findFirst({
    where: { personId: person.id },
    orderBy: { version: "desc" },
  });

  return (
    <article className="space-y-6 text-[13px] leading-relaxed">
      {/* Панель действий — только на экране, при печати скрыта */}
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/people/${person.id}`} className="text-sm text-primary hover:underline">
          ← К профилю
        </Link>
        <PrintButton />
      </div>

      {/* Шапка документа */}
      <header className="flex items-start justify-between border-b border-mk-border pb-4">
        <div>
          <h1 className="text-xl font-bold">{person.fullName}</h1>
          <p className="text-muted-foreground">
            {person.position ?? "—"} · {person.department?.name ?? "без отдела"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {STATUS_RU[person.status] ?? person.status}
            {person.manager ? ` · руководитель: ${person.manager.fullName}` : ""}
          </p>
        </div>
        <div className="text-right">
          <MakeBizLogo className="ml-auto h-7 w-auto" />
          <p className="mt-2 text-xs text-muted-foreground">
            Карточка сотрудника
            <br />
            сформирована {formatDate(new Date())}
          </p>
        </div>
      </header>

      {!card.anyData && !llmProfile && (
        <p className="text-muted-foreground">
          По сотруднику ещё нет пройденных профильных тестов — карточка пуста.
        </p>
      )}

      {/* ИИ-сводка для руководителя */}
      {llmProfile && (
        <section>
          <h2 className="mb-1 text-sm font-bold text-primary">Профиль для руководителя (ИИ-сводка)</h2>
          <p className="whitespace-pre-wrap text-foreground/90">{llmProfile.managerText}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            v{llmProfile.version} · {formatDate(llmProfile.generatedAt)} · по {llmProfile.basedOnResultIds.length} тест(ам)
          </p>
        </section>
      )}

      {/* Краткий портрет */}
      {card.portrait && (
        <section>
          <h2 className="mb-1 text-sm font-bold">Краткий портрет</h2>
          <p>{card.portrait}</p>
        </section>
      )}

      {/* Напряжения */}
      {card.tensions.length > 0 && (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <h2 className="mb-1 text-sm font-bold text-amber-800">Зоны внимания</h2>
          <ul className="list-disc space-y-0.5 pl-5">
            {card.tensions.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Слоты «Как работать с сотрудником» */}
      {card.slots
        .filter((s) => s.items.length > 0)
        .map((slot) => (
          <section key={slot.id} className="break-inside-avoid">
            <h2 className="mb-1 text-sm font-bold">{slot.title}</h2>
            <ul className="space-y-1">
              {slot.items.map((it, i) => (
                <li key={i}>
                  {it.label && <span className="font-semibold">{it.label}: </span>}
                  {it.text}
                  <span className="text-[11px] text-muted-foreground">
                    {" "}
                    ({it.source}
                    {it.date ? `, ${it.date}` : ""}
                    {it.stale ? ", устарело" : ""})
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

      {/* Мониторинг состояния */}
      {card.monitoring.length > 0 && (
        <section className="break-inside-avoid">
          <h2 className="mb-1 text-sm font-bold">Мониторинг состояния</h2>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-mk-border text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Показатель</th>
                <th className="py-1 pr-3 font-medium">Значение</th>
                <th className="py-1 pr-3 font-medium">Динамика</th>
                <th className="py-1 font-medium">Замер</th>
              </tr>
            </thead>
            <tbody>
              {card.monitoring.map((m) => (
                <tr key={m.code} className="border-b border-mk-border/60 last:border-0">
                  <td className="py-1 pr-3">{m.label}</td>
                  <td className="py-1 pr-3 font-semibold">{m.value}</td>
                  <td className="py-1 pr-3">
                    {m.trend ? (
                      <span className={m.worse ? "font-bold text-mk-red" : "text-mk-green"}>
                        {TREND_ARROW[m.trend]}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-1 text-muted-foreground">{m.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="border-t border-mk-border pt-3 text-[11px] text-muted-foreground">
        {DISCLAIMER}
      </footer>
    </article>
  );
}

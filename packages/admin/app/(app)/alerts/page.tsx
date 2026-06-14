import Link from "next/link";
import { prisma } from "@/lib/db";
import { getScope } from "@/lib/access";
import { NoAccess } from "@/components/no-access";
import { RULE_RU, STATUS_RU, formatDateTime } from "@/lib/utils";
import { acknowledgeAlert, resolveAlert } from "../actions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const scope = await getScope();
  if (scope.blocked) {
    return (
      <NoAccess message="Ваша учётная запись менеджера не привязана к отделу. Обратитесь к администратору." />
    );
  }

  const where: Record<string, unknown> =
    searchParams.status === "all" ? {} : { status: { not: "resolved" } };
  // manager видит алерты только своего отдела (по человеку или системные на отдел).
  if (scope.deptFilter) {
    where.OR = [
      { person: { departmentId: scope.deptFilter } },
      { departmentId: scope.deptFilter },
    ];
  }

  const alerts = await prisma.alert.findMany({
    where,
    include: { person: true, acknowledgedByUser: true },
    orderBy: [{ level: "asc" }, { createdAt: "desc" }],
    take: 300,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Алерты</h1>
        <div className="flex gap-2 text-sm">
          <FilterPill label="Активные" href="/alerts" active={searchParams.status !== "all"} />
          <FilterPill label="Все" href="/alerts?status=all" active={searchParams.status === "all"} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Уровень</TableHead>
                <TableHead>Правило</TableHead>
                <TableHead>Сотрудник</TableHead>
                <TableHead>Детали</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Когда</TableHead>
                <TableHead>Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((a) => {
                const details = a.details as Record<string, unknown>;
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Badge variant={a.level === "red" ? "red" : "yellow"}>
                        {a.level === "red" ? "🔴 red" : "🟡 yellow"}
                      </Badge>
                    </TableCell>
                    <TableCell>{RULE_RU[a.ruleCode] ?? a.ruleCode}</TableCell>
                    <TableCell>
                      {a.person ? (
                        <Link
                          href={`/people/${a.person.id}`}
                          className="text-primary hover:underline"
                        >
                          {a.person.fullName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="max-w-[240px] text-xs text-muted-foreground">
                      {Object.entries(details)
                        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                        .join(", ")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="slate">{STATUS_RU[a.status] ?? a.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(a.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {a.status === "new" && (
                          <form action={acknowledgeAlert}>
                            <input type="hidden" name="id" value={a.id} />
                            <Button variant="outline" size="sm">
                              Взять
                            </Button>
                          </form>
                        )}
                        {a.status !== "resolved" && (
                          <form action={resolveAlert}>
                            <input type="hidden" name="id" value={a.id} />
                            <Button size="sm">Решить</Button>
                          </form>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {alerts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Алертов нет
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterPill({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 ${
        active ? "bg-primary text-primary-foreground" : "border bg-background hover:bg-accent"
      }`}
    >
      {label}
    </Link>
  );
}

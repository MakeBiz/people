import Link from "next/link";
import { prisma } from "@/lib/db";
import { STATUS_RU, formatDate } from "@/lib/utils";
import { createPerson } from "../actions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: { status?: string; dept?: string };
}) {
  const where: Record<string, unknown> = {};
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.dept) where.departmentId = searchParams.dept;

  const [people, departments, managers, openAlerts] = await Promise.all([
    prisma.person.findMany({
      where,
      include: {
        department: true,
        results: { orderBy: { createdAt: "desc" }, take: 1, include: { test: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.person.findMany({ orderBy: { fullName: "asc" } }),
    prisma.alert.groupBy({
      by: ["personId"],
      where: { status: { not: "resolved" } },
      _count: true,
    }),
  ]);

  const alertByPerson = new Map(openAlerts.map((a) => [a.personId, a._count]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Люди</h1>

      {/* Форма добавления */}
      <Card>
        <CardContent className="p-4">
          <details>
            <summary className="cursor-pointer font-semibold">+ Добавить человека</summary>
            <form action={createPerson} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>ФИО *</Label>
                <Input name="fullName" required />
              </div>
              <div className="space-y-1.5">
                <Label>Статус</Label>
                <Select name="status" defaultValue="candidate">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="candidate">Кандидат</SelectItem>
                    <SelectItem value="employee">Сотрудник</SelectItem>
                    <SelectItem value="archived">Архив</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Должность</Label>
                <Input name="position" />
              </div>
              <div className="space-y-1.5">
                <Label>Подразделение</Label>
                <Select name="departmentId" defaultValue="none">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Руководитель</Label>
                <Select name="managerId" defaultValue="none">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {managers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button type="submit">Добавить</Button>
              </div>
            </form>
          </details>
        </CardContent>
      </Card>

      {/* Фильтры */}
      <div className="flex flex-wrap gap-2">
        <FilterLink label="Все" href="/people" active={!searchParams.status} />
        <FilterLink label="Кандидаты" href="/people?status=candidate" active={searchParams.status === "candidate"} />
        <FilterLink label="Сотрудники" href="/people?status=employee" active={searchParams.status === "employee"} />
        <FilterLink label="Архив" href="/people?status=archived" active={searchParams.status === "archived"} />
      </div>

      {/* Таблица */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ФИО</TableHead>
                <TableHead>Отдел</TableHead>
                <TableHead>Должность</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Последний тест</TableHead>
                <TableHead>Флаги</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => {
                const last = p.results[0];
                const alerts = alertByPerson.get(p.id) ?? 0;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        href={`/people/${p.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {p.fullName}
                      </Link>
                    </TableCell>
                    <TableCell>{p.department?.name ?? "—"}</TableCell>
                    <TableCell>{p.position ?? "—"}</TableCell>
                    <TableCell>{STATUS_RU[p.status] ?? p.status}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {last ? `${last.test.title} · ${formatDate(last.createdAt)}` : "—"}
                    </TableCell>
                    <TableCell className="space-x-1">
                      {alerts > 0 && <Badge variant="red">🚨 {alerts}</Badge>}
                      {last?.validityFlag && last.validityFlag !== "ok" && (
                        <Badge variant="yellow">⚠ {last.validityFlag}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {people.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Нет людей
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

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-sm ${
        active
          ? "bg-primary text-primary-foreground"
          : "border bg-background text-muted-foreground hover:bg-accent"
      }`}
    >
      {label}
    </Link>
  );
}

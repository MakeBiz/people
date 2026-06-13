import Link from "next/link";
import { prisma } from "@/lib/db";
import { STATUS_RU, formatDate, formatDateTime, deepLink } from "@/lib/utils";
import { createAssignment } from "../actions";
import { CopyLink } from "@/components/copy-link";
import { AssignmentForm } from "@/components/assignment-form";
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

export default async function AssignmentsPage() {
  const [assignments, people, tests] = await Promise.all([
    prisma.assignment.findMany({
      include: { person: true, test: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.person.findMany({
      where: { status: { not: "archived" } },
      orderBy: { fullName: "asc" },
    }),
    prisma.test.findMany({ where: { isActive: true }, orderBy: { title: "asc" } }),
  ]);

  const testOptions = tests.map((t) => ({
    id: t.id,
    title: t.title,
    defaultAnonymous: (t.content as { default_anonymous?: boolean }).default_anonymous === true,
  }));
  const peopleOptions = people.map((p) => ({ id: p.id, name: p.fullName }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Назначения</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Назначить тест</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <AssignmentForm action={createAssignment} tests={testOptions} people={peopleOptions} />
          <p className="text-xs text-muted-foreground">
            Чекбокс «анонимно» предзаполняется из default_anonymous теста. Автонапоминания и
            кампании по расписанию — в Этапе 2.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Человек</TableHead>
                <TableHead>Тест</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Аноним.</TableHead>
                <TableHead>Дедлайн</TableHead>
                <TableHead>Создано</TableHead>
                <TableHead>Ссылка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {a.person ? (
                      <Link
                        href={`/people/${a.person.id}`}
                        className="text-primary hover:underline"
                      >
                        {a.person.fullName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">аноним</span>
                    )}
                  </TableCell>
                  <TableCell>{a.test.title}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        a.status === "completed"
                          ? "green"
                          : a.status === "in_progress"
                            ? "blue"
                            : "slate"
                      }
                    >
                      {STATUS_RU[a.status] ?? a.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{a.isAnonymous ? "🕶️" : "—"}</TableCell>
                  <TableCell>{formatDate(a.deadline)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(a.createdAt)}
                  </TableCell>
                  <TableCell>
                    {a.status !== "completed" ? (
                      <CopyLink url={deepLink(a.inviteToken)} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {assignments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Назначений пока нет
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

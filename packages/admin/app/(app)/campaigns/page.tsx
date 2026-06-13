import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { createCampaign, toggleCampaign, runCampaignNow, deleteCampaign } from "../actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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

const SCHEDULE_RU: Record<string, string> = {
  monthly: "Ежемесячно",
  quarterly: "Квартально",
  semiannual: "Раз в полгода",
  annual: "Ежегодно",
};

export default async function CampaignsPage() {
  const [campaigns, tests, departments] = await Promise.all([
    prisma.campaign.findMany({
      include: { test: true, department: true },
      orderBy: { createdAt: "desc" },
    }),
    // Кампании запускают мониторинговые тесты
    prisma.test.findMany({ where: { category: "monitoring", isActive: true }, orderBy: { title: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Прогресс по тесту кампании: сколько назначений завершено
  const counts = await prisma.assignment.groupBy({
    by: ["testId", "status"],
    _count: true,
  });
  const progressFor = (testId: string) => {
    const rows = counts.filter((c) => c.testId === testId);
    const total = rows.reduce((s, r) => s + r._count, 0);
    const done = rows.filter((r) => r.status === "completed").reduce((s, r) => s + r._count, 0);
    return { done, total };
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Кампании мониторинга</h1>
      <p className="text-sm text-muted-foreground">
        Периодическое автоназначение мониторинговых тестов и авторассылка приглашений в Telegram.
        Исполняет планировщик в боте (тик раз в ~5 минут). «Запустить сейчас» применится в пределах тика.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Новая кампания</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createCampaign} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] space-y-1.5">
              <Label>Тест</Label>
              <Select name="testId" defaultValue={tests[0]?.id}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите" />
                </SelectTrigger>
                <SelectContent>
                  {tests.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[160px] space-y-1.5">
              <Label>Периодичность</Label>
              <Select name="schedule" defaultValue="quarterly">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SCHEDULE_RU).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[180px] space-y-1.5">
              <Label>Кому</Label>
              <Select name="departmentId" defaultValue="none">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Вся компания</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Первый запуск</Label>
              <input
                type="datetime-local"
                name="startDate"
                className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="anonymous" className="h-4 w-4 rounded border-input" />
              Анонимно
            </label>
            <Button type="submit">Создать кампанию</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Тест</TableHead>
                <TableHead>Периодичность</TableHead>
                <TableHead>Кому</TableHead>
                <TableHead>Аноним.</TableHead>
                <TableHead>След. запуск</TableHead>
                <TableHead>Прогресс</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => {
                const pr = progressFor(c.testId);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.test.title}</TableCell>
                    <TableCell>{SCHEDULE_RU[c.schedule] ?? c.schedule}</TableCell>
                    <TableCell>{c.department?.name ?? "Вся компания"}</TableCell>
                    <TableCell>{c.isAnonymous ? "🕶️" : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(c.nextRunAt)}</TableCell>
                    <TableCell>
                      {pr.total > 0 ? (
                        <span className="text-sm">
                          {pr.done} / {pr.total}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {c.isActive ? (
                        <Badge variant="green">активна</Badge>
                      ) : (
                        <Badge variant="slate">на паузе</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <form action={runCampaignNow}>
                          <input type="hidden" name="id" value={c.id} />
                          <Button variant="outline" size="sm">
                            Запустить
                          </Button>
                        </form>
                        <form action={toggleCampaign}>
                          <input type="hidden" name="id" value={c.id} />
                          <Button variant="outline" size="sm">
                            {c.isActive ? "Пауза" : "Включить"}
                          </Button>
                        </form>
                        <form action={deleteCampaign}>
                          <input type="hidden" name="id" value={c.id} />
                          <Button variant="outline" size="sm">
                            Удалить
                          </Button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    Кампаний пока нет. Создайте первую — мониторинг пойдёт по расписанию сам.
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

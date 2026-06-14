import { prisma } from "@/lib/db";
import type { TestContent } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { TestEditor } from "@/components/test-editor";
import { toggleTest } from "@/app/(app)/actions";
import { getScope, isPrivileged } from "@/lib/access";
import { NoAccess } from "@/components/no-access";

export const dynamic = "force-dynamic";

const CATEGORY_RU: Record<string, string> = {
  candidate: "Кандидат",
  typing: "Типирование",
  deep: "Глубокий анализ",
  monitoring: "Мониторинг",
};

export default async function TestsPage() {
  const scope = await getScope();
  if (!isPrivileged(scope.role)) return <NoAccess />;

  const tests = await prisma.test.findMany({ orderBy: { category: "asc" } });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Тесты</h1>
      <p className="text-sm text-muted-foreground">
        Тесты — это данные: тест целиком описан JSON. Загрузите новый или отредактируйте
        существующий — перед сохранением JSON проверяется по схеме, версия увеличивается
        автоматически. Бот всегда берёт активную версию.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Новый тест (загрузить JSON)</CardTitle>
        </CardHeader>
        <CardContent>
          <TestEditor submitLabel="Создать тест" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Код</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Категория</TableHead>
                <TableHead>Вопросов</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Алертов</TableHead>
                <TableHead>Аноним.</TableHead>
                <TableHead>~мин</TableHead>
                <TableHead>Версия</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map((t) => {
                const content = t.content as unknown as TestContent;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.code}</TableCell>
                    <TableCell className="font-medium">{t.title}</TableCell>
                    <TableCell>{CATEGORY_RU[t.category] ?? t.category}</TableCell>
                    <TableCell>{content.questions?.length ?? 0}</TableCell>
                    <TableCell className="text-xs">{content.question_type}</TableCell>
                    <TableCell>{content.alert_rules?.length ?? 0}</TableCell>
                    <TableCell>{content.default_anonymous ? "🕶️" : "—"}</TableCell>
                    <TableCell>{t.estimatedMinutes ?? "—"}</TableCell>
                    <TableCell>{t.version}</TableCell>
                    <TableCell>
                      <form action={toggleTest} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={t.id} />
                        {t.isActive ? (
                          <Badge variant="green">да</Badge>
                        ) : (
                          <Badge variant="slate">нет</Badge>
                        )}
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                        >
                          {t.isActive ? "Выключить" : "Включить"}
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                );
              })}
              {tests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground">
                    Тесты не загружены. Запустите сид: <code>npm run db:seed</code>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Редактировать существующий</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tests.map((t) => (
            <details key={t.id} className="rounded-md border border-border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                {" — "}
                {t.title}{" "}
                <span className="text-xs text-muted-foreground">(v{t.version})</span>
              </summary>
              <div className="border-t border-border p-4">
                <TestEditor
                  initialJson={JSON.stringify(t.content, null, 2)}
                  initialCategory={t.category}
                  submitLabel="Сохранить изменения"
                />
              </div>
            </details>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

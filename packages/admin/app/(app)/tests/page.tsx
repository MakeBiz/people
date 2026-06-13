import { prisma } from "@/lib/db";
import type { TestContent } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
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

const CATEGORY_RU: Record<string, string> = {
  candidate: "Кандидат",
  typing: "Типирование",
  deep: "Глубокий анализ",
  monitoring: "Мониторинг",
};

export default async function TestsPage() {
  const tests = await prisma.test.findMany({ orderBy: { category: "asc" } });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Тесты</h1>
      <p className="text-sm text-muted-foreground">
        Тесты — это данные. Загрузка/редактирование JSON и предпросмотр вопросов появятся в Этапе 2.
        Сейчас контент загружается сидом из папки <code>/content</code>.
      </p>

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
                <TableHead>Активен</TableHead>
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
                      {t.isActive ? (
                        <Badge variant="green">да</Badge>
                      ) : (
                        <Badge variant="slate">нет</Badge>
                      )}
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
    </div>
  );
}

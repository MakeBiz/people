import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { createDepartment } from "../actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default async function SettingsPage() {
  const session = await auth();
  const isOwner = session?.user.role === "owner";

  const [admins, departments] = await Promise.all([
    prisma.adminUser.findMany({ include: { person: true }, orderBy: { createdAt: "asc" } }),
    prisma.department.findMany({ include: { parent: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Настройки</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Подразделения</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={createDepartment} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] space-y-1.5">
              <Label>Название</Label>
              <Input name="name" required />
            </div>
            <div className="min-w-[200px] space-y-1.5">
              <Label>Родительское (опц.)</Label>
              <Select name="parentId" defaultValue="none">
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
            <Button type="submit">Добавить</Button>
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Родитель</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.name}</TableCell>
                  <TableCell className="text-muted-foreground">{d.parent?.name ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Пользователи админки</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Связь с сотрудником</TableHead>
                <TableHead>Создан</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.email}</TableCell>
                  <TableCell>
                    <Badge variant="slate">{a.role}</Badge>
                  </TableCell>
                  <TableCell>{a.person?.fullName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(a.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            {isOwner
              ? "Управление пользователями (создание/роли), редактор текста согласия ПДн и привязка Telegram-уведомлений — расширяется в Этапе 2."
              : "Управление пользователями доступно только роли owner."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

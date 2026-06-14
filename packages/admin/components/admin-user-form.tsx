"use client";

import { useFormState } from "react-dom";
import { createAdminUser, type AdminUserFormState } from "@/app/(app)/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AdminUserForm({
  people,
}: {
  people: { id: string; name: string; dept: string | null }[];
}) {
  const [state, formAction] = useFormState(createAdminUser, {} as AdminUserFormState);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] space-y-1.5">
          <Label>Email</Label>
          <Input name="email" type="email" required />
        </div>
        <div className="min-w-[160px] space-y-1.5">
          <Label>Пароль</Label>
          <Input name="password" type="password" required minLength={8} />
        </div>
        <div className="min-w-[140px] space-y-1.5">
          <Label>Роль</Label>
          <Select name="role" defaultValue="manager">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hr">HR (вся компания)</SelectItem>
              <SelectItem value="manager">Менеджер (свой отдел)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[220px] space-y-1.5">
          <Label>Сотрудник (для менеджера)</Label>
          <Select name="personId" defaultValue="none">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— не связывать</SelectItem>
              {people.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.dept ? ` · ${p.dept}` : " · без отдела"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit">Создать</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Менеджер видит только сотрудников, назначения и алерты отдела привязанного сотрудника.
        HR и owner видят всю компанию.
      </p>
      {state.error && <p className="text-xs font-bold text-mk-red">{state.error}</p>}
      {state.message && <p className="text-xs font-bold text-mk-green">✓ {state.message}</p>}
    </form>
  );
}

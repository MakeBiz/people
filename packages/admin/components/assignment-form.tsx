"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface TestOption {
  id: string;
  title: string;
  defaultAnonymous: boolean;
}

export function AssignmentForm({
  action,
  tests,
  people,
  fixedPersonId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  tests: TestOption[];
  people?: { id: string; name: string }[];
  fixedPersonId?: string;
}) {
  const [testId, setTestId] = useState(tests[0]?.id ?? "");
  const selected = tests.find((t) => t.id === testId);
  const [anonymous, setAnonymous] = useState(tests[0]?.defaultAnonymous ?? false);

  function onTestChange(id: string) {
    setTestId(id);
    // Анонимность подставляется из default_anonymous выбранного теста (data-driven)
    const t = tests.find((x) => x.id === id);
    setAnonymous(t?.defaultAnonymous ?? false);
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      {fixedPersonId ? (
        <input type="hidden" name="personId" value={fixedPersonId} />
      ) : (
        <div className="min-w-[220px]">
          <Label className="mb-1 block">Человек</Label>
          <Select name="personId" defaultValue={people?.[0]?.id}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите" />
            </SelectTrigger>
            <SelectContent>
              {people?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="min-w-[200px]">
        <Label className="mb-1 block">Тест</Label>
        <Select name="testId" value={testId} onValueChange={onTestChange}>
          <SelectTrigger>
            <SelectValue placeholder="Выберите тест" />
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

      <div>
        <Label className="mb-1 block">Дедлайн (опц.)</Label>
        <Input type="date" name="deadline" className="w-[160px]" />
      </div>

      <label className="flex h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="anonymous"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        Анонимно
        {selected?.defaultAnonymous && (
          <span className="text-xs text-muted-foreground">(по умолч. для теста)</span>
        )}
      </label>

      <Button type="submit">Назначить и создать ссылку</Button>
    </form>
  );
}

"use client";

import { useFormState } from "react-dom";
import { upsertTestFromJson, type TestFormState } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CATEGORIES: Record<string, string> = {
  candidate: "Кандидат",
  typing: "Типирование",
  deep: "Глубокий анализ",
  monitoring: "Мониторинг",
};

export function TestEditor({
  initialJson = "",
  initialCategory = "monitoring",
  submitLabel = "Сохранить тест",
}: {
  initialJson?: string;
  initialCategory?: string;
  submitLabel?: string;
}) {
  const [state, formAction] = useFormState(upsertTestFromJson, {} as TestFormState);

  return (
    <form action={formAction} className="space-y-3">
      <textarea
        name="json"
        defaultValue={initialJson}
        rows={initialJson ? 16 : 10}
        spellCheck={false}
        placeholder={'{\n  "code": "my_test",\n  "title": "...",\n  "question_type": "likert",\n  "questions": [...],\n  "scoring": { "method": "scale_mean", ... },\n  "interpretations": [...]\n}'}
        className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:border-primary focus:ring-1 focus:ring-primary"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-xs">Категория (если нет в JSON)</Label>
        <Select name="category" defaultValue={initialCategory}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit">{submitLabel}</Button>
      </div>
      {state.error && (
        <pre className="whitespace-pre-wrap rounded-md bg-[#FCEEF0] p-3 text-xs text-mk-red">
          {state.error}
        </pre>
      )}
      {state.message && <p className="text-xs font-bold text-mk-green">✓ {state.message}</p>}
    </form>
  );
}

"use client";

import { Button } from "@/components/ui/button";

// Кнопка печати: вызывает системный диалог печати, где можно «Сохранить как PDF».
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      Печать / Сохранить как PDF
    </Button>
  );
}

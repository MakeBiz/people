import { Card, CardContent } from "@/components/ui/card";

export function NoAccess({
  message = "Недостаточно прав для просмотра этого раздела.",
}: {
  message?: string;
}) {
  return (
    <Card>
      <CardContent className="p-6 text-sm text-muted-foreground">{message}</CardContent>
    </Card>
  );
}

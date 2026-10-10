import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <Card className="mx-auto mt-6 max-w-md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{message} The API answers at /api once the contracts are deployed; until then the desk is empty.</CardDescription>
      </CardHeader>
    </Card>
  );
}

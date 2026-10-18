import { PageHeader, Card } from "@/components/ui";

export function ComingSoon({ title, phase, children }: { title: string; phase: number; children: React.ReactNode }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <p className="text-xs font-semibold tracking-wide text-brand uppercase">Arrives in Phase {phase}</p>
        <div className="mt-2 text-sm text-muted">{children}</div>
      </Card>
    </>
  );
}

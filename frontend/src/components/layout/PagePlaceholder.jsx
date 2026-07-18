export function PagePlaceholder({ title }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="mt-1 text-sm">Screen not yet implemented.</p>
    </div>
  );
}

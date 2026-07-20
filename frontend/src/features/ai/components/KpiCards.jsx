// Pure presentation: renders the backend AI Experience Layer's already-
// computed keyMetrics ({ label, value }[]) as a compact card row. No
// shape detection or data prep happens here — that's sectionBuilder.js
// on the backend (docs/architecture/AI-Style-Guide.md's Key Metrics
// section) and useAskAgent/useToolInvoke on the frontend.
export function KpiCards({ metrics }) {
  if (!metrics || metrics.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm"
        >
          <div className="text-xs text-muted-foreground">{metric.label}</div>
          <div className="mt-0.5 text-base font-semibold text-foreground">{metric.value}</div>
        </div>
      ))}
    </div>
  );
}

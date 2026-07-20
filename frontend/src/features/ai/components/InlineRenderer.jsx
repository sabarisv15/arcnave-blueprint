import { Component } from 'react';
import { KpiCards } from '@/features/ai/components/KpiCards';
import { DataTable } from '@/features/ai/components/DataTable';

// InlineRenderer is the single rendering gateway for structured AI
// responses. It is purely presentational: it receives the backend AI
// Experience Layer's already-computed `presentation.sections` (see
// backend/src/services/aiExperience/sectionBuilder.js) plus the raw
// tool data (used only for entity-link resolution, never re-derived
// here) and picks a small strategy per section — no API calls, no
// routing lookups beyond lib/entityRoutes.js, no state mutation, no
// business logic. New strategies can be added later (e.g. a timeline,
// once a real tool result needs one) without MessageDocument or the
// conversation logic changing.
//
// Each strategy is fault-tolerant on its own: a thrown error here must
// never take down the assistant's response, only this one section.
class RenderBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function DefinitionList({ items }) {
  // sectionBuilder.js's buildListFromObject produces "Label: value"
  // strings for a single-entity result — split back into a dense
  // two-column definition list instead of a plain bullet list.
  const pairs = items.map((item) => {
    const idx = item.indexOf(': ');
    return idx === -1 ? [item, null] : [item.slice(0, idx), item.slice(idx + 2)];
  });
  const allPaired = pairs.every(([, value]) => value !== null);

  if (!allPaired) {
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    );
  }

  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
      {pairs.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm sm:flex-col sm:justify-start">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function BulletList({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

export function InlineRenderer({ sections, rawData, toolUsed }) {
  if (!sections) return null;

  const rawRecords = Array.isArray(rawData) ? rawData : null;
  const hasKeyMetrics = sections.keyMetrics && sections.keyMetrics.length > 0;
  const details = sections.details;

  if (!hasKeyMetrics && !details && (!sections.insights || sections.insights.length === 0)
    && (!sections.recommendedActions || sections.recommendedActions.length === 0)) {
    return null;
  }

  return (
    <div className="space-y-3">
      {hasKeyMetrics && (
        <RenderBoundary>
          <KpiCards metrics={sections.keyMetrics} />
        </RenderBoundary>
      )}
      {details && details.type === 'table' && (
        <RenderBoundary>
          <DataTable columns={details.columns} rows={details.rows} rawRecords={rawRecords} toolUsed={toolUsed} />
        </RenderBoundary>
      )}
      {details && details.type === 'list' && (
        <RenderBoundary>
          <DefinitionList items={details.items} />
        </RenderBoundary>
      )}
      <RenderBoundary>
        <BulletList title="Insights" items={sections.insights} />
      </RenderBoundary>
      <RenderBoundary>
        <BulletList title="Recommended actions" items={sections.recommendedActions} />
      </RenderBoundary>
    </div>
  );
}

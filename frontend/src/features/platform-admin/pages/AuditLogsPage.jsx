import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { platformAdminApi } from '@/api/platform';

const PAGE_SIZE = 20;

export function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform', 'audit-logs', { action, offset }],
    queryFn: () => platformAdminApi.listAuditLogs({ limit: PAGE_SIZE, offset, action: action || undefined }),
  });

  const entries = data ?? [];

  return (
    <PageContainer>
      <PageHeader title="Audit Logs" description="Track all important actions performed on the platform." />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter by action (e.g. college.created)…"
          value={action}
          onChange={(e) => { setAction(e.target.value); setOffset(0); }}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && <div className="p-6"><Skeleton className="h-64 w-full" /></div>}
          {isError && <p className="p-6 text-sm text-destructive">Could not load audit logs.</p>}
          {data && entries.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">No audit log entries found.</p>
          )}
          {data && entries.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity Type</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</TableCell>
                    <TableCell>{entry.actor_username || 'system'}</TableCell>
                    <TableCell className="font-medium">{entry.action}</TableCell>
                    <TableCell>{entry.entity}</TableCell>
                    <TableCell>{entry.entity_id || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{entry.ip_address || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && (entries.length === PAGE_SIZE || offset > 0) && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={entries.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </Button>
        </div>
      )}
    </PageContainer>
  );
}

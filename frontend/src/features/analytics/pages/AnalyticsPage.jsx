import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { analyticsApi } from '@/api/analytics';

export function AnalyticsPage() {
  const [filters, setFilters] = useState({ classId: '', startDate: '', endDate: '' });
  const [applied, setApplied] = useState({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', 'attendance-rate', applied],
    queryFn: () => analyticsApi.attendanceRate(applied),
  });

  function apply() {
    const next = {};
    if (filters.classId) next.classId = filters.classId;
    if (filters.startDate) next.startDate = filters.startDate;
    if (filters.endDate) next.endDate = filters.endDate;
    setApplied(next);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Analytics</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attendance rate by class</CardTitle>
          <CardDescription>Filters are optional — leave blank to see every class.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Class ID</label>
              <Input
                value={filters.classId}
                onChange={(e) => setFilters((f) => ({ ...f, classId: e.target.value }))}
                className="w-56"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Start date</label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">End date</label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
              />
            </div>
            <Button size="sm" onClick={apply}>Apply</Button>
          </div>

          {isLoading && <Skeleton className="h-64 w-full" />}
          {isError && <p className="text-sm text-destructive">Could not load attendance rate.</p>}
          {data && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead>
                    <TableHead>Sessions</TableHead>
                    <TableHead>Total marked</TableHead>
                    <TableHead>Total present</TableHead>
                    <TableHead>Attendance rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No data.</TableCell></TableRow>
                  )}
                  {data.map((row) => (
                    <TableRow key={row.classId}>
                      <TableCell>{row.className}</TableCell>
                      <TableCell>{row.sessionsCount}</TableCell>
                      <TableCell>{row.totalMarked}</TableCell>
                      <TableCell>{row.totalPresent}</TableCell>
                      <TableCell>
                        {row.attendanceRatePercent === null
                          ? <Badge variant="outline">No data</Badge>
                          : <Badge variant={row.attendanceRatePercent >= 75 ? 'default' : 'destructive'}>{row.attendanceRatePercent}%</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

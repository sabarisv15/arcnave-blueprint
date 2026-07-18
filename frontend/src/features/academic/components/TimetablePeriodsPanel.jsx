import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { RoleGate } from '@/components/layout/RoleGate';
import { timetablePeriodsApi } from '@/api/timetablePeriods';
import { ApiError } from '@/api/client';
import { timetablePeriodFormSchema } from '@/features/academic/schemas';

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function TimetablePeriodsPanel() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['timetable-periods'],
    queryFn: () => timetablePeriodsApi.list({ limit: 100 }),
  });

  const form = useForm({
    resolver: zodResolver(timetablePeriodFormSchema),
    defaultValues: { dayOfWeek: 1, hourIndex: 1, startTime: '', endTime: '' },
  });

  const createMutation = useMutation({
    mutationFn: (values) => timetablePeriodsApi.create(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timetable-periods'] });
      toast.success('Period created');
      setCreateOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create period'),
  });
  const removeMutation = useMutation({
    mutationFn: (id) => timetablePeriodsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timetable-periods'] });
      toast.success('Period removed');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not remove period'),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <RoleGate permission="timetable_periods.create">
          <Button onClick={() => setCreateOpen(true)}>New period</Button>
        </RoleGate>
      </div>
      {isLoading && <Skeleton className="h-48 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load timetable periods.</p>}
      {data && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Hour</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No periods defined yet.</TableCell></TableRow>
              )}
              {data.map((period) => (
                <TableRow key={period.id}>
                  <TableCell>{DAY_NAMES[period.day_of_week] || period.day_of_week}</TableCell>
                  <TableCell>{period.hour_index}</TableCell>
                  <TableCell>{period.start_time}</TableCell>
                  <TableCell>{period.end_time}</TableCell>
                  <TableCell>
                    <RoleGate permission="timetable_periods.delete">
                      <Button size="sm" variant="ghost" onClick={() => removeMutation.mutate(period.id)}>Remove</Button>
                    </RoleGate>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New timetable period</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="space-y-4">
              <FormField control={form.control} name="dayOfWeek" render={({ field }) => (
                <FormItem><FormLabel>Day of week (1=Mon..7=Sun)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="hourIndex" render={({ field }) => (
                <FormItem><FormLabel>Hour index</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="startTime" render={({ field }) => (
                <FormItem><FormLabel>Start time</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="endTime" render={({ field }) => (
                <FormItem><FormLabel>End time</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>Create</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

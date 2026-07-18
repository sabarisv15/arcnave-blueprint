import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { RoleGate } from '@/components/layout/RoleGate';
import { calendarApi } from '@/api/calendar';
import { ApiError } from '@/api/client';
import { calendarEventFormSchema } from '@/features/academic/schemas';

// node-pg parses a DATE column into a JS Date built from LOCAL
// midnight, so JSON.stringify's toISOString() shifts it to a
// different UTC calendar day for any non-UTC server timezone (e.g.
// "2026-08-15" stored comes back as "2026-08-14T18:30:00.000Z" on an
// IST server) — confirmed against the real backend. Reading the local
// getters back out (not slicing the UTC string) recovers the original
// calendar date, which a native <input type="date"> also requires as
// plain YYYY-MM-DD.
function toDateInputValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function EventFormDialog({ open, onOpenChange, title, initialValues, submitting, onSubmit }) {
  const form = useForm({
    resolver: zodResolver(calendarEventFormSchema),
    values: initialValues,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="eventType" render={({ field }) => (
              <FormItem><FormLabel>Event type</FormLabel><FormControl><Input placeholder="e.g. holiday, exam" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="startDate" render={({ field }) => (
              <FormItem><FormLabel>Start date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="endDate" render={({ field }) => (
              <FormItem><FormLabel>End date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>Save</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EventRow({ event, onEdit }) {
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: () => calendarApi.remove(event.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      toast.success('Event removed');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not remove event'),
  });

  return (
    <div className="flex items-center justify-between rounded-md border p-3 text-sm">
      <div>
        <div className="font-medium">{event.title}</div>
        <div className="text-muted-foreground">
          {toDateInputValue(event.start_date)}
          {event.end_date && event.end_date !== event.start_date ? ` – ${toDateInputValue(event.end_date)}` : ''}
          {event.description ? ` — ${event.description}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{event.event_type}</Badge>
        <RoleGate permission="calendar.write">
          <Button size="sm" variant="outline" onClick={() => onEdit(event)}>Edit</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive">Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this event?</AlertDialogTitle>
                <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteMutation.mutate()}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </RoleGate>
      </div>
    </div>
  );
}

export function CalendarPage() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState({ fromDate: '', toDate: '' });
  const [createOpen, setCreateOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['calendar-events', range],
    queryFn: () => calendarApi.list(range),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
  }

  const createMutation = useMutation({
    mutationFn: (values) => {
      const payload = { ...values };
      if (!payload.endDate) delete payload.endDate;
      if (!payload.description) delete payload.description;
      return calendarApi.create(payload);
    },
    onSuccess: () => { invalidate(); toast.success('Event created'); setCreateOpen(false); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create event'),
  });

  const updateMutation = useMutation({
    mutationFn: (values) => {
      const payload = { ...values };
      if (!payload.endDate) delete payload.endDate;
      if (!payload.description) delete payload.description;
      return calendarApi.update(editingEvent.id, payload);
    },
    onSuccess: () => { invalidate(); toast.success('Event updated'); setEditingEvent(null); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not update event'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <RoleGate permission="calendar.write">
          <Button onClick={() => setCreateOpen(true)}>New event</Button>
        </RoleGate>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
          <CardDescription>Semester dates, holidays, exams, and other institution-defined events.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">From</label>
              <Input type="date" value={range.fromDate} onChange={(e) => setRange((r) => ({ ...r, fromDate: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">To</label>
              <Input type="date" value={range.toDate} onChange={(e) => setRange((r) => ({ ...r, toDate: e.target.value }))} />
            </div>
          </div>
          {isLoading && <Skeleton className="h-64 w-full" />}
          {isError && <p className="text-sm text-destructive">Could not load calendar events.</p>}
          {data && data.length === 0 && <p className="text-sm text-muted-foreground">No events.</p>}
          {data && data.map((event) => <EventRow key={event.id} event={event} onEdit={setEditingEvent} />)}
        </CardContent>
      </Card>

      <EventFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New event"
        submitting={createMutation.isPending}
        initialValues={{
          title: '', eventType: '', startDate: '', endDate: '', description: '',
        }}
        onSubmit={(values) => createMutation.mutateAsync(values)}
      />
      {editingEvent && (
        <EventFormDialog
          open={Boolean(editingEvent)}
          onOpenChange={(open) => !open && setEditingEvent(null)}
          title="Edit event"
          submitting={updateMutation.isPending}
          initialValues={{
            title: editingEvent.title,
            eventType: editingEvent.event_type,
            startDate: toDateInputValue(editingEvent.start_date),
            endDate: toDateInputValue(editingEvent.end_date),
            description: editingEvent.description || '',
          }}
          onSubmit={(values) => updateMutation.mutateAsync(values)}
        />
      )}
    </div>
  );
}

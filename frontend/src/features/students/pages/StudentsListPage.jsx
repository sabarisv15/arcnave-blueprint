import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RoleGate } from '@/components/layout/RoleGate';
import { studentsApi } from '@/api/students';
import { ApiError } from '@/api/client';
import { StudentFormDialog } from '@/features/students/components/StudentFormDialog';

const PAGE_SIZE = 20;

export function StudentsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['students', { offset }],
    queryFn: () => studentsApi.list({ limit: PAGE_SIZE, offset }),
  });

  const createMutation = useMutation({
    mutationFn: studentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success('Student created');
      setCreateOpen(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create student'),
  });

  const students = data ?? [];
  const filtered = search
    ? students.filter((s) => s.full_name.toLowerCase().includes(search.toLowerCase())
      || s.roll_no.toLowerCase().includes(search.toLowerCase()))
    : students;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Students</h1>
        <RoleGate permission="students.create">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New student
          </Button>
        </RoleGate>
      </div>

      <Input
        placeholder="Search by name or roll number…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading && <Skeleton className="h-64 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load students.</p>}

      {data && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Roll No</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Phone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No students found.</TableCell></TableRow>
              )}
              {filtered.map((student) => (
                <TableRow
                  key={student.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/students/${student.id}`)}
                >
                  <TableCell>{student.roll_no}</TableCell>
                  <TableCell>{student.full_name}</TableCell>
                  <TableCell><Badge variant="secondary">{student.lifecycle_status}</Badge></TableCell>
                  <TableCell>{student.phone || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          Previous
        </Button>
        <Button variant="outline" disabled={!data || data.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Next
        </Button>
      </div>

      <StudentFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New student"
        submitting={createMutation.isPending}
        onSubmit={(values) => createMutation.mutateAsync(values)}
      />
    </div>
  );
}

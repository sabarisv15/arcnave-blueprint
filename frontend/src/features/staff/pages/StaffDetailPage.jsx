import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { RoleGate } from '@/components/layout/RoleGate';
import { staffApi } from '@/api/staff';
import { ApiError } from '@/api/client';
import { StaffFormDialog } from '@/features/staff/components/StaffFormDialog';

export function StaffDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: staff, isLoading, isError } = useQuery({
    queryKey: ['staff', id],
    queryFn: () => staffApi.get(id),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['staff', id] });
  }

  const updateMutation = useMutation({
    mutationFn: (values) => staffApi.update(id, values),
    onSuccess: () => { invalidate(); toast.success('Staff profile updated'); setEditOpen(false); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not update staff profile'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => staffApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Staff profile removed');
      navigate('/staff');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not remove staff profile'),
  });
  const submitMutation = useMutation({
    mutationFn: () => staffApi.submitRegistration(id),
    onSuccess: () => { invalidate(); toast.success('Submitted for registration approval'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not submit for registration'),
  });
  const deactivateMutation = useMutation({
    mutationFn: () => staffApi.deactivate(id),
    onSuccess: () => { invalidate(); toast.success('Staff deactivated'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not deactivate staff'),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (isError || !staff) return <p className="text-sm text-destructive">Could not load this staff profile.</p>;

  const fields = [
    ['Staff code', staff.staff_code],
    ['Full name', staff.full_name],
    ['Gender', staff.gender],
    ['Date of birth', staff.dob],
    ['Phone', staff.phone],
    ['Department ID', staff.department_id],
    ['Designation', staff.designation],
    ['Qualification', staff.qualification],
    ['Has PhD', staff.has_phd ? 'Yes' : 'No'],
    ['AICTE ID', staff.aicte_id],
    ['Joined year', staff.joined_year],
    ['Address', staff.address],
  ];

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/staff')}>&larr; Back to staff</Button>
        <h1 className="text-xl font-semibold">{staff.full_name}</h1>
        <p className="text-sm text-muted-foreground">{staff.staff_code || 'No staff code assigned'}</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Profile</CardTitle>
          <div className="flex gap-2">
            <RoleGate permission="staff.update">
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>Edit</Button>
            </RoleGate>
            <RoleGate permission="staff.delete">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive">Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove this staff profile?</AlertDialogTitle>
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
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          {fields.map(([label, value]) => (
            <div key={label}>
              <div className="text-muted-foreground">{label}</div>
              <div>{value || '—'}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registration &amp; status</CardTitle>
          <CardDescription>
            Faculty submits &rarr; HOD approves &rarr; Principal approves (BusinessRules.md Staff registration chain).
          </CardDescription>
        </CardHeader>
        <CardFooter className="gap-2">
          <Button size="sm" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
            Submit for registration
          </Button>
          <Button size="sm" variant="outline" onClick={() => deactivateMutation.mutate()} disabled={deactivateMutation.isPending}>
            Deactivate
          </Button>
        </CardFooter>
      </Card>

      <StaffFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit staff profile"
        submitting={updateMutation.isPending}
        lockUserId
        initialValues={{
          userId: staff.user_id, staffCode: staff.staff_code || '', fullName: staff.full_name,
          gender: staff.gender || '', dob: staff.dob || '', phone: staff.phone || '',
          departmentId: staff.department_id || '', designation: staff.designation || '',
          qualification: staff.qualification || '', hasPhd: staff.has_phd || false,
          aicteId: staff.aicte_id || '', joinedYear: staff.joined_year ?? '', address: staff.address || '',
        }}
        onSubmit={(values) => updateMutation.mutateAsync(values)}
      />
    </div>
  );
}

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { staffFormSchema } from '@/features/staff/schemas';

const EMPTY_VALUES = {
  userId: '', staffCode: '', fullName: '', gender: '', dob: '', phone: '',
  departmentId: '', designation: '', qualification: '', hasPhd: false,
  aicteId: '', joinedYear: '', address: '',
};

// Assumes the user account already exists (userId of an already-
// provisioned account) — staffService.createStaff never creates a
// user, only a profile row for one. Creating a new HOD's user+profile
// together goes through HodAccountFormDialog instead.
export function StaffFormDialog({ open, onOpenChange, initialValues, onSubmit, submitting, title, lockUserId }) {
  const form = useForm({
    resolver: zodResolver(staffFormSchema),
    defaultValues: { ...EMPTY_VALUES, ...initialValues },
  });

  useEffect(() => {
    if (open) form.reset({ ...EMPTY_VALUES, ...initialValues });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialValues]);

  async function handleSubmit(values) {
    const payload = { ...values };
    // Blank optional fields must be omitted, not sent as '' — dob is a
    // typed `date` column server-side and Postgres rejects '' outright
    // (confirmed: PUT /staff/:id 500'd with "invalid input syntax for
    // type date" before this was added); every other optional text
    // field gets the same treatment for consistency.
    for (const key of Object.keys(payload)) {
      if (payload[key] === '') delete payload[key];
    }
    await onSubmit(payload);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="userId" render={({ field }) => (
                <FormItem>
                  <FormLabel>User ID</FormLabel>
                  <FormControl><Input {...field} disabled={lockUserId} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="staffCode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Staff code</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="gender" render={({ field }) => (
                <FormItem>
                  <FormLabel>Gender</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="dob" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of birth</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="departmentId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Department ID</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="designation" render={({ field }) => (
                <FormItem>
                  <FormLabel>Designation</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="qualification" render={({ field }) => (
                <FormItem>
                  <FormLabel>Qualification</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="aicteId" render={({ field }) => (
                <FormItem>
                  <FormLabel>AICTE ID</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="joinedYear" render={({ field }) => (
                <FormItem>
                  <FormLabel>Joined year</FormLabel>
                  <FormControl><Input type="number" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="address" render={({ field }) => (
              <FormItem>
                <FormLabel>Address</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="hasPhd" render={({ field }) => (
              <FormItem className="flex flex-row items-center gap-2 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="!mt-0">Has PhD</FormLabel>
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { departmentsApi } from '@/api/departments';
import { hodAccountFormSchema } from '@/features/staff/schemas';

// Creates a brand-new user account AND staff profile together
// (staffService.provisionHodAccount) — the one exception to "the user
// must already exist" that StaffFormDialog assumes.
export function HodAccountFormDialog({ open, onOpenChange, onSubmit, submitting }) {
  const form = useForm({
    resolver: zodResolver(hodAccountFormSchema),
    defaultValues: { username: '', email: '', fullName: '', departmentId: '', phone: '', designation: '', qualification: '' },
  });
  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: departmentsApi.list,
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New HOD account</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => onSubmit(v))} className="space-y-4">
            <FormField control={form.control} name="username" render={({ field }) => (
              <FormItem>
                <FormLabel>Username</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" {...field} /></FormControl>
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
            <FormField control={form.control} name="departmentId" render={({ field }) => (
              <FormItem>
                <FormLabel>Department</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select a department" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {(departments ?? []).map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            <FormField control={form.control} name="designation" render={({ field }) => (
              <FormItem>
                <FormLabel>Designation</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

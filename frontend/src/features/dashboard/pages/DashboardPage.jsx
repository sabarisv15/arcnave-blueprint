import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight, GraduationCap, Briefcase, Layers, Folder, Mail, Clock,
  ChevronDown, ChevronUp, MoreVertical, Check,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { RoleGate } from '@/components/layout/RoleGate';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { workflowRequestsApi } from '@/api/workflowRequests';
import { notificationsApi } from '@/api/notifications';
import { analyticsApi } from '@/api/analytics';
import { backgroundJobsApi } from '@/api/backgroundJobs';
import { financeApi } from '@/api/finance';
import { studentsApi } from '@/api/students';
import { staffApi } from '@/api/staff';
import { classesApi } from '@/api/classes';
import { calendarApi } from '@/api/calendar';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function StatPill({ label, value, tone, wide, className }) {
  return (
    <div className={className}>
      <div className="mb-2.5 whitespace-nowrap text-sm font-semibold text-muted-foreground">{label}</div>
      <div
        className={cn(
          'flex h-11 items-center rounded-[22px] px-4.5 text-sm font-bold',
          wide ? 'w-full justify-start' : 'w-24 justify-center',
          tone === 'dark' && 'bg-dark text-dark-foreground',
          tone === 'gold' && 'bg-gold text-gold-foreground',
          tone === 'stripe' && 'bg-[repeating-linear-gradient(45deg,oklch(0.9_0.03_86)_0_7px,transparent_7px_14px)] bg-accent/60 text-foreground',
          tone === 'outline' && 'border-[1.5px] border-foreground/25 text-muted-foreground',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function BigStat({ icon: Icon, value, label }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <div>
        <div className="text-4xl font-bold leading-none tracking-tight text-foreground">{value}</div>
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function CardShell({ className, children }) {
  return (
    <div className={cn('rounded-2xl bg-card p-5', className)}>{children}</div>
  );
}

function CardIconButton({ icon: Icon = ArrowUpRight }) {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
    </div>
  );
}

function SpotlightCard({ user }) {
  return (
    <div className="relative min-h-[360px] overflow-hidden rounded-2xl bg-muted">
      <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,oklch(0.8_0.03_90),oklch(0.8_0.03_90)_10px,oklch(0.85_0.025_90)_10px,oklch(0.85_0.025_90)_20px)]" />
      <div className="absolute inset-x-0 top-0 bottom-[100px] flex items-center justify-center px-8 text-center font-mono text-[11px] text-foreground/40">
        faculty photo — drop image
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-dark/90 to-transparent p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[19px] font-bold text-white">{user?.role ? `Signed in — ${user.role}` : 'Spotlight'}</div>
            <div className="mt-0.5 text-[13px] text-white/80">College Administrator</div>
          </div>
          <div className="rounded-[18px] bg-white px-4 py-2 text-sm font-bold text-foreground">Today</div>
        </div>
      </div>
    </div>
  );
}

function AttendanceCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', 'attendance-rate'],
    queryFn: () => analyticsApi.attendanceRate(),
  });

  const rows = (data ?? []).filter((r) => r.attendanceRatePercent !== null).slice(0, 7);
  const avg = rows.length
    ? Math.round(rows.reduce((sum, r) => sum + r.attendanceRatePercent, 0) / rows.length)
    : null;
  const peak = rows.length ? Math.max(...rows.map((r) => r.attendanceRatePercent)) : null;

  return (
    <CardShell className="flex min-h-[360px] flex-col overflow-hidden">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[19px] font-bold text-foreground">Attendance</div>
        <CardIconButton />
      </div>
      {isLoading && <Skeleton className="h-24 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load attendance data.</p>}
      {data && rows.length === 0 && <p className="text-sm text-muted-foreground">No attendance sessions yet.</p>}
      {rows.length > 0 && (
        <>
          <div className="flex items-baseline gap-2.5">
            <div className="text-[34px] font-bold tracking-tight text-foreground">{avg}%</div>
            <div className="text-[13px] leading-tight text-muted-foreground">Avg attendance<br />by class</div>
          </div>
          <div
            className="grid flex-1 items-end gap-1 px-0.5 pb-1.5 pt-5"
            style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))` }}
          >
            {rows.map((r) => {
              const isPeak = r.attendanceRatePercent === peak;
              const height = Math.round((r.attendanceRatePercent / 100) * 96) + 10;
              return (
                <div key={r.classId} className="relative flex min-w-0 flex-col items-center gap-2.5">
                  {isPeak && (
                    <div className="absolute -top-7 whitespace-nowrap rounded-[10px] bg-gold px-2 py-1 text-[11px] font-bold text-gold-foreground">
                      {r.attendanceRatePercent}%
                    </div>
                  )}
                  <div
                    className={cn('w-1.5 rounded', isPeak ? 'bg-gold' : 'bg-dark')}
                    style={{ height: `${height}px` }}
                  />
                  <div className="truncate text-[11px] font-semibold text-muted-foreground" title={r.className}>
                    {r.className.slice(0, 3)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </CardShell>
  );
}

function FeeApprovalCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['finance', 'fee-structures'],
    queryFn: () => financeApi.listFeeStructures({ limit: 50 }),
  });

  const total = data?.length ?? 0;
  const approved = data?.filter((row) => row.status === 'Approved').length ?? 0;
  const pct = total ? Math.round((approved / total) * 100) : 0;

  return (
    <CardShell className="flex min-h-[360px] flex-col items-center overflow-hidden">
      <div className="mb-2.5 flex w-full items-center justify-between">
        <div className="text-[19px] font-bold text-foreground">Fee Structures</div>
        <CardIconButton />
      </div>
      {isLoading && <Skeleton className="h-24 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load fee structures.</p>}
      {data && (
        <>
          <div
            className="my-3 flex h-[150px] w-[150px] max-w-full items-center justify-center rounded-full"
            style={{ backgroundImage: `conic-gradient(var(--gold) 0% ${pct}%, oklch(0.9 0.02 90) ${pct}% 100%)` }}
          >
            <div className="flex h-[112px] w-[112px] flex-col items-center justify-center rounded-full bg-card">
              <div className="text-[26px] font-bold text-foreground">{pct}%</div>
              <div className="text-xs font-semibold text-muted-foreground">Approved</div>
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-foreground">
              <Folder className="h-4 w-4" />
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-foreground">
              <Mail className="h-4 w-4" />
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-dark text-dark-foreground">
              <Clock className="h-4 w-4" />
            </div>
          </div>
        </>
      )}
    </CardShell>
  );
}

function ApprovalsAndTasksCard() {
  const { data: pending, isLoading: pendingLoading } = useQuery({
    queryKey: ['workflow-requests', 'pending'],
    queryFn: workflowRequestsApi.listPending,
  });
  const { data: notifications, isLoading: notificationsLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.list,
  });

  const pendingCount = pending?.length ?? 0;

  const tasks = useMemo(() => {
    const workflowTasks = (pending ?? []).map((r) => ({
      id: `wf-${r.id}`,
      title: `${r.entity_type} — step ${r.current_step}`,
      meta: `Entity #${r.entity_id}`,
      done: false,
    }));
    const notificationTasks = (notifications ?? []).map((n) => ({
      id: `n-${n.id}`,
      title: n.subject || `${n.channel} to ${n.to_address}`,
      meta: n.status,
      done: n.status === 'Dispatched',
    }));
    return [...workflowTasks, ...notificationTasks].slice(0, 5);
  }, [pending, notifications]);

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className="flex flex-col gap-4">
      <CardShell>
        <div className="flex items-center justify-between gap-3">
          <div className="text-[19px] font-bold text-foreground">Approvals</div>
          <div className="text-2xl font-bold text-foreground">{pendingLoading ? '—' : pendingCount}</div>
        </div>
        <div className="mt-4 flex h-10 items-center justify-center rounded-xl bg-gold text-sm font-bold text-gold-foreground">
          {pendingCount > 0 ? `${pendingCount} pending your action` : 'Nothing pending'}
        </div>
      </CardShell>

      <div className="relative flex flex-1 flex-col rounded-2xl bg-dark p-5 text-dark-foreground">
        <div className="mb-4.5 flex items-center justify-between">
          <div className="text-[19px] font-bold">Pending Tasks</div>
          <div className="text-[19px] font-bold text-white/70">{doneCount}/{tasks.length}</div>
        </div>
        {(pendingLoading || notificationsLoading) && <Skeleton className="h-24 w-full bg-white/10" />}
        {!pendingLoading && !notificationsLoading && tasks.length === 0 && (
          <p className="text-sm text-white/60">Nothing to review right now.</p>
        )}
        <div className="flex flex-col gap-4">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <Layers className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className={cn('truncate text-[14.5px] font-semibold', t.done ? 'text-white/50 line-through' : 'text-white')}>
                  {t.title}
                </div>
                <div className="mt-0.5 truncate text-xs text-white/60">{t.meta}</div>
              </div>
              {t.done ? (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold text-gold-foreground">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </div>
              ) : (
                <div className="h-6 w-6 shrink-0 rounded-full bg-white/10" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccordionRow({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between border-b border-dashed border-border px-0.5 py-3 text-left"
      >
        <span className="text-base font-semibold text-foreground">{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-b border-dashed border-border px-0.5 py-3.5">
          {children}
        </div>
      )}
    </div>
  );
}

function AccordionItemRow({ label, sub }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="h-11 w-11 shrink-0 rounded-[10px] bg-accent" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold text-foreground">{label}</div>
        <div className="truncate text-[12.5px] text-muted-foreground">{sub}</div>
      </div>
      <MoreVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

function ModulesAccordion() {
  const { data: feeStructures } = useQuery({
    queryKey: ['finance', 'fee-structures'],
    queryFn: () => financeApi.listFeeStructures({ limit: 50 }),
  });
  const { data: jobs } = useQuery({
    queryKey: ['background-jobs'],
    queryFn: backgroundJobsApi.list,
  });

  return (
    <CardShell className="flex flex-col gap-0.5">
      <AccordionRow title="Fee Structures" defaultOpen>
        {(feeStructures ?? []).length === 0 && <p className="text-sm text-muted-foreground">No fee structures yet.</p>}
        {(feeStructures ?? []).slice(0, 3).map((fs) => (
          <AccordionItemRow key={fs.id} label={`${fs.fee_category} — ${fs.academic_year}`} sub={fs.status} />
        ))}
      </AccordionRow>
      <AccordionRow title="Documents">
        <p className="text-sm text-muted-foreground">Open the Documents module to review uploads per student.</p>
      </AccordionRow>
      <AccordionRow title="Background Jobs">
        {(jobs ?? []).length === 0 && <p className="text-sm text-muted-foreground">No recent jobs.</p>}
        {(jobs ?? []).slice(0, 3).map((job) => (
          <AccordionItemRow key={job.id} label={job.name} sub={job.status} />
        ))}
      </AccordionRow>
      <AccordionRow title="Reports">
        <p className="text-sm text-muted-foreground">Generate reports from the Reports module.</p>
      </AccordionRow>
    </CardShell>
  );
}

function WeeklyCalendarCard() {
  const weekStart = useMemo(() => startOfWeek(new Date()), []);
  const days = useMemo(
    () => Array.from({ length: 6 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS)),
    [weekStart],
  );
  const monthLabel = weekStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const { data: events, isLoading } = useQuery({
    queryKey: ['calendar-events', isoDate(weekStart)],
    queryFn: () => calendarApi.list({ fromDate: isoDate(weekStart), toDate: isoDate(days[5]) }),
  });

  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (const ev of events ?? []) {
      const key = (ev.start_date || ev.startDate || '').slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    return map;
  }, [events]);

  return (
    <CardShell className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="rounded-[18px] bg-accent px-4.5 py-2 text-[13.5px] font-bold text-muted-foreground">Prev</div>
        <div className="text-xl font-bold text-foreground">{monthLabel}</div>
        <div className="rounded-[18px] bg-accent px-4.5 py-2 text-[13.5px] font-bold text-muted-foreground">Next</div>
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {!isLoading && (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
          {days.map((d) => {
            const key = isoDate(d);
            const dayEvents = eventsByDay.get(key) ?? [];
            return (
              <div key={key} className="min-w-0">
                <div className="mb-3.5 border-b border-dashed border-border pb-3.5 text-center">
                  <div className="text-[13px] font-bold text-muted-foreground">
                    {d.toLocaleDateString(undefined, { weekday: 'short' })}
                  </div>
                  <div className="mt-0.5 text-base font-bold text-foreground">{d.getDate()}</div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {dayEvents.length === 0 && <div className="h-2" />}
                  {dayEvents.map((ev) => (
                    <div key={ev.id} className="rounded-[14px] bg-dark px-3.5 py-3 text-dark-foreground">
                      <div className="truncate text-sm font-bold">{ev.title}</div>
                      {ev.description && (
                        <div className="mt-0.5 truncate text-xs opacity-70">{ev.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CardShell>
  );
}

export function DashboardPage() {
  const { user } = useAuth();

  const { data: attendanceRows } = useQuery({
    queryKey: ['analytics', 'attendance-rate'],
    queryFn: () => analyticsApi.attendanceRate(),
  });
  const { data: pending } = useQuery({
    queryKey: ['workflow-requests', 'pending'],
    queryFn: workflowRequestsApi.listPending,
  });
  const { data: feeStructures } = useQuery({
    queryKey: ['finance', 'fee-structures'],
    queryFn: () => financeApi.listFeeStructures({ limit: 50 }),
  });
  const { data: jobs } = useQuery({
    queryKey: ['background-jobs'],
    queryFn: backgroundJobsApi.list,
  });
  const { data: students } = useQuery({
    queryKey: ['students', 'count'],
    queryFn: () => studentsApi.list({ limit: 500 }),
  });
  const { data: staff } = useQuery({
    queryKey: ['staff', 'count'],
    queryFn: () => staffApi.list({ limit: 500 }),
  });
  const { data: classes } = useQuery({
    queryKey: ['classes', 'count'],
    queryFn: () => classesApi.list({ limit: 500 }),
  });

  const validRates = (attendanceRows ?? []).filter((r) => r.attendanceRatePercent !== null);
  const attendanceAvg = validRates.length
    ? Math.round(validRates.reduce((s, r) => s + r.attendanceRatePercent, 0) / validRates.length)
    : null;

  const feeTotal = feeStructures?.length ?? 0;
  const feeApproved = feeStructures?.filter((f) => f.status === 'Approved').length ?? 0;
  const feePct = feeTotal ? Math.round((feeApproved / feeTotal) * 100) : 0;

  const jobsTotal = jobs?.length ?? 0;
  const jobsCleared = jobs?.filter((j) => j.status === 'completed').length ?? 0;
  const jobsPct = jobsTotal ? Math.round((jobsCleared / jobsTotal) * 100) : 0;

  return (
    <div className="flex flex-col gap-8 rounded-[32px] bg-panel-gradient p-6 shadow-panel sm:p-8 md:p-10">
      <header>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-[44px]">
          Welcome back, {user?.role}
        </h1>
      </header>

      <section className="flex min-w-0 flex-wrap items-center gap-6">
        <StatPill label="Attendance" value={attendanceAvg !== null ? `${attendanceAvg}%` : '—'} tone="dark" />
        <RoleGate permission="reports.generate">
          <StatPill label="Approvals" value={pending?.length ?? '—'} tone="gold" />
        </RoleGate>
        <RoleGate permission="finance.fee_structures.update">
          <StatPill label="Fee Approved" value={`${feePct}%`} tone="stripe" wide className="min-w-[220px]" />
        </RoleGate>
        <RoleGate permission="background_jobs.read">
          <StatPill label="Jobs Cleared" value={`${jobsPct}%`} tone="outline" className="ml-2" />
        </RoleGate>

        <div className="flex-1" />

        <div className="flex flex-wrap items-center gap-7">
          <BigStat icon={GraduationCap} value={students?.length ?? '—'} label="Students" />
          <BigStat icon={Briefcase} value={staff?.length ?? '—'} label="Staff" />
          <BigStat icon={Layers} value={classes?.length ?? '—'} label="Classes" />
        </div>
      </section>

      <section className="grid min-w-0 grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <SpotlightCard user={user} />
        <AttendanceCard />
        <FeeApprovalCard />
        <div className="sm:row-span-2 xl:col-start-4 xl:row-span-2">
          <ApprovalsAndTasksCard />
        </div>
        <div className="sm:col-span-2 xl:col-span-1">
          <ModulesAccordion />
        </div>
        <div className="sm:col-span-2 xl:col-span-2">
          <WeeklyCalendarCard />
        </div>
      </section>
    </div>
  );
}

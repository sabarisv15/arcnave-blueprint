import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { PlatformProtectedRoute } from '@/components/layout/PlatformProtectedRoute';

import { LoginPage } from '@/features/auth/pages/LoginPage';
import { MfaChallengePage } from '@/features/auth/pages/MfaChallengePage';
import { ForgotPasswordPage } from '@/features/auth/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage';
import { InvitationAcceptPage } from '@/features/auth/pages/InvitationAcceptPage';

import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';
import { StudentsListPage } from '@/features/students/pages/StudentsListPage';
import { StudentDetailPage } from '@/features/students/pages/StudentDetailPage';
import { StaffListPage } from '@/features/staff/pages/StaffListPage';
import { StaffDetailPage } from '@/features/staff/pages/StaffDetailPage';
import { AcademicOverviewPage } from '@/features/academic/pages/AcademicOverviewPage';
import { ClassDetailPage } from '@/features/academic/pages/ClassDetailPage';
import { ArchivalPage } from '@/features/academic/pages/ArchivalPage';
import { CalendarPage } from '@/features/academic/pages/CalendarPage';
import { AttendancePage } from '@/features/attendance/pages/AttendancePage';
import { FinancePage } from '@/features/finance/pages/FinancePage';
import { DocumentsPage } from '@/features/documents/pages/DocumentsPage';
import { InstitutionalDocumentsPage } from '@/features/institutionalDocuments/pages/InstitutionalDocumentsPage';
import { ReportsPage } from '@/features/reports/pages/ReportsPage';
import { PendingApprovalsPage } from '@/features/workflow/pages/PendingApprovalsPage';
import { NotificationsPage } from '@/features/workflow/pages/NotificationsPage';
import { CopilotPage } from '@/features/ai/pages/CopilotPage';
import { AnalyticsPage } from '@/features/analytics/pages/AnalyticsPage';
import { CollegeProfilePage } from '@/features/settings/pages/CollegeProfilePage';
import { ConfigurationsPage } from '@/features/settings/pages/ConfigurationsPage';
import { AiConfigPage } from '@/features/settings/pages/AiConfigPage';
import { BackgroundJobsPage } from '@/features/settings/pages/BackgroundJobsPage';
import { ProfilePage } from '@/features/settings/pages/ProfilePage';

import { PlatformAppShell } from '@/components/layout/PlatformAppShell';
import { PlatformLoginPage } from '@/features/platform-admin/pages/PlatformLoginPage';
import { PlatformDashboardPage } from '@/features/platform-admin/pages/PlatformDashboardPage';
import { OrganizationsPage } from '@/features/platform-admin/pages/OrganizationsPage';
import { InvitationsPage } from '@/features/platform-admin/pages/InvitationsPage';
import { AuditLogsPage } from '@/features/platform-admin/pages/AuditLogsPage';
import { PlatformSettingsPage } from '@/features/platform-admin/pages/PlatformSettingsPage';

export const router = createBrowserRouter([
  // Public — tenant app
  { path: '/login', element: <LoginPage /> },
  { path: '/login/mfa', element: <MfaChallengePage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password/:token', element: <ResetPasswordPage /> },
  { path: '/invitations/accept', element: <InvitationAcceptPage /> },

  // Protected — tenant app
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/students', element: <StudentsListPage /> },
          { path: '/students/:id', element: <StudentDetailPage /> },
          { path: '/staff', element: <StaffListPage /> },
          { path: '/staff/:id', element: <StaffDetailPage /> },
          { path: '/academic', element: <AcademicOverviewPage /> },
          { path: '/academic/classes/:id', element: <ClassDetailPage /> },
          { path: '/attendance', element: <AttendancePage /> },
          { path: '/finance', element: <FinancePage /> },
          { path: '/documents', element: <DocumentsPage /> },
          { path: '/institutional-documents', element: <InstitutionalDocumentsPage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/workflow/pending', element: <PendingApprovalsPage /> },
          { path: '/notifications', element: <NotificationsPage /> },
          { path: '/analytics', element: <AnalyticsPage /> },
          { path: '/archival', element: <ArchivalPage /> },
          { path: '/calendar', element: <CalendarPage /> },
          { path: '/settings/college-profile', element: <CollegeProfilePage /> },
          { path: '/settings/configurations', element: <ConfigurationsPage /> },
          { path: '/settings/ai-config', element: <AiConfigPage /> },
          { path: '/settings/background-jobs', element: <BackgroundJobsPage /> },
        ],
      },
    ],
  },

  // ARCNAVE AI — its own full-bleed workspace shell (sidebar +
  // composer), not nested inside AppShell's top-nav chrome, same
  // pattern as the Platform Admin app group below.
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/ai/copilot', element: <CopilotPage /> },
    ],
  },

  // Platform (Super Admin) app — structurally separate auth domain
  { path: '/platform/login', element: <PlatformLoginPage /> },
  {
    element: <PlatformProtectedRoute />,
    children: [
      {
        element: <PlatformAppShell />,
        children: [
          { path: '/platform/dashboard', element: <PlatformDashboardPage /> },
          { path: '/platform/organizations', element: <OrganizationsPage /> },
          { path: '/platform/invitations', element: <InvitationsPage /> },
          { path: '/platform/audit-logs', element: <AuditLogsPage /> },
          { path: '/platform/settings', element: <PlatformSettingsPage /> },
        ],
      },
    ],
  },
]);

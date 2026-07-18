import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { authApi } from '@/api/auth';
import { ApiError } from '@/api/client';

// The backend has no endpoint that reports current mfa_enabled status
// (GET /auth/me returns only user_id/college_id/role) — only the
// enable/disable actions themselves return it. So this page can't show
// a bound on/off state on load, only after the user takes an action.
export function ProfilePage() {
  const { user } = useAuth();
  const [mfaEnabled, setMfaEnabled] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleToggleMfa(enable) {
    setSubmitting(true);
    try {
      const result = enable ? await authApi.enableMfa() : await authApi.disableMfa();
      setMfaEnabled(result.mfa_enabled);
      toast.success(enable ? 'MFA enabled' : 'MFA disabled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : 'Could not update MFA setting');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account identity, from the current session token.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Role</span>
            <Badge variant="secondary">{user?.role}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">User ID</span>
            <span className="font-mono text-xs">{user?.userId}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Multi-factor authentication</CardTitle>
          <CardDescription>
            {mfaEnabled === null
              ? 'Enable or disable email-based MFA for your account.'
              : `MFA is currently ${mfaEnabled ? 'enabled' : 'disabled'}.`}
          </CardDescription>
        </CardHeader>
        <CardFooter className="gap-2">
          <Button disabled={submitting} onClick={() => handleToggleMfa(true)}>
            Enable MFA
          </Button>
          <Button variant="outline" disabled={submitting} onClick={() => handleToggleMfa(false)}>
            Disable MFA
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

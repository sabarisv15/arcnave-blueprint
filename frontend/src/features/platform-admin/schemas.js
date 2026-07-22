import { z } from 'zod';

export const platformLoginFormSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

// License (subscription_status) — matches platformService.VALID_LICENSES
// exactly; keep the two in sync if that set ever changes.
export const LICENSE_OPTIONS = ['trial', 'full'];

export const collegeFormSchema = z.object({
  collegeId: z.string().min(1, 'College ID is required'),
  name: z.string().min(1, 'Name is required'),
  subdomain: z.string().min(1, 'Subdomain is required'),
  // Optional — the Level 1 Institutional Position's title (e.g.
  // "Principal", "Director"). Backend defaults to "Principal" when
  // omitted, so this is never required.
  level1PositionTitle: z.string().optional(),
  // Optional — same shape one level down, for the Level 3
  // (HOD-equivalent) position. Backend defaults to "HOD" when omitted.
  level3PositionTitle: z.string().optional(),
  // Free-text, no fixed tier set yet (product scope still undecided,
  // "will plan later" — same status as AI tier) — purely a label for
  // now, nothing reads or enforces it.
  storageTier: z.string().optional(),
  license: z.enum(LICENSE_OPTIONS).default('trial'),
  // Optional — when set, a Principal invitation is sent in the same
  // request as college creation instead of requiring a separate
  // "Invite Principal" action afterward.
  principalEmail: z.union([z.string().email('Enter a valid email'), z.literal('')]).optional(),
});

// Edit mode: college_id/subdomain are immutable (see
// platformRepository.updateCollege's own comment for why) — no field
// for either here. principalEmail also drops out — inviting is its own
// dedicated action (InvitePrincipalDialog), not folded into edit.
export const editCollegeFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  level1PositionTitle: z.string().optional(),
  level3PositionTitle: z.string().optional(),
  storageTier: z.string().optional(),
  license: z.enum(LICENSE_OPTIONS).default('trial'),
});

export const invitePrincipalFormSchema = z.object({
  email: z.string().email('A valid email is required'),
});

export const platformSettingsFormSchema = z.object({
  platformName: z.string().min(1, 'Platform name is required'),
  supportEmail: z.union([z.string().email('Enter a valid email'), z.literal('')]).optional(),
  defaultTimezone: z.string().min(1, 'Default timezone is required'),
  dateFormat: z.string().min(1, 'Date format is required'),
  itemsPerPage: z.coerce.number().int().min(5, 'Must be at least 5').max(200, 'Must be at most 200'),
});

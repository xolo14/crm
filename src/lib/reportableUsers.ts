/**
 * Rep tables and leaderboards show only real, active team members: deactivated
 * users, platform super admins and test/review accounts (e.g. reviewer@…) are
 * left out. Same definition as syncpediaActiveUserSql() in php-backend/api/helpers.php.
 */
const TEST_ACCOUNT_RE = /^(reviewer|test|demo|qa)[.+_-]?[a-z0-9]*@/i;

export function isReportableUser(p: { is_active?: unknown; email?: unknown; role?: unknown } | null | undefined): boolean {
  if (!p) return false;
  const role = String(p.role ?? "").trim().toLowerCase();
  if (role === "super_admin" || role === "superadmin") return false;
  const active = p.is_active;
  if (active === 0 || active === "0" || active === false) return false;
  const email = String(p.email ?? "").trim();
  if (email && TEST_ACCOUNT_RE.test(email)) return false;
  return true;
}

/** Test / review accounts (reviewer@…, test@…): never shown in any report. */
export function isTestAccount(p: { email?: unknown } | null | undefined): boolean {
  const email = String(p?.email ?? "").trim();
  return Boolean(email && TEST_ACCOUNT_RE.test(email));
}

/** Deactivated users still own their past leads, calls and reports. */
export function isInactiveUser(p: { is_active?: unknown } | null | undefined): boolean {
  const active = p?.is_active;
  return active === 0 || active === "0" || active === false;
}

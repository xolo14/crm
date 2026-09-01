/** DECOY-ONLY client-side mask (mirrors api-decoy/lib/maskPii.php). */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length <= 4) return '*'.repeat(digits.length);
  const prefix = digits.slice(0, 2);
  const suffix = digits.slice(-4);
  const mid = Math.max(0, digits.length - 6);
  return prefix + 'X'.repeat(mid) + suffix;
}

export function maskEmail(email: string | null | undefined): string {
  const e = String(email || '').trim();
  if (!e) return '';
  const at = e.indexOf('@');
  if (at < 0) return '**@**';
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const keep = Math.min(2, local.length);
  return local.slice(0, keep) + '***@' + domain;
}

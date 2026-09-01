import { describe, expect, it } from 'vitest';
import { maskEmail, maskPhone } from './maskPii';
import { decoyApi } from './api';

describe('decoy maskPii (DECOY-ONLY)', () => {
  it('masks phone without leaking full number', () => {
    const raw = '9876543210';
    const masked = maskPhone(raw);
    expect(masked).not.toBe(raw);
    expect(masked.startsWith('98')).toBe(true);
    expect(masked.endsWith('3210')).toBe(true);
    expect(masked.includes('X')).toBe(true);
  });

  it('masks email keeping 2 local chars', () => {
    expect(maskEmail('john.doe@example.com')).toBe('jo***@example.com');
  });

  it('handles empty values', () => {
    expect(maskPhone('')).toBe('');
    expect(maskEmail('')).toBe('');
  });
});

describe('decoy API isolation (DECOY-ONLY)', () => {
  it('export URL stays on /api-decoy', () => {
    expect(decoyApi.exportUrl()).toBe('/api-decoy/leads.php?action=export');
  });
});

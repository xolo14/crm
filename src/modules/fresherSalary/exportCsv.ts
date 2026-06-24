import type { FresherMember } from './types';

function escCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function exportMembersToCsv(members: FresherMember[], fixedSalaryEstimate: number): string {
  const headers = [
    'id',
    'name',
    'role',
    'joiningDate',
    'currentPhase',
    'salaryType',
    'headlineStatus',
    'trainingAchieved',
    'month1Achieved',
    'm2First10',
    'm2Next15',
    'm2Total',
    'm2Aggregate',
    'month3Achieved',
    'fixedSalaryEstimate',
  ];
  const lines = [headers.join(',')];
  for (const m of members) {
    const row = [
      m.id,
      m.name,
      m.role,
      m.joiningDate,
      m.currentPhase,
      m.salaryType,
      m.headlineStatus,
      String(m.training.achieved),
      String(m.month1.achieved),
      String(m.month2.first10Days.achieved),
      String(m.month2.next15Days.achieved),
      String(m.month2.totalAchieved),
      m.month2.status,
      String(m.month3.achieved),
      String(fixedSalaryEstimate),
    ].map((x) => escCell(String(x)));
    lines.push(row.join(','));
  }
  return lines.join('\r\n');
}

export function downloadMembersCsv(members: FresherMember[], fixedSalaryEstimate: number, filename = 'fresher-salary-export.csv') {
  const csv = exportMembersToCsv(members, fixedSalaryEstimate);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

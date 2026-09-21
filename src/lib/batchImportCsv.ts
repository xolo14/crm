/**
 * CSV/Excel batch import utilities.
 */

export const BATCH_IMPORT_HEADERS = [
 'name',
 'course_id',
 'trainer_id',
 'start_date',
 'end_date',
 'max_students',
 'is_active',
] as const;

export function buildBatchTemplateCsv(): string {
 const sample = [
 'Batch A',
 '1',
 '1',
 '2025-10-01',
 '2026-03-31',
 '30',
 'true',
 ];
 const escape = (v: string) => {
 if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
 return v;
 };
 return [
 BATCH_IMPORT_HEADERS.join(','),
 sample.map(escape).join(','),
 ].join('\n');
}

export function downloadBatchTemplate(): void {
 const csv = buildBatchTemplateCsv();
 const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = 'batches-import-template.csv';
 a.click();
 URL.revokeObjectURL(url);
}

export async function downloadBatchTemplateExcel(): Promise<void> {
 const XLSX = await import('@stackline/xlsx');
 const sample = [
 'Batch A',
 '1',
 '1',
 '2025-10-01',
 '2026-03-31',
 '30',
 'true',
 ];
 const worksheet = XLSX.utils.aoa_to_sheet([
 [...BATCH_IMPORT_HEADERS],
 sample,
 ]);
 const workbook = XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(workbook, worksheet, 'Batches');
 XLSX.writeFile(workbook, 'batches-import-template.xlsx');
}

export function mapCsvRowsToBatches(rows: string[][]): {
 batches: any[];
 skipped: number;
 errors: string[];
} {
 const errors: string[] = [];
 const batches: any[] = [];
 let skipped = 0;

 if (rows.length < 2) {
 return { batches: [], skipped: 0, errors: ['The import file needs a header row and at least one data row'] };
 }

 const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/^﻿/, '').replace(/[^a-z0-9_]+/g, '_'));
 const headerIndex = new Map<string, number>();
 headers.forEach((h, i) => { if (h) headerIndex.set(h, i); });

 for (let r = 1; r < rows.length; r++) {
 const cols = rows[r];
 if (!cols.some((c) => String(c || '').trim())) {
 skipped++;
 continue;
 }

 const name = String(cols[headerIndex.get('name') ?? 0] ?? '').trim();
 const courseId = String(cols[headerIndex.get('course_id') ?? -1] ?? '').trim();
 const trainerId = String(cols[headerIndex.get('trainer_id') ?? -1] ?? '').trim();
 const startDate = String(cols[headerIndex.get('start_date') ?? -1] ?? '').trim();
 const endDate = String(cols[headerIndex.get('end_date') ?? -1] ?? '').trim();
 const maxStudentsRaw = String(cols[headerIndex.get('max_students') ?? -1] ?? '').trim();
 const isActiveRaw = String(cols[headerIndex.get('is_active') ?? -1] ?? '').trim().toLowerCase();

 if (!name) {
 errors.push('Row ' + (r + 1) + ': name is required');
 skipped++;
 continue;
 }

 const batch: any = { name };
 if (courseId) batch.course_id = courseId;
 if (trainerId) batch.trainer_id = trainerId;
 if (startDate) batch.start_date = startDate;
 if (endDate) batch.end_date = endDate;
 if (maxStudentsRaw) batch.seat_limit = parseInt(maxStudentsRaw, 10) || 0;
 batch.is_active = isActiveRaw === 'false' || isActiveRaw === '0' ? false : true;

 batches.push(batch);
 }

 return { batches, skipped, errors };
}

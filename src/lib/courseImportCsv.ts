import { parseCsvText, parseLeadImportFile } from '@/lib/leadImportCsv';

export const COURSE_IMPORT_HEADERS = ['name', 'description', 'price', 'duration_weeks', 'modules', 'is_active'] as const;

export function buildCourseTemplateCsv(): string {
 const sample = ['Full Stack Development', 'Complete web development course', '15000', '12', 'HTML; CSS; React; Node.js', '1'];
 const escape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
 return [COURSE_IMPORT_HEADERS.join(','), sample.map(escape).join(',')].join('\n');
}

export function downloadCourseTemplate(): void {
 const csv = buildCourseTemplateCsv();
 const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = 'courses-import-template.csv';
 a.click();
 URL.revokeObjectURL(url);
}

export async function downloadCourseTemplateExcel(): Promise<void> {
 const XLSX = await import('@stackline/xlsx');
 const sample = ['Full Stack Development', 'Complete web development course', '15000', '12', 'HTML; CSS; React; Node.js', '1'];
 const ws = XLSX.utils.aoa_to_sheet([[...COURSE_IMPORT_HEADERS], sample]);
 const wb = XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb, ws, 'Courses');
 XLSX.writeFile(wb, 'courses-import-template.xlsx');
}

export function mapCsvRowsToCourses(rows: string[][]): { courses: any[]; skipped: number; errors: string[] } {
 const errors: string[] = [];
 if (rows.length < 2) return { courses: [], skipped: 0, errors: ['The import file needs a header row and at least one data row'] };

 const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/^﻿/, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, ''));
 const courses: any[] = [];
 let skipped = 0;

 for (let r = 1; r < rows.length; r++) {
 const cols = rows[r];
 if (!cols.some((c) => String(c || '').trim())) { skipped++; continue; }

 const row: Record<string, string> = {};
 headers.forEach((h, i) => { if (h) row[h] = String(cols[i] ?? '').trim(); });

 const name = row.name || '';
 if (!name) { skipped++; errors.push('Row ' + (r + 1) + ': name is required'); continue; }

 const modules = row.modules ? row.modules.split(';').map((m) => m.trim()).filter(Boolean) : [];
 const isActive = ['1', 'true', 'yes', 'active'].includes((row.is_active || '1').toLowerCase());

 courses.push({
 name,
 description: row.description || '',
 price: row.price ? parseFloat(row.price) : 0,
 duration_weeks: row.duration_weeks ? parseInt(row.duration_weeks, 10) : null,
 modules,
 is_active: isActive ? 1 : 0,
 });
 }
 return { courses, skipped, errors };
}

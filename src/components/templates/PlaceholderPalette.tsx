import { useMemo, useState } from 'react';
import { Plus, Variable } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type PlaceholderDef = {
  key: string;
  label: string;
  token: string;
  hint?: string;
  category: string;
};

/** Standard offer-letter merge fields (token = {{snake_case}}). */
export const OFFER_PLACEHOLDER_DEFS: PlaceholderDef[] = [
  { key: 'candidate_name', label: 'Candidate name', token: '{{candidate_name}}', category: 'Candidate', hint: 'Full name' },
  { key: 'role_title', label: 'Role / title', token: '{{role_title}}', category: 'Role' },
  { key: 'department', label: 'Department', token: '{{department}}', category: 'Role' },
  { key: 'employment_type', label: 'Employment type', token: '{{employment_type}}', category: 'Role' },
  { key: 'reporting_to', label: 'Reporting to', token: '{{reporting_to}}', category: 'Role' },
  { key: 'work_location', label: 'Work location', token: '{{work_location}}', category: 'Role' },
  { key: 'salary', label: 'Salary / CTC', token: '{{salary}}', category: 'Compensation' },
  { key: 'probation_period', label: 'Probation', token: '{{probation_period}}', category: 'Compensation' },
  { key: 'start_date', label: 'Joining date', token: '{{start_date}}', category: 'Dates' },
  { key: 'deadline', label: 'Accept by', token: '{{deadline}}', category: 'Dates' },
  { key: 'date', label: 'Letter date', token: '{{date}}', category: 'Dates', hint: 'Auto today if empty' },
  { key: 'company_name', label: 'Company name', token: '{{company_name}}', category: 'Company' },
  { key: 'company_address', label: 'Company address', token: '{{company_address}}', category: 'Company' },
  { key: 'company_website', label: 'Website', token: '{{company_website}}', category: 'Company' },
  { key: 'company_phone', label: 'Phone', token: '{{company_phone}}', category: 'Company' },
  { key: 'sender_name', label: 'Sender name', token: '{{sender_name}}', category: 'Sender' },
  { key: 'sender_title', label: 'Sender title', token: '{{sender_title}}', category: 'Sender' },
  { key: 'sender_email', label: 'Sender email', token: '{{sender_email}}', category: 'Sender' },
  { key: 'ref_number', label: 'Reference no.', token: '{{ref_number}}', category: 'System', hint: 'Auto-generated on send' },
];

export function toPlaceholderToken(raw: string): string {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/\{\{|\}\}/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return key ? `{{${key}}}` : '';
}

export function extractPlaceholderTokens(html: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    found.add(`{{${m[1]}}}`);
  }
  return [...found];
}

type Props = {
  onInsert: (token: string) => void;
  /** HTML/content to detect which fields are already used */
  documentHtml?: string;
  className?: string;
  compact?: boolean;
};

/**
 * Merge-field palette: click chips to insert {{placeholders}}, plus custom field creator.
 */
export function PlaceholderPalette({ onInsert, documentHtml = '', className, compact }: Props) {
  const [customLabel, setCustomLabel] = useState('');
  const [customExtras, setCustomExtras] = useState<PlaceholderDef[]>([]);

  const used = useMemo(() => new Set(extractPlaceholderTokens(documentHtml)), [documentHtml]);

  const allDefs = useMemo(() => [...OFFER_PLACEHOLDER_DEFS, ...customExtras], [customExtras]);

  const byCategory = useMemo(() => {
    const map = new Map<string, PlaceholderDef[]>();
    for (const d of allDefs) {
      const list = map.get(d.category) || [];
      list.push(d);
      map.set(d.category, list);
    }
    return [...map.entries()];
  }, [allDefs]);

  const previewToken = toPlaceholderToken(customLabel);

  const addCustom = () => {
    const token = toPlaceholderToken(customLabel);
    if (!token) return;
    const key = token.replace(/\{\{|\}\}/g, '');
    if (allDefs.some((d) => d.key === key)) {
      onInsert(token);
      setCustomLabel('');
      return;
    }
    const def: PlaceholderDef = {
      key,
      label: customLabel.trim() || key,
      token,
      category: 'Custom',
      hint: 'Excel column = ' + key,
    };
    setCustomExtras((prev) => [...prev, def]);
    onInsert(token);
    setCustomLabel('');
  };

  return (
    <div className={cn('rounded-md border bg-card', className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <Variable className="h-3.5 w-3.5 text-primary" />
        <div className="min-w-0">
          <p className="text-xs font-semibold">Placeholders (merge fields)</p>
          {!compact ? (
            <p className="text-[10px] text-muted-foreground truncate">
              Click to insert at cursor · Excel columns should match the name inside {'{{ }}'}
            </p>
          ) : null}
        </div>
      </div>

      <div className={cn('space-y-3 overflow-y-auto', compact ? 'max-h-40 p-2' : 'max-h-[min(52vh,420px)] p-3')}>
        {byCategory.map(([cat, items]) => (
          <div key={cat}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{cat}</p>
            <div className="flex flex-wrap gap-1.5">
              {items.map((d) => {
                const isUsed = used.has(d.token);
                return (
                  <button
                    key={d.key}
                    type="button"
                    title={d.hint ? `${d.token} — ${d.hint}` : d.token}
                    onClick={() => onInsert(d.token)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                      isUsed
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border bg-background hover:bg-muted',
                    )}
                  >
                    <span>{d.label}</span>
                    <code className="text-[9px] opacity-70">{d.token}</code>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="pt-1 border-t space-y-2">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Create custom placeholder</Label>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <Input
                className="h-8 text-xs"
                placeholder="e.g. Bond period / Notice days"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustom();
                  }
                }}
              />
            </div>
            <Button type="button" size="sm" className="h-8 text-xs gap-1" onClick={addCustom} disabled={!previewToken}>
              <Plus className="h-3 w-3" /> Insert
            </Button>
          </div>
          {previewToken ? (
            <p className="text-[10px] text-muted-foreground">
              Will insert <code className="rounded bg-muted px-1">{previewToken}</code>
              {' '}· use the same column name in Excel for bulk issue
            </p>
          ) : null}
        </div>

        {used.size > 0 ? (
          <div className="pt-1 border-t">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              In this template ({used.size})
            </p>
            <div className="flex flex-wrap gap-1">
              {[...used].map((t) => (
                <code key={t} className="text-[10px] rounded bg-muted px-1.5 py-0.5">{t}</code>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

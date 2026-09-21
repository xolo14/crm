import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  KEEP_TEMPLATE_PREFILL,
  placeholderGroup,
  type FormFieldOption,
  type PlaceholderMapping,
  type TemplatePlaceholder,
} from "@/lib/formTemplatePlaceholders";

type Props = {
  placeholders: TemplatePlaceholder[];
  fields: FormFieldOption[];
  mappings: PlaceholderMapping[];
  onChange: (next: PlaceholderMapping[]) => void;
};

function mappingFor(mappings: PlaceholderMapping[], key: string): PlaceholderMapping {
  return mappings.find((m) => m.key === key) || { key, field_key: "", prefill: "" };
}

export function TemplatePlaceholderMap({ placeholders, fields, mappings, onChange }: Props) {
  if (!placeholders.length) return null;

  const patch = (key: string, next: Partial<PlaceholderMapping>) => {
    const current = placeholders.map((ph) => {
      const row = mappingFor(mappings, ph.key);
      return ph.key === key ? { ...row, ...next } : row;
    });
    onChange(current);
  };

  return (
    <div className="space-y-3">
      {placeholders.map((ph) => {
        const row = mappingFor(mappings, ph.key);
        const isAutoId = ph.auto && (ph.key === "cert_id" || ph.key === "certid" || ph.key === "ref_number");
        const matched = fields.find((f) => f.key === row.field_key);
        const selectValue = matched?.id || KEEP_TEMPLATE_PREFILL;
        const dateGroup = placeholderGroup(ph.key) === "date" || placeholderGroup(ph.key) === "start" || placeholderGroup(ph.key) === "end";
        return (
          <div key={ph.key} className="rounded-md border bg-background p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-sm font-normal">
                <span className="font-mono text-xs text-muted-foreground">{ph.token}</span>
                <span className="ml-1.5 text-foreground">{ph.label}</span>
                {matched ? (
                  <span className="ml-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">Matched</span>
                ) : !isAutoId ? (
                  <span className="ml-1.5 text-[11px] text-muted-foreground">Prefill</span>
                ) : null}
              </Label>
              {isAutoId ? (
                <span className="text-[11px] text-muted-foreground">Filled automatically</span>
              ) : (
                <Select
                  value={selectValue}
                  onValueChange={(v) => {
                    if (v === KEEP_TEMPLATE_PREFILL) {
                      patch(ph.key, { field_key: "" });
                      return;
                    }
                    const field = fields.find((f) => f.id === v);
                    patch(ph.key, { field_key: field?.key || "" });
                  }}
                >
                  <SelectTrigger className="h-9 w-full max-w-[240px] text-sm">
                    <SelectValue placeholder="Keep template prefill" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={KEEP_TEMPLATE_PREFILL}>
                      {dateGroup ? "Lead date (payment or created)" : "Keep template prefill"}
                    </SelectItem>
                    {fields.map((f) => (
                      <SelectItem key={f.id || f.key} value={f.id || f.key}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {!isAutoId ? (
              <Input
                className="h-9 text-sm"
                placeholder={
                  row.field_key
                    ? "Fallback if that form field is empty"
                    : dateGroup
                      ? "Leave blank to use lead date + duration"
                      : "Type a prefill, or keep the template text"
                }
                value={row.prefill}
                onChange={(e) => patch(ph.key, { prefill: e.target.value })}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

type DialogProps = Props & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  durationMonths?: number;
  onDurationChange?: (months: number) => void;
  showDuration?: boolean;
};

export function PlaceholderMatchDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholders,
  fields,
  mappings,
  onChange,
  durationMonths,
  onDurationChange,
  showDuration,
}: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ||
              "Match each template placeholder to a form field. Unmatched values stay as prefill."}
          </DialogDescription>
        </DialogHeader>
        {showDuration ? (
          <div className="rounded-md border bg-muted/20 p-3 space-y-1.5">
            <Label className="text-sm">Duration (months)</Label>
            <Input
              type="number"
              min={0}
              className="h-9"
              value={Number.isFinite(durationMonths) ? String(durationMonths) : "0"}
              onChange={(e) => {
                const n = Number(e.target.value);
                onDurationChange?.(Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
              }}
            />
            <p className="text-[11px] text-muted-foreground leading-snug">
              When Auto is on, this is how many months after lead creation the certificate is generated.
              0 = create immediately (issued date = lead created date). 2 = create 2 months later.
            </p>
          </div>
        ) : null}
        <TemplatePlaceholderMap
          placeholders={placeholders}
          fields={fields}
          mappings={mappings}
          onChange={onChange}
        />
        {!placeholders.length ? (
          <p className="text-sm text-muted-foreground">This template has no fillable placeholders.</p>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

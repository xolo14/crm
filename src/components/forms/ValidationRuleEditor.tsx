import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  VALIDATION_KIND_LABELS,
  VALIDATION_OPS,
  normalizeValidationRule,
  type ValidationKind,
  type ValidationRule,
} from "@/components/forms/formValidation";

type Props = {
  value?: ValidationRule | null;
  onChange: (next: ValidationRule | undefined) => void;
  /** When false, a "None" option is offered (default on). */
  allowNone?: boolean;
};

/** Google Forms-style response validation picker. */
export function ValidationRuleEditor({ value, onChange, allowNone = true }: Props) {
  const rule = normalizeValidationRule(value);
  const kind = (rule?.kind || (allowNone ? "" : "text")) as ValidationKind | "";
  const ops = kind ? VALIDATION_OPS[kind] : [];
  const opMeta = ops.find((o) => o.value === (rule?.op || ops[0]?.value));

  return (
    <div className="space-y-2">
      <Label className="text-xs">Response validation</Label>
      <Select
        value={kind || "none"}
        onValueChange={(v) => {
          if (v === "none") {
            onChange(undefined);
            return;
          }
          const nextKind = v as ValidationKind;
          const first = VALIDATION_OPS[nextKind][0];
          onChange({ kind: nextKind, op: first?.value, value: "", message: rule?.message });
        }}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          {allowNone ? <SelectItem value="none">None</SelectItem> : null}
          {(Object.keys(VALIDATION_KIND_LABELS) as ValidationKind[]).map((k) => (
            <SelectItem key={k} value={k}>
              {VALIDATION_KIND_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {kind ? (
        <>
          <Select
            value={String(rule?.op || ops[0]?.value || "")}
            onValueChange={(v) => onChange({ ...(rule || { kind }), kind, op: v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ops.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {opMeta?.needsValue ? (
            <Input
              className="h-8 text-xs"
              placeholder={opMeta.needsValue2 ? "From" : "Value"}
              value={rule?.value || ""}
              onChange={(e) => onChange({ ...(rule || { kind }), kind, value: e.target.value })}
            />
          ) : null}
          {opMeta?.needsValue2 ? (
            <Input
              className="h-8 text-xs"
              placeholder="To"
              value={rule?.value2 || ""}
              onChange={(e) => onChange({ ...(rule || { kind }), kind, value2: e.target.value })}
            />
          ) : null}
          <Input
            className="h-8 text-xs"
            placeholder="Custom error message (optional)"
            value={rule?.message || ""}
            onChange={(e) => onChange({ ...(rule || { kind }), kind, message: e.target.value })}
          />
        </>
      ) : null}
    </div>
  );
}

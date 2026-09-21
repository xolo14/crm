import type { DocFormField } from "@/modules/docForms/types";
import { PhoneNumberField } from "@/components/forms/PhoneNumberField";
import { MediaBlock } from "@/components/forms/MediaBlock";
import { StarRating } from "@/components/forms/StarRating";
import { inputTypeForRule } from "@/components/forms/formValidation";
import { looksLikeHtml, sanitizeFormDescriptionHtml, linkifyPlainText } from "@/components/forms/formDescriptionHtml";
import { seededShuffle } from "@/components/forms/formRuntime";

type Props = {
  field: DocFormField;
  value?: string;
  fileName?: string;
  disabled?: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onFile?: (file: File | null) => void;
  shuffleSeed?: string;
  error?: string;
};

function parseList(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* pipe-separated fallback */
  }
  return value.split("|").map((s) => s.trim()).filter(Boolean);
}

function toggleList(current: string, option: string, checked: boolean): string {
  const set = new Set(parseList(current));
  if (checked) set.add(option);
  else set.delete(option);
  return JSON.stringify(Array.from(set));
}

/** DOM id shared by the input and its <label htmlFor>. */
export function docFormFieldDomId(field: Pick<DocFormField, "id" | "key">): string {
  return `doc-field-${field.id || field.key}`;
}

function Hint({ text }: { text?: string }) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const html = looksLikeHtml(raw) ? sanitizeFormDescriptionHtml(raw) : linkifyPlainText(raw);
  return <p className="sp-form-hint" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function DocFormFieldInput({
  field,
  value = "",
  fileName,
  disabled,
  readOnly,
  onChange,
  onFile,
  shuffleSeed = "",
  error,
}: Props) {
  const locked = disabled || readOnly;
  const set = (next: string) => onChange?.(next);
  const id = docFormFieldDomId(field);
  const opts = field.shuffleOptions
    ? seededShuffle([...(field.options || [])], `${shuffleSeed}:${field.id}`)
    : field.options || [];

  if (field.type === "section_break") {
    return (
      <div className="pt-2">
        <p className="text-sm font-semibold">{field.label || "Section"}</p>
        {field.placeholder || field.description ? <Hint text={field.description || field.placeholder} /> : null}
      </div>
    );
  }

  if (field.type === "image" || field.type === "video") {
    return <MediaBlock kind={field.type} data={field.media || { url: field.placeholder || "" }} title={field.label} />;
  }

  if (field.type === "rating") {
    return (
      <>
        <StarRating
          id={id}
          value={value}
          onChange={set}
          max={field.ratingMax || field.scaleMax || 5}
          icon={field.ratingIcon || "star"}
          disabled={locked}
          name={id}
        />
        {error ? <p className="sp-form-error">{error}</p> : null}
      </>
    );
  }

  if (field.type === "textarea") {
    return (
      <>
        <textarea
          id={id}
          className="sp-form-input"
          rows={4}
          placeholder={field.placeholder || "Your answer"}
          value={value}
          disabled={locked}
          readOnly={readOnly}
          onChange={(e) => set(e.target.value)}
        />
        <Hint text={field.description} />
        {error ? <p className="sp-form-error">{error}</p> : null}
      </>
    );
  }

  if (field.type === "select") {
    return (
      <>
        <select id={id} className="sp-form-input" value={value} disabled={locked} onChange={(e) => set(e.target.value)}>
          <option value="">Select…</option>
          {opts.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {error ? <p className="sp-form-error">{error}</p> : null}
      </>
    );
  }

  if (field.type === "multiple_choice") {
    const isOther = value !== "" && !opts.includes(value);
    return (
      <>
        <div className="space-y-1.5">
          {opts.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input type="radio" name={id} checked={value === opt} disabled={locked} onChange={() => set(opt)} />
              <span>{opt}</span>
            </label>
          ))}
          {field.includeOther ? (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input type="radio" name={id} checked={isOther} disabled={locked} onChange={() => set(isOther ? value : "")} />
              <span>Other</span>
              <input
                className="sp-form-input"
                type="text"
                placeholder="Your answer"
                disabled={locked || !isOther}
                value={isOther ? value : ""}
                onChange={(e) => set(e.target.value)}
              />
            </label>
          ) : null}
        </div>
        {error ? <p className="sp-form-error">{error}</p> : null}
      </>
    );
  }

  if (field.type === "checkboxes") {
    const selected = parseList(value);
    const otherVal = selected.find((s) => !opts.includes(s)) || "";
    return (
      <>
        <div className="space-y-1.5">
          {opts.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                disabled={locked}
                onChange={(e) => set(toggleList(value, opt, e.target.checked))}
              />
              <span>{opt}</span>
            </label>
          ))}
          {field.includeOther ? (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!otherVal}
                disabled={locked}
                onChange={(e) => {
                  const next = parseList(value).filter((s) => opts.includes(s));
                  if (e.target.checked) next.push(otherVal || "");
                  set(JSON.stringify(next));
                }}
              />
              <span>Other</span>
              <input
                className="sp-form-input"
                type="text"
                placeholder="Your answer"
                disabled={locked || !otherVal}
                value={otherVal}
                onChange={(e) => {
                  const next = parseList(value).filter((s) => opts.includes(s));
                  if (e.target.value.trim()) next.push(e.target.value);
                  set(JSON.stringify(next));
                }}
              />
            </label>
          ) : null}
        </div>
        {error ? <p className="sp-form-error">{error}</p> : null}
      </>
    );
  }

  if (field.type === "linear_scale") {
    const min = field.scaleMin ?? 1;
    const max = field.scaleMax ?? 5;
    const points = Array.from({ length: Math.max(1, max - min + 1) }, (_, i) => min + i);
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {field.scaleMinLabel ? <span className="text-xs text-muted-foreground">{field.scaleMinLabel}</span> : null}
          {points.map((n) => (
            <label key={n} className="flex flex-col items-center text-xs">
              <input type="radio" name={id} checked={value === String(n)} disabled={locked} onChange={() => set(String(n))} />
              <span>{n}</span>
            </label>
          ))}
          {field.scaleMaxLabel ? <span className="text-xs text-muted-foreground">{field.scaleMaxLabel}</span> : null}
        </div>
        {error ? <p className="sp-form-error">{error}</p> : null}
      </>
    );
  }

  if (field.type === "mc_grid" || field.type === "checkbox_grid") {
    const rows = field.rows?.length ? field.rows : ["Row 1"];
    const cols = field.columns?.length ? field.columns : ["Column 1"];
    let grid: Record<string, string | string[]> = {};
    try {
      grid = value ? (JSON.parse(value) as Record<string, string | string[]>) : {};
    } catch {
      grid = {};
    }
    return (
      <>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th />
                {cols.map((c) => <th key={c} className="px-1 font-medium">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row}>
                  <th className="text-left pr-2 font-medium">{row}</th>
                  {cols.map((col) => {
                    if (field.type === "checkbox_grid") {
                      const rowVals = Array.isArray(grid[row]) ? grid[row] : [];
                      return (
                        <td key={col} className="text-center">
                          <input
                            type="checkbox"
                            checked={rowVals.includes(col)}
                            disabled={locked}
                            onChange={(e) => {
                              const next = new Set(rowVals);
                              if (e.target.checked) next.add(col);
                              else next.delete(col);
                              set(JSON.stringify({ ...grid, [row]: Array.from(next) }));
                            }}
                          />
                        </td>
                      );
                    }
                    return (
                      <td key={col} className="text-center">
                        <input
                          type="radio"
                          name={`${id}-${row}`}
                          checked={grid[row] === col}
                          disabled={locked}
                          onChange={() => set(JSON.stringify({ ...grid, [row]: col }))}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error ? <p className="sp-form-error">{error}</p> : null}
      </>
    );
  }

  if (field.type === "file_upload") {
    return (
      <div>
        <input
          id={id}
          type="file"
          className="sp-form-input"
          disabled={locked}
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.txt"
          onChange={(e) => onFile?.(e.target.files?.[0] ?? null)}
        />
        {fileName ? <p className="sp-form-hint">{fileName}</p> : null}
        {error ? <p className="sp-form-error">{error}</p> : null}
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <>
        <PhoneNumberField
          id={id}
          value={value}
          onChange={set}
          required={!!field.required}
          disabled={locked}
          placeholder={field.placeholder || "10-digit number"}
          publicStyle
        />
        {error ? <p className="sp-form-error">{error}</p> : null}
      </>
    );
  }

  const inputType =
    field.type === "email" || inputTypeForRule(field.validation) === "email" ? "email"
      : field.type === "date" ? "date"
        : field.type === "time" ? "time"
          : inputTypeForRule(field.validation);

  return (
    <>
      <input
        id={id}
        className="sp-form-input"
        type={inputType}
        placeholder={field.placeholder || "Your answer"}
        value={value}
        disabled={locked}
        readOnly={readOnly}
        onChange={(e) => set(e.target.value)}
      />
      <Hint text={field.description} />
      {error ? <p className="sp-form-error">{error}</p> : null}
    </>
  );
}

import type { BuilderQuestion, FormSection } from "@/components/forms/formBuilderTypes";
import { isEmailQuestion, questionFieldKey } from "@/components/forms/formBuilderTypes";
import { PhoneNumberField } from "@/components/forms/PhoneNumberField";
import { MediaBlock } from "@/components/forms/MediaBlock";
import { StarRating } from "@/components/forms/StarRating";
import { inputTypeForRule } from "@/components/forms/formValidation";
import { looksLikeHtml, sanitizeFormDescriptionHtml, linkifyPlainText } from "@/components/forms/formDescriptionHtml";
import { seededShuffle } from "@/components/forms/formRuntime";

type Props = {
  sections: FormSection[];
  values: Record<string, string>;
  files?: Record<string, File | null>;
  onChange: (key: string, value: string) => void;
  onFileChange?: (key: string, file: File | null) => void;
  disabled?: boolean;
  errors?: Record<string, string>;
  shuffleSeed?: string;
};

function parseCheckboxValue(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* legacy pipe-separated */
  }
  return value.split("|").map((s) => s.trim()).filter(Boolean);
}

function toggleCheckboxValue(current: string, option: string, checked: boolean): string {
  const set = new Set(parseCheckboxValue(current));
  if (checked) set.add(option);
  else set.delete(option);
  return JSON.stringify(Array.from(set));
}

function Hint({ text }: { text?: string }) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const html = looksLikeHtml(raw) ? sanitizeFormDescriptionHtml(raw) : linkifyPlainText(raw);
  return <p className="sp-form-hint" dangerouslySetInnerHTML={{ __html: html }} />;
}

function optionList(q: BuilderQuestion, seed: string): string[] {
  const opts = [...(q.options || [])];
  if (q.shuffleOptions || (q.validation?.kind === "text" && q.validation?.value === "shuffle")) {
    return seededShuffle(opts, `${seed}:${q.id}`);
  }
  return opts;
}

function renderQuestionInput(
  q: BuilderQuestion,
  key: string,
  value: string,
  file: File | null | undefined,
  onChange: (key: string, value: string) => void,
  onFileChange?: (key: string, file: File | null) => void,
  disabled?: boolean,
  seed = "",
) {
  const common = {
    className: "sp-form-input",
    disabled,
    required: !!q.required,
  };
  const inputId = `field-${q.id}`;

  if (q.type === "image" || q.type === "video") {
    return <MediaBlock kind={q.type} data={q.media || { url: "" }} title={q.title} />;
  }

  if (q.type === "rating") {
    return (
      <StarRating
        id={inputId}
        value={value}
        onChange={(v) => onChange(key, v)}
        max={q.ratingMax || q.scaleMax || 5}
        icon={q.ratingIcon || "star"}
        disabled={disabled}
        name={key}
      />
    );
  }

  if (q.type === "file_upload") {
    return (
      <div className="sp-form-file-wrap">
        <input
          id={inputId}
          type="file"
          className="sp-form-input sp-form-file"
          disabled={disabled}
          required={!!q.required && !file}
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
          onChange={(e) => onFileChange?.(key, e.target.files?.[0] ?? null)}
        />
        {file ? <p className="sp-form-file-name">{file.name}</p> : null}
        <Hint text={q.description} />
      </div>
    );
  }

  if (q.type === "paragraph") {
    return (
      <textarea
        {...common}
        id={inputId}
        rows={4}
        placeholder={q.description && !looksLikeHtml(q.description) ? q.description : "Your answer"}
        value={value}
        onChange={(e) => onChange(key, e.target.value)}
      />
    );
  }

  if (q.type === "dropdown") {
    return (
      <select {...common} id={inputId} value={value} onChange={(e) => onChange(key, e.target.value)}>
        <option value="">{q.description && !looksLikeHtml(q.description) ? q.description : `Select ${q.title}`}</option>
        {optionList(q, seed).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (q.type === "multiple_choice") {
    const opts = optionList(q, seed);
    const isOther = value !== "" && !opts.includes(value);
    return (
      <div className="sp-form-choice-list" role="radiogroup" aria-labelledby={`label-${q.id}`}>
        {opts.map((opt) => (
          <label key={opt} className="sp-form-choice">
            <input
              type="radio"
              name={key}
              value={opt}
              checked={value === opt}
              disabled={disabled}
              required={!!q.required && !value}
              onChange={() => onChange(key, opt)}
            />
            <span>{opt}</span>
          </label>
        ))}
        {q.includeOther ? (
          <label className="sp-form-choice sp-form-choice-other">
            <input
              type="radio"
              name={key}
              value="__other__"
              checked={isOther}
              disabled={disabled}
              onChange={() => onChange(key, isOther ? value : "")}
            />
            <span>Other</span>
            <input
              className="sp-form-input sp-form-other-input"
              type="text"
              placeholder="Your answer"
              disabled={disabled || !isOther}
              value={isOther ? value : ""}
              onChange={(e) => onChange(key, e.target.value)}
            />
          </label>
        ) : null}
      </div>
    );
  }

  if (q.type === "checkboxes") {
    const selected = parseCheckboxValue(value);
    const opts = optionList(q, seed);
    const otherVal = selected.find((s) => !opts.includes(s)) || "";
    return (
      <div className="sp-form-choice-list">
        {opts.map((opt) => (
          <label key={opt} className="sp-form-choice">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              disabled={disabled}
              onChange={(e) => onChange(key, toggleCheckboxValue(value, opt, e.target.checked))}
            />
            <span>{opt}</span>
          </label>
        ))}
        {q.includeOther ? (
          <label className="sp-form-choice sp-form-choice-other">
            <input
              type="checkbox"
              checked={!!otherVal}
              disabled={disabled}
              onChange={(e) => {
                const next = parseCheckboxValue(value).filter((s) => opts.includes(s));
                if (e.target.checked) next.push(otherVal || "");
                onChange(key, JSON.stringify(next));
              }}
            />
            <span>Other</span>
            <input
              className="sp-form-input sp-form-other-input"
              type="text"
              placeholder="Your answer"
              disabled={disabled || !otherVal}
              value={otherVal}
              onChange={(e) => {
                const next = parseCheckboxValue(value).filter((s) => opts.includes(s));
                if (e.target.value.trim()) next.push(e.target.value);
                onChange(key, JSON.stringify(next));
              }}
            />
          </label>
        ) : null}
      </div>
    );
  }

  if (q.type === "linear_scale") {
    const min = q.scaleMin ?? 1;
    const max = q.scaleMax ?? 5;
    const points = Array.from({ length: Math.max(1, max - min + 1) }, (_, i) => min + i);
    return (
      <div className="sp-form-scale">
        {q.scaleMinLabel ? <span className="sp-form-scale-label">{q.scaleMinLabel}</span> : null}
        <div className="sp-form-scale-options">
          {points.map((n) => (
            <label key={n} className="sp-form-scale-opt">
              <input
                type="radio"
                name={key}
                value={String(n)}
                checked={value === String(n)}
                disabled={disabled}
                required={!!q.required && !value}
                onChange={() => onChange(key, String(n))}
              />
              <span>{n}</span>
            </label>
          ))}
        </div>
        {q.scaleMaxLabel ? <span className="sp-form-scale-label">{q.scaleMaxLabel}</span> : null}
      </div>
    );
  }

  if (q.type === "mc_grid" || q.type === "checkbox_grid") {
    const rows = q.rows?.length ? q.rows : ["Row 1"];
    const cols = q.columns?.length ? q.columns : ["Column 1"];
    let grid: Record<string, string | string[]> = {};
    try {
      grid = value ? (JSON.parse(value) as Record<string, string | string[]>) : {};
    } catch {
      grid = {};
    }
    return (
      <div className="sp-form-grid-wrap">
        <table className="sp-form-grid">
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <th scope="row">{row}</th>
                {cols.map((col) => {
                  if (q.type === "checkbox_grid") {
                    const rowVals = Array.isArray(grid[row]) ? grid[row] : [];
                    return (
                      <td key={col}>
                        <input
                          type="checkbox"
                          checked={rowVals.includes(col)}
                          disabled={disabled}
                          onChange={(e) => {
                            const next = Array.isArray(grid[row]) ? [...grid[row]] : [];
                            if (e.target.checked) next.push(col);
                            else {
                              const i = next.indexOf(col);
                              if (i >= 0) next.splice(i, 1);
                            }
                            onChange(key, JSON.stringify({ ...grid, [row]: next }));
                          }}
                        />
                      </td>
                    );
                  }
                  return (
                    <td key={col}>
                      <input
                        type="radio"
                        name={`${key}-${row}`}
                        checked={grid[row] === col}
                        disabled={disabled}
                        onChange={() => onChange(key, JSON.stringify({ ...grid, [row]: col }))}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (q.type === "date") {
    return <input {...common} id={inputId} type="date" value={value} onChange={(e) => onChange(key, e.target.value)} />;
  }

  if (q.type === "time") {
    return <input {...common} id={inputId} type="time" value={value} onChange={(e) => onChange(key, e.target.value)} />;
  }

  if (q.type === "phone_number") {
    return (
      <PhoneNumberField
        id={inputId}
        value={value}
        onChange={(v) => onChange(key, v)}
        required={!!q.required}
        disabled={disabled}
        placeholder={q.description && !looksLikeHtml(q.description) ? q.description : "10-digit number"}
        publicStyle
      />
    );
  }

  const inputType = isEmailQuestion(q) ? "email" : inputTypeForRule(q.validation);
  return (
    <input
      {...common}
      id={inputId}
      type={inputType}
      placeholder={q.description && !looksLikeHtml(q.description) ? q.description : "Your answer"}
      value={value}
      onChange={(e) => onChange(key, e.target.value)}
    />
  );
}

export function PublicFormFields({ sections, values, files, onChange, onFileChange, disabled, errors, shuffleSeed = "" }: Props) {
  let fieldIndex = 0;

  return (
    <>
      {sections.map((section) => (
        <section key={section.id} className="sp-form-section">
          {section.title ? <h3 className="sp-form-section-title">{section.title}</h3> : null}
          {section.description ? (
            looksLikeHtml(section.description) ? (
              <div
                className="sp-form-section-desc"
                dangerouslySetInnerHTML={{ __html: sanitizeFormDescriptionHtml(section.description) }}
              />
            ) : (
              <p className="sp-form-section-desc" dangerouslySetInnerHTML={{ __html: linkifyPlainText(section.description) }} />
            )
          ) : null}
          {section.questions.map((q) => {
            const key = questionFieldKey(q, fieldIndex);
            fieldIndex += 1;
            const isMedia = q.type === "image" || q.type === "video";
            return (
              <div className="sp-form-group" key={q.id}>
                {!isMedia ? (
                  <label className="sp-form-label" id={`label-${q.id}`} htmlFor={`field-${q.id}`}>
                    {q.title}
                    {q.required ? <span className="sp-form-required"> *</span> : null}
                  </label>
                ) : null}
                {q.description && q.type !== "file_upload" && q.type !== "paragraph" && q.type !== "dropdown" && q.type !== "phone_number" && q.type !== "short_answer" ? (
                  <Hint text={q.description} />
                ) : null}
                {renderQuestionInput(q, key, values[key] || "", files?.[key], onChange, onFileChange, disabled, shuffleSeed)}
                {errors?.[key] ? <p className="sp-form-error">{errors[key]}</p> : null}
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}

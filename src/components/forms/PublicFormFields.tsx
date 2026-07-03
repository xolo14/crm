import type { BuilderQuestion, FormSection } from "@/components/forms/formBuilderTypes";
import { isEmailQuestion, questionFieldKey } from "@/components/forms/formBuilderTypes";

type Props = {
  sections: FormSection[];
  values: Record<string, string>;
  files?: Record<string, File | null>;
  onChange: (key: string, value: string) => void;
  onFileChange?: (key: string, file: File | null) => void;
  disabled?: boolean;
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

function renderQuestionInput(
  q: BuilderQuestion,
  key: string,
  value: string,
  file: File | null | undefined,
  onChange: (key: string, value: string) => void,
  onFileChange?: (key: string, file: File | null) => void,
  disabled?: boolean,
) {
  const common = {
    className: "sp-form-input",
    disabled,
    required: !!q.required,
  };
  const inputId = `field-${q.id}`;

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
        {q.description ? <p className="sp-form-hint">{q.description}</p> : null}
      </div>
    );
  }

  if (q.type === "paragraph") {
    return (
      <textarea
        {...common}
        id={inputId}
        rows={4}
        placeholder={q.description || "Your answer"}
        value={value}
        onChange={(e) => onChange(key, e.target.value)}
      />
    );
  }

  if (q.type === "dropdown") {
    return (
      <select
        {...common}
        id={inputId}
        value={value}
        onChange={(e) => onChange(key, e.target.value)}
      >
        <option value="">{q.description || `Select ${q.title}`}</option>
        {(q.options || []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (q.type === "multiple_choice") {
    return (
      <div className="sp-form-choice-list" role="radiogroup" aria-labelledby={`label-${q.id}`}>
        {(q.options || []).map((opt) => (
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
              checked={value !== "" && !(q.options || []).includes(value)}
              disabled={disabled}
              onChange={() => onChange(key, "")}
            />
            <span>Other</span>
            <input
              className="sp-form-input sp-form-other-input"
              type="text"
              placeholder="Your answer"
              disabled={disabled || (q.options || []).includes(value)}
              value={(q.options || []).includes(value) ? "" : value}
              onChange={(e) => onChange(key, e.target.value)}
            />
          </label>
        ) : null}
      </div>
    );
  }

  if (q.type === "checkboxes") {
    const selected = parseCheckboxValue(value);
    return (
      <div className="sp-form-choice-list">
        {(q.options || []).map((opt) => (
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
      </div>
    );
  }

  if (q.type === "linear_scale") {
    const min = q.scaleMin ?? 1;
    const max = q.scaleMax ?? 5;
    const points = Array.from({ length: max - min + 1 }, (_, i) => min + i);
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
    const rows = q.rows || ["Row 1"];
    const cols = q.columns || ["Column 1"];
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
                    const checked = rowVals.includes(col);
                    return (
                      <td key={col}>
                        <input
                          type="checkbox"
                          checked={checked}
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
    return (
      <input
        {...common}
        id={inputId}
        type="date"
        value={value}
        onChange={(e) => onChange(key, e.target.value)}
      />
    );
  }

  if (q.type === "time") {
    return (
      <input
        {...common}
        id={inputId}
        type="time"
        value={value}
        onChange={(e) => onChange(key, e.target.value)}
      />
    );
  }

  const inputType =
    isEmailQuestion(q)
      ? "email"
      : q.validation?.kind === "number"
        ? "number"
        : "text";

  return (
    <input
      {...common}
      id={inputId}
      type={inputType}
      placeholder={q.description || "Your answer"}
      value={value}
      onChange={(e) => onChange(key, e.target.value)}
    />
  );
}

export function PublicFormFields({ sections, values, files, onChange, onFileChange, disabled }: Props) {
  let fieldIndex = 0;

  return (
    <>
      {sections.map((section) => (
        <section key={section.id} className="sp-form-section">
          {section.title ? (
            <h3 className="sp-form-section-title">{section.title}</h3>
          ) : null}
          {section.description ? (
            <p className="sp-form-section-desc">{section.description}</p>
          ) : null}
          {section.questions.map((q) => {
            const key = questionFieldKey(q, fieldIndex);
            fieldIndex += 1;
            return (
              <div className="sp-form-group" key={q.id}>
                <label className="sp-form-label" id={`label-${q.id}`} htmlFor={`field-${q.id}`}>
                  {q.title}
                  {q.required ? <span className="sp-form-required"> *</span> : null}
                </label>
                {renderQuestionInput(
                  q,
                  key,
                  values[key] || "",
                  files?.[key],
                  onChange,
                  onFileChange,
                  disabled,
                )}
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}

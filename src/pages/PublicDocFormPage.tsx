import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { getApiBase } from "@/lib/apiBase";
import { useToast } from "@/hooks/use-toast";
import { PublicFormShell } from "@/components/forms/PublicFormShell";
import { publicBrandFromDocMeta } from "@/modules/docForms/docFormBrand";
import type { DocFormField } from "@/modules/docForms/types";

type PublicDocForm = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  form_type: string;
  fields_json: DocFormField[];
  meta_json?: Record<string, unknown> | null;
};

export default function PublicDocFormPage() {
  const { slug: slugParam } = useParams();
  const slug = String(slugParam || "").trim().toLowerCase();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PublicDocForm | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const apiBase = useMemo(() => getApiBase(), []);
  const brand = useMemo(() => publicBrandFromDocMeta(form?.meta_json), [form?.meta_json]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!slug) {
        setError("Missing form link.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${apiBase}/public-doc-form.php?slug=${encodeURIComponent(slug)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "Form not found");
        }
        const row = data?.data as PublicDocForm | undefined;
        if (!row?.id) throw new Error("Form not found");
        if (!mounted) return;
        setForm(row);
        const init: Record<string, string> = {};
        (row.fields_json || []).forEach((f) => {
          init[f.key] = "";
        });
        setValues(init);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Could not load form");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [apiBase, slug]);

  const submit = async () => {
    if (!form) return;
    for (const f of form.fields_json || []) {
      if (f.required && !String(values[f.key] || "").trim()) {
        toast({ variant: "destructive", title: `${f.label} is required` });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/public-doc-form.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: form.slug,
          form_id: form.id,
          answers: values,
          values,
          respondent_name: values.candidate_name || values.name || "",
          respondent_email: values.recipient_email || values.email || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Submit failed");
      }
      setDone(true);
      toast({ title: "Submitted", description: "Thank you. Your details were received." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Submit failed", description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: brand.formBg }}>
        <Loader2 className="h-7 w-7 animate-spin opacity-60" />
      </div>
    );
  }

  if (error || !form) {
    return (
      <PublicFormShell fullPage brand={brand} formTitle="Form unavailable" formDescription={error || "This form link is invalid or inactive."}>
        <section className="sp-form-section">
          <p className="sp-form-hint">Check the link or ask the sender for an updated form URL.</p>
        </section>
      </PublicFormShell>
    );
  }

  if (done) {
    return (
      <PublicFormShell
        fullPage
        brand={brand}
        formTitle="Thank you"
        formDescription={`Your response for “${form.name}” was submitted successfully.`}
      >
        <section className="sp-form-section">
          <p className="sp-form-hint">You can close this page.</p>
        </section>
      </PublicFormShell>
    );
  }

  return (
    <PublicFormShell
      fullPage
      brand={brand}
      formTitle={form.name}
      formDescription={form.description || "Fill in your details to submit this form."}
    >
      <section className="sp-form-section">
        {(form.fields_json || []).map((f) => (
          <div key={f.id || f.key} className="sp-form-group">
            <label className="sp-form-label" htmlFor={`doc-field-${f.key}`}>
              {f.label}
              {f.required ? <span className="sp-form-required"> *</span> : null}
            </label>
            {f.type === "textarea" ? (
              <textarea
                id={`doc-field-${f.key}`}
                className="sp-form-input"
                rows={3}
                placeholder={f.placeholder || ""}
                value={values[f.key] || ""}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            ) : f.type === "select" && Array.isArray(f.options) && f.options.length > 0 ? (
              <select
                id={`doc-field-${f.key}`}
                className="sp-form-input"
                value={values[f.key] || ""}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
              >
                <option value="">Select…</option>
                {f.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`doc-field-${f.key}`}
                className="sp-form-input"
                type={f.type === "email" ? "email" : f.type === "date" ? "date" : "text"}
                placeholder={f.placeholder || ""}
                value={values[f.key] || ""}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </section>
      <button type="button" className="sp-form-submit" onClick={() => void submit()} disabled={saving}>
        {saving ? "Submitting…" : "Submit"}
      </button>
    </PublicFormShell>
  );
}

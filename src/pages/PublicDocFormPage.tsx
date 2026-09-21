import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { getApiBase } from "@/lib/apiBase";
import { useToast } from "@/hooks/use-toast";
import { PublicFormShell } from "@/components/forms/PublicFormShell";
import { publicBrandFromDocMeta } from "@/modules/docForms/docFormBrand";
import DocFormFieldInput, { docFormFieldDomId } from "@/modules/docForms/DocFormFieldInput";
import {
  docFormFieldIsContent,
  docFormValueForSubmit,
  docFormValueIsEmpty,
  ensureUniqueDocFormKeys,
  type DocFormField,
} from "@/modules/docForms/types";
import { validateAnswer } from "@/components/forms/formValidation";
import { resolveNextSection, splitIntoSections } from "@/components/forms/sectionFlow";
import { readPrefillFromSearch } from "@/components/forms/formPrefill";
import {
  formClosedReason,
  hasLocalOneResponse,
  markLocalOneResponse,
  quizScore,
  seededShuffle,
} from "@/components/forms/formRuntime";
import { parseFormMetaJson } from "@/components/forms/publicFormTypes";
import { setPageMeta, SEO_CRM_ORIGIN } from "@/lib/seo";

type PublicDocForm = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  form_type: string;
  fields_json: DocFormField[];
  meta_json?: Record<string, unknown> | null;
  submission_count?: number;
};

export default function PublicDocFormPage() {
  const { slug: slugParam } = useParams();
  const [searchParams] = useSearchParams();
  const slug = String(slugParam || "").trim().toLowerCase();
  const refs = searchParams.getAll("ref").map((r) => r.trim()).filter(Boolean);
  const staffRef = refs.length ? refs[refs.length - 1] : "";
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PublicDocForm | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sectionIdx, setSectionIdx] = useState(0);
  const [history, setHistory] = useState<number[]>([0]);
  const [quiz, setQuiz] = useState<{ earned: number; total: number } | null>(null);

  const apiBase = useMemo(() => getApiBase(), []);
  const brand = useMemo(() => publicBrandFromDocMeta(form?.meta_json), [form?.meta_json]);
  const meta = useMemo(() => parseFormMetaJson(form?.meta_json), [form?.meta_json]);
  const fields = useMemo(
    () => ensureUniqueDocFormKeys(Array.isArray(form?.fields_json) ? form!.fields_json : []).fields,
    [form],
  );
  const shuffleSeed = `${form?.id || slug}:${staffRef}`;
  const orderedFields = useMemo(() => {
    if (!meta.shuffle_questions) return fields;
    const breaks = fields.filter((f) => f.type === "section_break");
    const rest = fields.filter((f) => f.type !== "section_break");
    return [...breaks, ...seededShuffle(rest, shuffleSeed)];
  }, [fields, meta.shuffle_questions, shuffleSeed]);

  const sections = useMemo(
    () =>
      splitIntoSections(orderedFields, {
        isBreak: (f) => f.type === "section_break",
        id: (f) => f.id,
        title: (f) => f.label,
        description: (f) => f.description || f.placeholder,
      }),
    [orderedFields],
  );

  const current = sections[sectionIdx];
  const showProgress = !!meta.show_progress_bar && sections.length > 1;
  const progressPct = sections.length ? Math.round(((sectionIdx + 1) / sections.length) * 100) : 100;
  const closed = formClosedReason({ ...meta, submission_count: form?.submission_count });
  const oneResponseBlocked = !meta.allow_multiple_responses && form?.id ? hasLocalOneResponse(form.id) : false;
  const thankYou = String(meta.confirmation_message || "").trim();

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
        const unique = ensureUniqueDocFormKeys(Array.isArray(row.fields_json) ? row.fields_json : []).fields;
        const init: Record<string, string> = {};
        unique.forEach((f) => {
          init[f.key] = "";
        });
        const prefill = readPrefillFromSearch(window.location.search, unique.map((f) => f.key));
        setValues({ ...init, ...prefill });
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

  useEffect(() => {
    if (!form?.slug) return;
    const title = String(form.name || "Form").trim() || "Form";
    const description =
      String(form.description || "").trim() ||
      "Submit this form securely via Syncpedia CRM.";
    setPageMeta({
      title: `${title} — Syncpedia`,
      description,
      canonical: `${SEO_CRM_ORIGIN}/doc-form/${encodeURIComponent(form.slug)}`,
      robots: "index, follow",
      ogImage: `${SEO_CRM_ORIGIN}/api/public-og-image.php?doc=${encodeURIComponent(form.slug)}`,
    });
  }, [form?.slug, form?.name, form?.description]);

  const validateVisible = (items: DocFormField[]): boolean => {
    const nextErr: Record<string, string> = {};
    for (const f of items) {
      if (docFormFieldIsContent(f.type)) continue;
      if (f.type === "file_upload") {
        if (f.required && !files[f.key]) nextErr[f.key] = `${f.label} is required`;
        continue;
      }
      if (f.required && docFormValueIsEmpty(f, values[f.key])) {
        nextErr[f.key] = `${f.label} is required`;
        continue;
      }
      const vErr = validateAnswer(f.validation, values[f.key] || "");
      if (vErr) nextErr[f.key] = vErr;
    }
    setFieldErrors(nextErr);
    const first = Object.keys(nextErr)[0];
    if (first) {
      const field = items.find((f) => f.key === first);
      if (field) document.getElementById(docFormFieldDomId(field))?.focus();
      toast({ variant: "destructive", title: nextErr[first] });
      return false;
    }
    return true;
  };

  const goNext = () => {
    if (!current) return;
    if (!validateVisible(current.items)) return;
    const nxt = resolveNextSection(sections, sectionIdx, (item) => {
      if (item.type !== "multiple_choice" && item.type !== "select") return null;
      const ans = String(values[item.key] || "").trim();
      if (!ans || !item.goTo) return null;
      return item.goTo[ans] || item.goTo.__default || null;
    });
    if (nxt === "submit") {
      void submit();
      return;
    }
    setSectionIdx(nxt);
    setHistory((h) => [...h, nxt]);
  };

  const goBack = () => {
    setHistory((h) => {
      if (h.length <= 1) return h;
      const next = h.slice(0, -1);
      setSectionIdx(next[next.length - 1]);
      return next;
    });
  };

  const submit = async () => {
    if (!form) return;
    const visited = new Set(history.map((i) => sections[i]?.id));
    const toCheck = orderedFields.filter((f) => {
      if (docFormFieldIsContent(f.type)) return false;
      if (sections.length <= 1) return true;
      const sec = sections.find((s) => s.items.some((it) => it.id === f.id));
      return !sec || visited.has(sec.id) || sec.id === "section-default";
    });
    if (!validateVisible(toCheck)) return;
    setSaving(true);
    try {
      const payload: Record<string, string> = { ...values };
      for (const f of fields) {
        if (docFormFieldIsContent(f.type) || f.type === "file_upload") continue;
        payload[f.key] = docFormValueForSubmit(f, values[f.key]);
      }
      const hasFile = Object.values(files).some(Boolean);
      let res: Response;
      const common = {
        slug: form.slug,
        form_id: form.id,
        answers: payload,
        values: payload,
        respondent_name: payload.candidate_name || payload.name || "",
        respondent_email: payload.recipient_email || payload.email || "",
        referred_by: staffRef,
      };
      if (hasFile) {
        const fd = new FormData();
        Object.entries(common).forEach(([k, v]) => {
          fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
        });
        for (const [key, file] of Object.entries(files)) {
          if (file) fd.append(`file_${key}`, file);
        }
        res = await fetch(`${apiBase}/public-doc-form.php`, { method: "POST", body: fd });
      } else {
        res = await fetch(`${apiBase}/public-doc-form.php`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(common),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Submit failed");
      }
      if (!meta.allow_multiple_responses) markLocalOneResponse(form.id);
      if (meta.is_quiz) {
        setQuiz(
          quizScore(toCheck, (item) => !docFormValueIsEmpty(item, values[item.key]) || !!files[item.key]),
        );
      }
      setDone(true);
      toast({ title: "Submitted", description: thankYou || "Thank you. Your details were received." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Submit failed", description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  const resetForAnother = () => {
    const init: Record<string, string> = {};
    fields.forEach((f) => {
      init[f.key] = "";
    });
    setValues(init);
    setFiles({});
    setDone(false);
    setQuiz(null);
    setSectionIdx(0);
    setHistory([0]);
    setFieldErrors({});
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

  if (closed || oneResponseBlocked) {
    return (
      <PublicFormShell
        fullPage
        brand={brand}
        formTitle={form.name}
        formDescription={closed || "You have already submitted a response to this form."}
      >
        <section className="sp-form-section">
          <p className="sp-form-hint">This form is not accepting another response from this browser.</p>
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
        formDescription={thankYou || `Your response for “${form.name}” was submitted successfully.`}
      >
        <section className="sp-form-section">
          {quiz && quiz.total > 0 ? (
            <p className="sp-form-hint">Score: {quiz.earned} / {quiz.total}</p>
          ) : (
            <p className="sp-form-hint">You can close this page.</p>
          )}
          {meta.edit_after_submit ? (
            <button type="button" className="sp-form-submit" style={{ marginTop: 12 }} onClick={() => setDone(false)}>
              Edit answers
            </button>
          ) : null}
          {meta.allow_another_response !== false && meta.allow_multiple_responses !== false ? (
            <button type="button" className="sp-form-submit" style={{ marginTop: 12 }} onClick={resetForAnother}>
              Submit another response
            </button>
          ) : null}
        </section>
      </PublicFormShell>
    );
  }

  const lastSection = sectionIdx >= sections.length - 1;
  const items = current?.items || orderedFields;

  return (
    <PublicFormShell
      fullPage
      brand={brand}
      formTitle={form.name}
      formDescription={form.description || "Fill in your details to submit this form."}
    >
      {showProgress ? (
        <div className="sp-form-progress" aria-hidden>
          <div className="sp-form-progress-bar" style={{ width: `${progressPct}%` }} />
        </div>
      ) : null}
      <section className="sp-form-section">
        {current?.title && current.breakIndex >= 0 ? <h3 className="sp-form-section-title">{current.title}</h3> : null}
        {items.map((f, idx) => (
          <div key={f.id || `${f.key}-${idx}`} className="sp-form-group">
            {f.type !== "section_break" && f.type !== "image" && f.type !== "video" ? (
              <label className="sp-form-label" htmlFor={docFormFieldDomId(f)}>
                {f.label}
                {f.required ? <span className="sp-form-required"> *</span> : null}
              </label>
            ) : null}
            <DocFormFieldInput
              field={f}
              value={values[f.key] || ""}
              fileName={files[f.key]?.name}
              shuffleSeed={shuffleSeed}
              error={fieldErrors[f.key]}
              onChange={(next) => setValues((p) => ({ ...p, [f.key]: next }))}
              onFile={(file) => setFiles((p) => ({ ...p, [f.key]: file }))}
            />
          </div>
        ))}
      </section>
      <div className="sp-form-nav">
        {history.length > 1 ? (
          <button type="button" className="sp-form-submit" style={{ background: "transparent", color: "inherit", border: "1px solid currentColor" }} onClick={goBack}>
            Back
          </button>
        ) : null}
        <button
          type="button"
          className="sp-form-submit"
          onClick={() => (lastSection && !items.some((f) => f.goTo && Object.keys(f.goTo).length) ? void submit() : goNext())}
          disabled={saving}
        >
          {saving ? "Submitting…" : lastSection ? "Submit" : "Next"}
        </button>
      </div>
    </PublicFormShell>
  );
}

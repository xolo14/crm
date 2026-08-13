import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import type { DocForm, DocFormField } from "@/modules/docForms/types";

export default function MyDocFormsPage() {
  const { toast } = useToast();
  const [forms, setForms] = useState<DocForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<DocForm | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.docForms.list({ scope: "assigned" });
      setForms((((res as any).data || []) as DocForm[]));
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not load forms", description: e?.message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (f: DocForm) => {
    setActive(f);
    const init: Record<string, string> = {};
    (f.fields_json || []).forEach((field: DocFormField) => {
      init[field.key] = "";
    });
    setValues(init);
  };

  const submit = async () => {
    if (!active) return;
    for (const f of active.fields_json || []) {
      if (f.required && !String(values[f.key] || "").trim()) {
        toast({ variant: "destructive", title: `${f.label} is required` });
        return;
      }
    }
    setSaving(true);
    try {
      await api.docForms.submit({
        form_id: active.id,
        answers: values,
        values,
        respondent_name: values.candidate_name || values.name || "",
        respondent_email: values.recipient_email || values.email || "",
      });
      toast({ title: "Submitted" });
      setActive(null);
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Submit failed", description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (active) {
    return (
      <div className="p-4 md:p-8 max-w-xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setActive(null)}>Back</Button>
        <Card>
          <CardHeader>
            <CardTitle>{active.name}</CardTitle>
            <CardDescription>{active.description || "Fill and submit"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(active.fields_json || []).map((f) => (
              <div key={f.id}>
                <Label className="text-xs">
                  {f.label}
                  {f.required ? " *" : ""}
                </Label>
                {f.type === "textarea" ? (
                  <Textarea rows={3} value={values[f.key] || ""} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))} />
                ) : (
                  <Input
                    type={f.type === "email" ? "email" : f.type === "date" ? "date" : "text"}
                    value={values[f.key] || ""}
                    onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Submit
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">My Document Forms</h1>
        <p className="text-sm text-muted-foreground">Forms assigned to you for offer letters or certificates.</p>
      </div>
      {forms.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No forms assigned to you.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((f) => (
            <Card key={f.id} className="cursor-pointer hover:shadow-md" onClick={() => open(f)}>
              <CardHeader>
                <CardTitle className="text-base">{f.name}</CardTitle>
                <CardDescription className="text-xs capitalize">{f.form_type.replace("_", " ")}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

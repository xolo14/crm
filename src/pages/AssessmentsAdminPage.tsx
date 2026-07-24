import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Copy, ExternalLink, Plus, Trash2 } from "lucide-react";
import {
  assessmentsApi,
  type PeaklyyAssessment,
  type PeaklyyCustomQuestionInput,
  type PeaklyySourceMode,
} from "@/services/assessments";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

function emptyMcq(): PeaklyyCustomQuestionInput {
  return {
    q_type: "mcq",
    prompt: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct_option: "a",
    points: 5,
  };
}

export default function AssessmentsAdminPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "Peaklyy Domain Screening",
    duration_minutes: 15,
    question_count: 15,
    result_webhook_url: "",
    once_per_candidate: true,
    anti_cheat: true,
    source_mode: "domain_bank" as PeaklyySourceMode,
  });
  const [customQuestions, setCustomQuestions] = useState<PeaklyyCustomQuestionInput[]>([emptyMcq()]);

  const { data, isLoading } = useQuery({
    queryKey: ["peaklyy", "assessments"],
    queryFn: assessmentsApi.list,
  });
  const list = data?.data ?? [];
  const domains = data?.domains ?? {};

  const selected = useMemo(
    () => list.find((a) => a.id === selectedId) || list[0] || null,
    [list, selectedId],
  );

  const { data: attemptsRes } = useQuery({
    queryKey: ["peaklyy", "attempts", selected?.id],
    queryFn: () => assessmentsApi.attempts(selected!.id),
    enabled: !!selected?.id,
  });

  const createMut = useMutation({
    mutationFn: () => {
      if (form.source_mode === "custom") {
        const cleaned = customQuestions
          .map((q) => ({
            ...q,
            q_type: "mcq" as const,
            prompt: q.prompt.trim(),
          }))
          .filter((q) => q.prompt.length > 0);
        if (cleaned.length < 1) {
          return Promise.reject(new Error("Add at least one MCQ with a prompt"));
        }
        for (const q of cleaned) {
          if (![q.option_a, q.option_b, q.option_c, q.option_d].every((o) => (o || "").trim())) {
            return Promise.reject(new Error("Each MCQ needs options A–D filled in"));
          }
        }
        return assessmentsApi.create({
          title: form.title,
          duration_minutes: form.duration_minutes,
          question_count: cleaned.length,
          result_webhook_url: form.result_webhook_url || null,
          once_per_candidate: form.once_per_candidate,
          anti_cheat: form.anti_cheat,
          source_mode: "custom",
          questions: cleaned,
        });
      }
      return assessmentsApi.create({
        title: form.title,
        duration_minutes: form.duration_minutes,
        question_count: form.question_count,
        result_webhook_url: form.result_webhook_url || null,
        once_per_candidate: form.once_per_candidate,
        anti_cheat: form.anti_cheat,
        source_mode: "domain_bank",
      });
    },
    onSuccess: (r) => {
      toast({
        title: "Assessment created",
        description: `${r.source_mode === "custom" ? "Custom" : "Domain bank"} · permanent API key · ${r.duration_minutes} min · ${r.question_count} questions`,
      });
      qc.invalidateQueries({ queryKey: ["peaklyy"] });
      setSelectedId(r.id);
      if (form.source_mode === "custom") {
        setCustomQuestions([emptyMcq()]);
      }
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const regenMut = useMutation({
    mutationFn: (id: string) => assessmentsApi.regenerateApiKey(id),
    onSuccess: (r) => {
      toast({ title: "API key regenerated" });
      qc.invalidateQueries({ queryKey: ["peaklyy"] });
      void navigator.clipboard.writeText(r.result_api_key);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const updateMut = useMutation({
    mutationFn: (body: Partial<PeaklyyAssessment> & { id: string }) => assessmentsApi.update(body),
    onSuccess: () => {
      toast({ title: "Saved" });
      qc.invalidateQueries({ queryKey: ["peaklyy"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const publicPath =
    selected?.open_url ||
    (selected
      ? `${window.location.origin}/assessment/${selected.slug}${selected.result_api_key ? `?key=${selected.result_api_key}` : ""}`
      : "");
  const apiKey = selected?.result_api_key || "";

  const updateQuestion = (index: number, patch: Partial<PeaklyyCustomQuestionInput>) => {
    setCustomQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-emerald-700" />
          Peaklyy Assessments
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Keep domain-bank assessments, or create new ones with your own MCQs, duration, and count. Pass 70★ ·
          80★★ · 90★★★ · 100★★★★
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create assessment</CardTitle>
            <CardDescription>
              Domain bank uses Peaklyy MCQs by candidate domain. Custom lets you write MCQs; count follows how many you add.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Question source</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={form.source_mode === "domain_bank" ? "default" : "outline"}
                  className={form.source_mode === "domain_bank" ? "bg-emerald-800 hover:bg-emerald-900" : ""}
                  onClick={() => setForm((f) => ({ ...f, source_mode: "domain_bank", title: "Peaklyy Domain Screening" }))}
                >
                  Domain bank
                </Button>
                <Button
                  type="button"
                  variant={form.source_mode === "custom" ? "default" : "outline"}
                  className={form.source_mode === "custom" ? "bg-emerald-800 hover:bg-emerald-900" : ""}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      source_mode: "custom",
                      title: f.title === "Peaklyy Domain Screening" ? "Custom Assessment" : f.title,
                    }))
                  }
                >
                  Custom questions
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Duration (minutes)</Label>
                <Input
                  type="number"
                  min={5}
                  value={form.duration_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, duration_minutes: Number(e.target.value) || 15 }))}
                />
              </div>
              {form.source_mode === "domain_bank" ? (
                <div className="space-y-1.5">
                  <Label>Questions per attempt</Label>
                  <Input
                    type="number"
                    min={5}
                    max={40}
                    value={form.question_count}
                    onChange={(e) => setForm((f) => ({ ...f, question_count: Number(e.target.value) || 15 }))}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Questions</Label>
                  <Input readOnly value={`${customQuestions.filter((q) => q.prompt.trim()).length} custom`} />
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Result website URL (receives results + redirect after pass)</Label>
              <Input
                placeholder="https://peaklyy.com/assessment-callback"
                value={form.result_webhook_url}
                onChange={(e) => setForm((f) => ({ ...f, result_webhook_url: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Permanent API key + open link are auto-generated. On pass, results POST here and the candidate is
                redirected with score params.
              </p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label>Once per candidate</Label>
              <Switch
                checked={form.once_per_candidate}
                onCheckedChange={(v) => setForm((f) => ({ ...f, once_per_candidate: v }))}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label>Anti-cheat (tab / copy)</Label>
              <Switch checked={form.anti_cheat} onCheckedChange={(v) => setForm((f) => ({ ...f, anti_cheat: v }))} />
            </div>

            {form.source_mode === "custom" ? (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-medium">Custom MCQs</Label>
                  <Button type="button" size="sm" variant="outline" onClick={() => setCustomQuestions((q) => [...q, emptyMcq()])}>
                    + MCQ
                  </Button>
                </div>
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {customQuestions.map((q, i) => (
                    <div key={i} className="rounded-md border bg-muted/20 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline">Q{i + 1}</Badge>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          disabled={customQuestions.length <= 1}
                          onClick={() => setCustomQuestions((prev) => prev.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <Textarea
                        placeholder="Question prompt"
                        value={q.prompt}
                        onChange={(e) => updateQuestion(i, { prompt: e.target.value })}
                        rows={2}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        {(["a", "b", "c", "d"] as const).map((key) => (
                          <Input
                            key={key}
                            placeholder={`Option ${key.toUpperCase()}`}
                            value={q[`option_${key}`] || ""}
                            onChange={(e) => updateQuestion(i, { [`option_${key}`]: e.target.value })}
                          />
                        ))}
                        <div className="col-span-2 flex items-center gap-2">
                          <Label className="text-xs shrink-0">Correct</Label>
                          <Select
                            value={q.correct_option || "a"}
                            onValueChange={(v: "a" | "b" | "c" | "d") => updateQuestion(i, { correct_option: v })}
                          >
                            <SelectTrigger className="h-8 w-[80px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(["a", "b", "c", "d"] as const).map((k) => (
                                <SelectItem key={k} value={k}>
                                  {k.toUpperCase()}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Label className="text-xs shrink-0 ml-2">Points</Label>
                          <Input
                            type="number"
                            min={1}
                            className="h-8 w-20"
                            value={q.points ?? 5}
                            onChange={(e) => updateQuestion(i, { points: Number(e.target.value) || 5 })}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Domains: {Object.values(domains).join(" · ") || "Web Dev, UI/UX, Content, Digital Marketing, Video"} — MCQs only
              </p>
            )}

            <Button
              className="w-full bg-emerald-800 hover:bg-emerald-900 gap-1.5"
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
            >
              <Plus className="h-4 w-4" /> Create
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assessments</CardTitle>
            <CardDescription>Share the permanent link with candidates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assessments yet.</p>
            ) : (
              <div className="space-y-2 max-h-[360px] overflow-y-auto">
                {list.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedId(a.id)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selected?.id === a.id ? "border-emerald-600 bg-emerald-50" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm truncate">{a.title}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline">{a.source_mode === "custom" ? "Custom" : "Domain"}</Badge>
                        <Badge variant={a.is_active ? "default" : "secondary"}>{a.is_active ? "Active" : "Off"}</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {a.question_count} Q · {a.duration_minutes} min · /{a.slug}
                    </p>
                  </button>
                ))}
              </div>
            )}

            {selected ? (
              <div className="rounded-lg border p-3 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Permanent assessment link (opens test directly)</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={publicPath} className="text-xs" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        void navigator.clipboard.writeText(publicPath);
                        toast({ title: "Link copied" });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" size="icon" asChild>
                      <a href={publicPath} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Permanent API key</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={apiKey || "(none — regenerate)"} className="text-xs font-mono" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!apiKey}
                      onClick={() => {
                        void navigator.clipboard.writeText(apiKey);
                        toast({ title: "API key copied" });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      updateMut.mutate({
                        id: selected.id,
                        is_active: selected.is_active ? 0 : 1,
                      })
                    }
                  >
                    {selected.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={regenMut.isPending}
                    onClick={() => regenMut.mutate(selected.id)}
                  >
                    Regenerate API key
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attempts — {selected.title}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Stars</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Webhook</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(attemptsRes?.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground text-sm">
                      No attempts yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  (attemptsRes?.data ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{r.full_name}</div>
                        <div className="text-xs text-muted-foreground">{r.email}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.domain_key === "custom" ? "Custom" : domains[r.domain_key] || r.domain_key}
                      </TableCell>
                      <TableCell>{r.score ?? "—"}</TableCell>
                      <TableCell>{r.stars != null ? "★".repeat(r.stars) || "—" : "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.webhook_status || "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

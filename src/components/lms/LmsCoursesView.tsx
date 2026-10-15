import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { BookOpen, Loader2, RefreshCw, Search } from "lucide-react";
import { MatchLmsButton } from "@/components/lms/MatchLmsDialog";

type LmsCourse = {
  lms_id: string;
  name: string;
  description?: string;
  price?: number;
  duration_weeks?: number | null;
  source?: string;
};

function errMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: string; error?: string; hint?: string };
    const base = e.message || e.error || "Request failed";
    return e.hint ? `${base} — ${e.hint}` : base;
  }
  return "Request failed";
}

/** Read-only LMS course catalogue for Syncpedia (lmclasses.com). */
export function LmsCoursesView() {
  const isMobile = useIsMobile();
  const [courses, setCourses] = useState<LmsCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await api.lmsSync.lmsCourses()) as { data?: LmsCourse[] };
      const rows = Array.isArray(res?.data) ? res.data : [];
      // CRM Courses page always shows ₹0 (LMS catalogue prices are not used here).
      setCourses(rows.map((c) => ({ ...c, price: 0 })));
    } catch (err) {
      setCourses([]);
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) =>
      [c.name, c.description, c.lms_id].join(" ").toLowerCase().includes(q),
    );
  }, [courses, search]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Courses</h1>
          <p className="text-sm text-muted-foreground mt-1">
            LMS Classes catalogue ({courses.length} courses)
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <MatchLmsButton resource="courses" onApplied={() => void load()} />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {!isMobile && " Refresh"}
          </Button>
        </div>
      </div>

      <div className="relative max-w-md mb-4">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search LMS courses…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error ? (
        <Card className="p-4 border-destructive/40 bg-destructive/5 mb-4">
          <p className="text-sm font-medium text-destructive">Could not load LMS courses</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </Card>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading LMS courses…
        </div>
      ) : filtered.length === 0 && !error ? (
        <p className="text-center py-12 text-muted-foreground text-sm">No LMS courses found</p>
      ) : isMobile ? (
        <div className="space-y-3">
          {filtered.map((c) => (
            <Card key={c.lms_id} className="p-4 border-border/50 shadow-none">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <BookOpen className="h-3.5 w-3.5 text-primary" />
                </div>
                <p className="font-medium text-sm truncate">{c.name}</p>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                {c.description || "—"}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">₹0</span>
                {c.duration_weeks != null ? (
                  <span className="text-xs text-muted-foreground">{c.duration_weeks} weeks</span>
                ) : null}
                <Badge variant="secondary" className="text-xs">
                  LMS
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.lms_id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {c.description || "—"}
                  </TableCell>
                  <TableCell>₹0</TableCell>
                  <TableCell>
                    {c.duration_weeks != null ? `${c.duration_weeks} weeks` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{c.source || "LMS"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

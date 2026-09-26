import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Copy, Loader2, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatClock } from "@/lib/videoIntroMedia";

function fmtWhen(raw?: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function eventLabel(type: string): string {
  const map: Record<string, string> = {
    recording_expired: "Recording deleted after 90-day retention",
    email_sent: "Invitation email sent",
    created: "Invitation created",
    opened: "Candidate continued past instructions",
    consent: "Candidate consented to record",
    recording_started: "Recording started",
    retry: "Candidate started another take",
    submit_ok: "Recording submitted",
    revoked: "Invitation revoked",
    regenerated: "New link generated",
    recording_deleted: "Recording deleted",
  };
  return map[type] || type.replace(/_/g, " ");
}

export default function VideoIntroDetailPage() {
  const { id = "" } = useParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["video-intro", id],
    queryFn: () => api.videoIntros.get(id),
    enabled: !!id,
  });
  const invite = data?.data;
  const recording = data?.recording;
  const events = data?.events ?? [];

  useEffect(() => {
    let objectUrl = "";
    if (!id || !invite?.has_recording) {
      setVideoUrl(null);
      return;
    }
    setVideoError("");
    api.videoIntros
      .mediaBlob(id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setVideoUrl(objectUrl);
      })
      .catch((err) => {
        setVideoError(err instanceof Error ? err.message : "Could not load video");
      });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, invite?.has_recording, recording?.id]);

  async function copyNew(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      toast({ variant: "destructive", title: "Could not copy" });
    }
  }

  async function onRevoke() {
    setBusy(true);
    try {
      await api.videoIntros.revoke(id);
      toast({ title: "Invitation revoked" });
      void qc.invalidateQueries({ queryKey: ["video-intro", id] });
      void qc.invalidateQueries({ queryKey: ["video-intros"] });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Revoke failed" });
    } finally {
      setBusy(false);
      setConfirmRevoke(false);
    }
  }

  async function onRegen() {
    setBusy(true);
    try {
      const res = await api.videoIntros.regenerate(id);
      const url = res.data.invite_url || (res.data.invite_path ? `${window.location.origin}${res.data.invite_path}` : "");
      setNewUrl(url);
      if (url) await copyNew(url);
      void qc.invalidateQueries({ queryKey: ["video-intro", id] });
      void qc.invalidateQueries({ queryKey: ["video-intros"] });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Could not generate a new link" });
    } finally {
      setBusy(false);
      setConfirmRegen(false);
    }
  }

  async function onDeleteRecording() {
    setBusy(true);
    try {
      await api.videoIntros.deleteRecording(id);
      toast({ title: "Recording deleted" });
      void qc.invalidateQueries({ queryKey: ["video-intro", id] });
      void qc.invalidateQueries({ queryKey: ["video-intros"] });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Delete failed" });
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading invitation…</div>;
  }
  if (isError || !invite) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-destructive">Invitation not found or you do not have access.</p>
        <Button variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const submitted = invite.status === "submitted";

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/video-intros">
            <ArrowLeft className="mr-1 h-4 w-4" /> All invitations
          </Link>
        </Button>
        <Badge className="capitalize">{invite.status}</Badge>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{invite.candidate_name}</h1>
          <p className="text-sm text-muted-foreground">
            {invite.position || "No role specified"}
            {invite.org_name ? ` · ${invite.org_name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {invite.status !== "submitted" ? (
            <Button variant="outline" disabled={busy} onClick={() => setConfirmRegen(true)}>
              New link
            </Button>
          ) : null}
          {invite.status !== "revoked" ? (
            <Button variant="outline" disabled={busy} onClick={() => setConfirmRevoke(true)}>
              Revoke
            </Button>
          ) : null}
        </div>
      </div>

      {newUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New candidate link</CardTitle>
            <CardDescription>The previous link no longer works. Copy this one now.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row">
            <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{newUrl}</code>
            <Button onClick={() => void copyNew(newUrl)}>
              <Copy className="mr-2 h-4 w-4" /> Copy
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invitation</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div><span className="text-muted-foreground">Email</span> · {invite.email || "—"}</div>
            <div><span className="text-muted-foreground">Phone</span> · {invite.phone || "—"}</div>
            <div><span className="text-muted-foreground">Created</span> · {fmtWhen(invite.created_at)} {invite.created_by_name ? `by ${invite.created_by_name}` : ""}</div>
            <div><span className="text-muted-foreground">Expires</span> · {fmtWhen(invite.expires_at)}</div>
            <div><span className="text-muted-foreground">Time limit</span> · {invite.max_duration_sec}s · {invite.max_retries} retries</div>
            <div><span className="text-muted-foreground">Opened</span> · {fmtWhen(invite.opened_at)}</div>
            <div><span className="text-muted-foreground">Submitted</span> · {fmtWhen(invite.submitted_at)}</div>
            <div><span className="text-muted-foreground">Consent</span> · {fmtWhen(invite.consent_at)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recording</CardTitle>
            <CardDescription>
              Playback is authorization-checked. The file is stored on this server, not as a public URL.
              {data?.retention_days
                ? ` Kept for ${data.retention_days} days, then the video is deleted.`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!invite.has_recording ? (
              <p className="text-sm text-muted-foreground">No recording submitted yet.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Duration {formatClock((recording?.duration_ms || 0) / 1000)}
                  {recording?.byte_size ? ` · ${(recording.byte_size / (1024 * 1024)).toFixed(1)} MB` : ""}
                  {recording?.uploaded_at ? ` · ${fmtWhen(recording.uploaded_at)}` : ""}
                </p>
                {videoError ? <p className="text-sm text-destructive">{videoError}</p> : null}
                {videoUrl ? (
                  <video
                    className="aspect-video w-full rounded-lg bg-black"
                    controls
                    playsInline
                    src={videoUrl}
                    aria-label="Candidate introduction recording"
                  />
                ) : !videoError ? (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading video
                  </div>
                ) : null}
                <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete recording
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {events.map((ev) => (
                <li key={ev.id} className="flex flex-wrap gap-2 border-b border-border/60 py-2 last:border-0">
                  <span className="font-medium">{eventLabel(ev.event_type)}</span>
                  <span className="text-muted-foreground">{fmtWhen(ev.created_at)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              The candidate link will stop working. {submitted ? "You can still play the submitted recording." : "They will not be able to record."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onRevoke()}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRegen} onOpenChange={setConfirmRegen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate a new link?</AlertDialogTitle>
            <AlertDialogDescription>
              The previous link will stop working immediately. Copy the new link from this page after it is created.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onRegen()}>Generate new link</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              The video file is removed from private storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDeleteRecording()}>Delete recording</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

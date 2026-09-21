import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { assessmentsApi } from "@/services/assessments";
import PeaklyyAssessmentPage from "./PeaklyyAssessmentPage";
import SyncpediaFresherAssessmentPage from "./SyncpediaFresherAssessmentPage";

function readAccessKey(searchParams: URLSearchParams): string {
  const fromQuery = searchParams.get("key") || "";
  let fromHash = "";
  if (typeof window !== "undefined" && window.location.hash) {
    const raw = window.location.hash.replace(/^#/, "");
    const hp = new URLSearchParams(raw.includes("=") ? raw : `key=${raw}`);
    fromHash = hp.get("key") || (raw.startsWith("key=") ? decodeURIComponent(raw.slice(4)) : "");
  }
  return fromHash || fromQuery || "";
}

/** Route public assessments to Syncpedia or Peaklyy UI from stored theme. */
export default function PublicAssessmentPage() {
  const { slug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const accessKey = useMemo(() => readAccessKey(searchParams), [searchParams]);
  const slugLc = slug.toLowerCase();

  const { data, isLoading } = useQuery({
    queryKey: ["peaklyy-public", slug, accessKey],
    queryFn: () => assessmentsApi.publicGet(slug, accessKey || undefined),
    enabled: !!slug,
    retry: false,
  });

  const theme = String(data?.data?.ui_theme || "").toLowerCase();
  const useSyncpedia = theme === "syncpedia" || slugLc.includes("syncpedia");

  if (slugLc.includes("syncpedia")) {
    return <SyncpediaFresherAssessmentPage />;
  }

  if (isLoading && !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-muted-foreground">
        Loading assignment…
      </div>
    );
  }

  if (useSyncpedia) {
    return <SyncpediaFresherAssessmentPage />;
  }

  return <PeaklyyAssessmentPage />;
}

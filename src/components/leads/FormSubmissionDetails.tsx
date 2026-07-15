import { useMemo } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openProtectedUpload } from "@/lib/resumeHref";
import {
  formatFormFieldLabel,
  isStructuredFormNotes,
  listExtraFormFields,
  parseFormLeadNotes,
} from "@/lib/parseFormLeadNotes";

type Props = {
  notes?: string | null;
  resumePath?: string | null;
};

export function FormSubmissionDetails({ notes, resumePath }: Props) {
  const parsed = useMemo(() => parseFormLeadNotes(notes), [notes]);
  const extraFields = useMemo(
    () => listExtraFormFields(parsed, { resumePath }),
    [parsed, resumePath],
  );

  const attachmentEntries = useMemo(() => {
    const entries = Object.entries(parsed.attachments);
    if (resumePath) {
      return entries.filter(([, path]) => path !== resumePath);
    }
    return entries;
  }, [parsed.attachments, resumePath]);

  const showFreeform = parsed.freeformNotes && !isStructuredFormNotes(parsed.freeformNotes);
  const hasContent =
    extraFields.length > 0 ||
    attachmentEntries.length > 0 ||
    !!showFreeform ||
    !!parsed.formSlug;

  if (!hasContent) return null;

  return (
    <div className="border-t border-border pt-4">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {parsed.formSlug ? "Form Responses" : "Additional Details"}
      </h4>
      {parsed.formSlug ? (
        <p className="text-xs text-muted-foreground mb-3 capitalize">
          Form: {parsed.formSlug.replace(/_/g, " ").replace(/-/g, " ")}
        </p>
      ) : null}
      <div className="space-y-2.5">
        {extraFields.map((field) => (
          <div key={field.key} className="p-3 rounded-lg bg-muted/50">
            <p className="text-xs text-muted-foreground">{field.label}</p>
            <p className="text-sm font-medium whitespace-pre-wrap break-words">{field.value}</p>
          </div>
        ))}
        {attachmentEntries.map(([key, path]) => (
          <div key={key} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <div className="h-8 w-8 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0">
              <FileText className="h-4 w-4 text-teal-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{formatFormFieldLabel(key)}</p>
              <Button
                variant="link"
                className="h-auto p-0 text-teal-600 text-sm"
                type="button"
                onClick={() => {
                  void openProtectedUpload(path).catch(() => {});
                }}
              >
                  View file
              </Button>
            </div>
          </div>
        ))}
      </div>
      {showFreeform ? (
        <p className="text-sm text-muted-foreground leading-relaxed bg-muted/50 p-3 rounded-lg mt-3 whitespace-pre-wrap">
          {parsed.freeformNotes}
        </p>
      ) : null}
    </div>
  );
}

import { Mail, Phone } from "lucide-react";
import { parseFormLeadNotes, resolveLeadEmail, resolveLeadPhone } from "@/lib/parseFormLeadNotes";

type Props = {
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  /** Table row: compact stacked layout. Detail: icon + label layout. */
  variant?: "table" | "detail";
};

export function LeadContactBlock({ email, phone, notes, variant = "table" }: Props) {
  const parsed = parseFormLeadNotes(notes);
  const displayEmail = resolveLeadEmail(email, parsed.answers);
  const displayPhone = resolveLeadPhone(phone, parsed.answers);

  if (!displayEmail && !displayPhone) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  if (variant === "table") {
    return (
      <>
        {displayEmail ? <p className="text-sm">{displayEmail}</p> : null}
        {displayPhone ? <p className="text-xs text-muted-foreground">{displayPhone}</p> : null}
      </>
    );
  }

  return (
    <div className="space-y-2.5">
      {displayEmail ? (
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Mail className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="text-sm font-medium">{displayEmail}</p>
          </div>
        </div>
      ) : null}
      {displayPhone ? (
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center">
            <Phone className="h-4 w-4 text-green-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Phone</p>
            <p className="text-sm font-medium">{displayPhone}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

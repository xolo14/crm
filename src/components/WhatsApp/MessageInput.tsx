import { Paperclip, Send, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const MAX = 1024;

export default function MessageInput({
  value,
  onChange,
  onSend,
  disabled,
  sending,
  windowClosed,
  readOnlyFreeText,
  onOpenTemplates,
  keyboardOffset = 0,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  sending?: boolean;
  windowClosed?: boolean;
  readOnlyFreeText?: boolean;
  onOpenTemplates: () => void;
  keyboardOffset?: number;
}) {
  if (windowClosed || readOnlyFreeText) {
    return (
      <div
        className="shrink-0 px-3 py-3 bg-[var(--wa-input-bar)] border-t border-[var(--wa-border)] flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
        style={{ paddingBottom: `max(${keyboardOffset}px, env(safe-area-inset-bottom, 0px), 0.75rem)` }}
      >
        <p className="text-sm text-[var(--wa-muted)] flex-1">
          {readOnlyFreeText && !windowClosed
            ? "Your role can send templates only."
            : "24hr window closed — use an approved template."}
        </p>
        <Button
          type="button"
          className="bg-[var(--wa-send)] hover:bg-[#1da851] text-white"
          onClick={onOpenTemplates}
        >
          Send Template
        </Button>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 px-2 py-2 bg-[var(--wa-input-bar)] border-t border-[var(--wa-border)] flex items-end gap-1.5"
      style={{ paddingBottom: `max(${keyboardOffset}px, env(safe-area-inset-bottom, 0px), 0.5rem)` }}
    >
      <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-[var(--wa-muted)]" disabled title="Emoji (coming soon)">
        <Smile className="h-5 w-5" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-[var(--wa-muted)]" disabled title="Attachments (coming soon)">
        <Paperclip className="h-5 w-5" />
      </Button>
      <div className="flex-1 min-w-0 relative">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX))}
          placeholder="Type a message"
          disabled={disabled || sending}
          rows={1}
          className="min-h-[44px] max-h-32 resize-none bg-white border-0 shadow-none pr-12"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (value.trim()) onSend();
            }
          }}
        />
        <span
          className={cn(
            "absolute right-2 bottom-2 text-[10px]",
            value.length > MAX - 50 ? "text-amber-600" : "text-[var(--wa-muted)]",
          )}
        >
          {value.length}/{MAX}
        </span>
      </div>
      <Button
        type="button"
        size="icon"
        className="h-11 w-11 rounded-full bg-[var(--wa-send)] hover:bg-[#1da851] text-white shrink-0"
        disabled={!value.trim() || sending || disabled}
        onClick={onSend}
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { Bold, Italic, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { descriptionToEditorHtml, sanitizeFormDescriptionHtml } from "@/components/forms/formDescriptionHtml";
import { cn } from "@/lib/utils";

const FONT_FACES = [
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { value: "'Courier New', Courier, monospace", label: "Courier New" },
  { value: "system-ui, -apple-system, sans-serif", label: "System" },
];

const FONT_SIZES = [
  { value: "12px", label: "12" },
  { value: "14px", label: "14" },
  { value: "16px", label: "16" },
  { value: "18px", label: "18" },
  { value: "20px", label: "20" },
  { value: "24px", label: "24" },
];

type Props = {
  value: string;
  onChange: (html: string) => void;
  color?: string;
  className?: string;
  /** Remount key when switching forms so editor content resets cleanly. */
  editorKey?: string;
  placeholder?: string;
};

function runCommand(command: string, value?: string) {
  try {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
  } catch {
    /* ignore unsupported commands */
  }
}

function wrapSelectionWithSpan(style: Record<string, string>) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    // Apply to whole editor focus — fall back to fontName/fontSize commands
    return false;
  }
  const range = sel.getRangeAt(0);
  const span = document.createElement("span");
  Object.assign(span.style, style);
  try {
    range.surroundContents(span);
  } catch {
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }
  sel.removeAllRanges();
  const next = document.createRange();
  next.selectNodeContents(span);
  next.collapse(false);
  sel.addRange(next);
  return true;
}

export function FormDescriptionEditor({
  value,
  onChange,
  color = "#6b7280",
  className,
  editorKey,
  placeholder = "Add an intro under the title. Press Enter for a new line.",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = descriptionToEditorHtml(value);
    if (value === lastEmitted.current && el.innerHTML === html) return;
    if (document.activeElement === el) return;
    el.innerHTML = html || "";
    lastEmitted.current = value;
  }, [value, editorKey]);

  function emitFromEditor() {
    const el = ref.current;
    if (!el) return;
    const html = sanitizeFormDescriptionHtml(el.innerHTML);
    const empty = !el.textContent?.trim() && !el.querySelector("img");
    const next = empty ? "" : html;
    lastEmitted.current = next;
    onChange(next);
  }

  function applyFontFamily(face: string) {
    ref.current?.focus();
    if (!wrapSelectionWithSpan({ fontFamily: face })) {
      runCommand("fontName", face);
    }
    emitFromEditor();
  }

  function applyFontSize(size: string) {
    ref.current?.focus();
    if (!wrapSelectionWithSpan({ fontSize: size })) {
      // Fallback: insert a sized marker when nothing is selected
      runCommand("fontSize", "3");
      const el = ref.current;
      if (el) {
        el.querySelectorAll('font[size], span[style*="font-size"]').forEach((node) => {
          const span = node as HTMLElement;
          span.style.fontSize = size;
        });
      }
    }
    emitFromEditor();
  }

  return (
    <div className={cn("rounded-xl border border-black/10 bg-white/80 overflow-hidden", className)}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-black/5 bg-slate-50/90 px-2 py-1.5">
        <Select onValueChange={applyFontFamily}>
          <SelectTrigger className="h-8 w-[140px] text-xs bg-white">
            <SelectValue placeholder="Font" />
          </SelectTrigger>
          <SelectContent>
            {FONT_FACES.map((f) => (
              <SelectItem key={f.label} value={f.value}>
                <span style={{ fontFamily: f.value }}>{f.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select onValueChange={applyFontSize}>
          <SelectTrigger className="h-8 w-[72px] text-xs bg-white">
            <SelectValue placeholder="Size" />
          </SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Bold"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            ref.current?.focus();
            runCommand("bold");
            emitFromEditor();
          }}
        >
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Italic"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            ref.current?.focus();
            runCommand("italic");
            emitFromEditor();
          }}
        >
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Underline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            ref.current?.focus();
            runCommand("underline");
            emitFromEditor();
          }}
        >
          <Underline className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="relative">
      {!value?.trim() ? (
          <div className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground/70">{placeholder}</div>
        ) : null}
        <div
          key={editorKey}
          ref={ref}
          role="textbox"
          aria-multiline
          contentEditable
          suppressContentEditableWarning
          className="min-h-[96px] max-h-[240px] overflow-y-auto px-3 py-2.5 text-[15px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-emerald-100"
          style={{ color, whiteSpace: "pre-wrap" }}
          onInput={emitFromEditor}
          onBlur={emitFromEditor}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            runCommand("insertText", text);
            emitFromEditor();
          }}
        />
      </div>
    </div>
  );
}

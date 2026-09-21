import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Link2, Link2Off, List, ListOrdered, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { descriptionToEditorHtml, sanitizeFormDescriptionHtml, sanitizeLinkHref } from "@/components/forms/formDescriptionHtml";
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

function closestAnchor(node: Node | null): HTMLAnchorElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE && (cur as HTMLElement).tagName === "A") return cur as HTMLAnchorElement;
    cur = cur.parentNode;
  }
  return null;
}

function looksLikeUrl(text: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(String(text || "").trim());
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
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkHasSelection, setLinkHasSelection] = useState(false);

  function rememberSelection() {
    const sel = window.getSelection();
    const el = ref.current;
    if (!sel || sel.rangeCount === 0 || !el) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    savedRange.current = range.cloneRange();
  }

  function restoreSelection() {
    const sel = window.getSelection();
    const range = savedRange.current;
    if (!sel || !range) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function openLinkPopover() {
    rememberSelection();
    const range = savedRange.current;
    const anchor = range ? closestAnchor(range.commonAncestorContainer) : null;
    const selectedText = range ? range.toString() : "";
    setLinkUrl(anchor?.getAttribute("href") || (looksLikeUrl(selectedText) ? selectedText.trim() : ""));
    setLinkText(anchor?.textContent || selectedText);
    setLinkHasSelection(Boolean(anchor) || Boolean(selectedText.trim()));
    setLinkOpen(true);
  }

  function applyLink() {
    const href = sanitizeLinkHref(linkUrl);
    if (!href) return;
    const el = ref.current;
    el?.focus();
    restoreSelection();
    const sel = window.getSelection();
    const range = savedRange.current;
    const anchor = range ? closestAnchor(range.commonAncestorContainer) : null;
    if (anchor) {
      anchor.setAttribute("href", href);
      if (linkText.trim()) anchor.textContent = linkText.trim();
    } else if (sel && range && !range.collapsed && !linkText.trim()) {
      runCommand("createLink", href);
    } else {
      const text = linkText.trim() || (range && !range.collapsed ? range.toString() : "") || href.replace(/^https?:\/\//, "");
      const a = document.createElement("a");
      a.setAttribute("href", href);
      a.textContent = text;
      if (range) {
        range.deleteContents();
        range.insertNode(a);
        const after = document.createRange();
        after.setStartAfter(a);
        after.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(after);
      } else if (el) {
        el.appendChild(a);
      }
    }
    setLinkOpen(false);
    emitFromEditor();
  }

  function removeLink() {
    ref.current?.focus();
    restoreSelection();
    const range = savedRange.current;
    const anchor = range ? closestAnchor(range.commonAncestorContainer) : null;
    if (anchor) {
      const parent = anchor.parentNode;
      while (anchor.firstChild) parent?.insertBefore(anchor.firstChild, anchor);
      parent?.removeChild(anchor);
    } else {
      runCommand("unlink");
    }
    setLinkOpen(false);
    emitFromEditor();
  }

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

  const isDefaultMuted = !color || /^#6b7280$/i.test(String(color).trim());

  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/50 px-2 py-1.5">
        <Select onValueChange={applyFontFamily}>
          <SelectTrigger className="h-8 w-[140px] text-xs bg-background">
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
          <SelectTrigger className="h-8 w-[72px] text-xs bg-background">
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Bulleted list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            ref.current?.focus();
            runCommand("insertUnorderedList");
            emitFromEditor();
          }}
        >
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Numbered list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            ref.current?.focus();
            runCommand("insertOrderedList");
            emitFromEditor();
          }}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>
        <Popover open={linkOpen} onOpenChange={(o) => (o ? openLinkPopover() : setLinkOpen(false))}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Insert link"
              onMouseDown={(e) => {
                e.preventDefault();
                rememberSelection();
              }}
            >
              <Link2 className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-2 p-3">
            <div>
              <Label className="text-[11px]">Link URL</Label>
              <Input
                autoFocus
                className="mt-1 h-8 text-xs"
                placeholder="https://example.com or mailto:hr@company.com"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyLink();
                  }
                }}
              />
            </div>
            <div>
              <Label className="text-[11px]">Text to display</Label>
              <Input
                className="mt-1 h-8 text-xs"
                placeholder={linkHasSelection ? "Keep selected text" : "Defaults to the URL"}
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={removeLink}>
                <Link2Off className="h-3.5 w-3.5 mr-1" /> Remove
              </Button>
              <Button type="button" size="sm" className="h-7 text-xs" disabled={!sanitizeLinkHref(linkUrl)} onClick={applyLink}>
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
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
          className={cn(
            "min-h-[96px] max-h-[240px] overflow-y-auto px-3 py-2.5 text-[15px] leading-relaxed outline-none bg-background/40 focus-visible:ring-2 focus-visible:ring-emerald-500/25",
            isDefaultMuted && "text-muted-foreground",
          )}
          style={isDefaultMuted ? { whiteSpace: "pre-wrap" } : { color, whiteSpace: "pre-wrap" }}
          onInput={emitFromEditor}
          onBlur={() => {
            rememberSelection();
            emitFromEditor();
          }}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
          onClick={(e) => {
            // Ctrl/Cmd+click opens the link even while editing.
            const anchor = closestAnchor(e.target as Node);
            if (anchor && (e.ctrlKey || e.metaKey)) {
              window.open(anchor.getAttribute("href") || "", "_blank", "noopener");
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            const href = looksLikeUrl(text) ? sanitizeLinkHref(text) : "";
            if (href) {
              const a = document.createElement("a");
              a.setAttribute("href", href);
              a.textContent = text.trim();
              runCommand("insertHTML", a.outerHTML);
            } else {
              runCommand("insertText", text);
            }
            emitFromEditor();
          }}
        />
      </div>
    </div>
  );
}

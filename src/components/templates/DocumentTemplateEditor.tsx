import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Image as ImageIcon, List, ListOrdered, Type, Highlighter, Plus, Trash2, Move,
  RemoveFormatting, Paintbrush, Minus, SeparatorHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  CanvasTextBoxFrame,
  DEFAULT_OFFER_BODY_BOX,
  cycleTextBoxDivider,
  type OfferBodyBox,
  type OfferTextBox,
} from '@/components/templates/CanvasTextBoxFrame';

export const TEMPLATE_FONT_FACES = [
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
  { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { value: 'Futura, "Futura PT", "Century Gothic", "Trebuchet MS", Arial, sans-serif', label: 'Futura' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: '"Segoe UI", Arial, sans-serif', label: 'Segoe UI' },
  { value: '"Courier New", Courier, monospace', label: 'Courier New' },
  { value: 'system-ui, -apple-system, sans-serif', label: 'System' },
] as const;

export const TEMPLATE_FONT_SIZES = [
  { value: '10px', label: '10' },
  { value: '11px', label: '11' },
  { value: '12px', label: '12' },
  { value: '14px', label: '14' },
  { value: '16px', label: '16' },
  { value: '18px', label: '18' },
  { value: '20px', label: '20' },
  { value: '24px', label: '24' },
  { value: '28px', label: '28' },
  { value: '32px', label: '32' },
  { value: '36px', label: '36' },
  { value: '48px', label: '48' },
] as const;

function templateFontByLabel(label: string): string {
  return TEMPLATE_FONT_FACES.find((f) => f.label === label)?.value || TEMPLATE_FONT_FACES[0].value;
}

/** First family name from a CSS font-family stack (handles quotes). */
export function primaryFontName(fontFamily: string): string {
  const first = String(fontFamily || '')
    .split(',')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase() || '';
  return first;
}

/** Map any computed/stored font stack to a TEMPLATE_FONT_FACES value. */
export function matchTemplateFontFace(fontFamily: string | null | undefined): string {
  const key = primaryFontName(fontFamily || '');
  if (!key) return TEMPLATE_FONT_FACES[0].value;
  const aliases: Record<string, string> = {
    georgia: templateFontByLabel('Georgia'),
    'times new roman': templateFontByLabel('Times New Roman'),
    times: templateFontByLabel('Times New Roman'),
    futura: templateFontByLabel('Futura'),
    'futura pt': templateFontByLabel('Futura'),
    'futura std': templateFontByLabel('Futura'),
    'century gothic': templateFontByLabel('Futura'),
    arial: templateFontByLabel('Arial'),
    helvetica: templateFontByLabel('Arial'),
    verdana: templateFontByLabel('Verdana'),
    'segoe ui': templateFontByLabel('Segoe UI'),
    'courier new': templateFontByLabel('Courier New'),
    courier: templateFontByLabel('Courier New'),
    'system-ui': templateFontByLabel('System'),
    '-apple-system': templateFontByLabel('System'),
    blinkmacsystemfont: templateFontByLabel('System'),
  };
  if (aliases[key]) return aliases[key];
  const byLabel = TEMPLATE_FONT_FACES.find((f) => f.label.toLowerCase() === key);
  if (byLabel) return byLabel.value;
  const byValue = TEMPLATE_FONT_FACES.find((f) => primaryFontName(f.value) === key);
  return byValue?.value || TEMPLATE_FONT_FACES[0].value;
}

/** Parse CSS size (px/pt/em) to px number using optional computed fallback. */
export function cssSizeToPx(size: string, rootPx = 16): number {
  const s = String(size || '').trim().toLowerCase();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return rootPx;
  if (s.endsWith('pt')) return Math.round(n * (96 / 72));
  if (s.endsWith('em') || s.endsWith('rem')) return Math.round(n * rootPx);
  return Math.round(n);
}

/** Nearest TEMPLATE_FONT_SIZES value (e.g. "16px") for a CSS/computed size. */
export function matchTemplateFontSize(size: string | number | null | undefined): string {
  const px =
    typeof size === 'number'
      ? Math.round(size)
      : cssSizeToPx(String(size || '16px'));
  let best = TEMPLATE_FONT_SIZES[0];
  let bestDist = Infinity;
  for (const opt of TEMPLATE_FONT_SIZES) {
    const optPx = parseInt(opt.value, 10);
    const dist = Math.abs(optPx - px);
    if (dist < bestDist) {
      best = opt;
      bestDist = dist;
    }
  }
  return best.value;
}

function runCommand(command: string, value?: string) {
  try {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
  } catch {
    /* ignore */
  }
}

function saveSelection(): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  return sel.getRangeAt(0).cloneRange();
}

function restoreSelection(range: Range | null) {
  if (!range) return;
  try {
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* range may be detached */
  }
}

function selectionElement(editor: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node: Node | null = sel.focusNode || sel.anchorNode;
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!(node instanceof HTMLElement)) return null;
  if (!editor.contains(node)) return null;
  return node;
}

/** Read the font/size actually applied to the caret / selection. */
function readSelectionTypography(editor: HTMLElement): { fontFamily: string; fontSize: string } {
  const el = selectionElement(editor) || editor;
  const cs = window.getComputedStyle(el);
  return {
    fontFamily: matchTemplateFontFace(cs.fontFamily),
    fontSize: matchTemplateFontSize(cs.fontSize),
  };
}

/**
 * Toggle ul/ol around the current selection. More reliable than bare execCommand
 * when paste left messy spans / no block wrappers.
 */
function toggleListInEditor(editor: HTMLDivElement, ordered: boolean, savedRange?: Range | null) {
  editor.focus();
  if (savedRange) restoreSelection(savedRange);

  const sel = window.getSelection();
  if (!sel) return;

  // Ensure there is a caret / selection inside the editor
  if (sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // Prefer native command when it works
  const command = ordered ? 'insertOrderedList' : 'insertUnorderedList';
  try {
    document.execCommand('styleWithCSS', false, 'true');
    const ok = document.execCommand(command, false);
    if (ok) {
      // Force visible list markers (Tailwind preflight / prose can hide them)
      editor.querySelectorAll('ul').forEach((ul) => {
        (ul as HTMLElement).style.listStyleType = 'disc';
        (ul as HTMLElement).style.paddingLeft = '1.5em';
        (ul as HTMLElement).style.margin = '0.5em 0';
      });
      editor.querySelectorAll('ol').forEach((ol) => {
        (ol as HTMLElement).style.listStyleType = 'decimal';
        (ol as HTMLElement).style.paddingLeft = '1.5em';
        (ol as HTMLElement).style.margin = '0.5em 0';
      });
      return;
    }
  } catch {
    /* fall through to manual */
  }

  // Manual wrap: turn selected lines into list items
  const range = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!range) return;

  const list = document.createElement(ordered ? 'ol' : 'ul');
  list.style.listStyleType = ordered ? 'decimal' : 'disc';
  list.style.paddingLeft = '1.5em';
  list.style.margin = '0.5em 0';

  const text = range.toString();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    const li = document.createElement('li');
    li.appendChild(document.createElement('br'));
    list.appendChild(li);
    range.insertNode(list);
  } else {
    range.deleteContents();
    for (const line of lines) {
      const li = document.createElement('li');
      li.textContent = line;
      list.appendChild(li);
    }
    range.insertNode(list);
  }

  const after = document.createRange();
  after.selectNodeContents(list);
  after.collapse(false);
  sel.removeAllRanges();
  sel.addRange(after);
}

/** Strip Word/Docs font locks so toolbar font/size can take effect. */
function sanitizePasteHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, meta, link, xml, o\\:p').forEach((n) => n.remove());

  const walk = (node: Element) => {
    // Drop Word class noise
    if (node.hasAttribute('class')) {
      const cls = node.getAttribute('class') || '';
      if (/^Mso/i.test(cls) || cls.includes('Apple-')) node.removeAttribute('class');
    }
    node.removeAttribute('face');
    node.removeAttribute('size');
    node.removeAttribute('color');

    if (node.hasAttribute('style')) {
      const style = node.getAttribute('style') || '';
      const kept: string[] = [];
      style.split(';').forEach((part) => {
        const [rawKey, ...rest] = part.split(':');
        if (!rawKey || !rest.length) return;
        const key = rawKey.trim().toLowerCase();
        const val = rest.join(':').trim();
        // Keep useful emphasis; drop font locks & layout noise from paste
        if (
          key === 'font-weight' ||
          key === 'font-style' ||
          key === 'text-decoration' ||
          key === 'text-align' ||
          key === 'color' ||
          key === 'background-color' ||
          key === 'background'
        ) {
          if (val && !/windowtext|transparent/i.test(val)) kept.push(`${key}:${val}`);
        }
      });
      if (kept.length) node.setAttribute('style', kept.join(';'));
      else node.removeAttribute('style');
    }

    // Convert <font> to <span>
    if (node.tagName === 'FONT') {
      const span = doc.createElement('span');
      while (node.firstChild) span.appendChild(node.firstChild);
      node.parentNode?.replaceChild(span, node);
      Array.from(span.children).forEach((c) => walk(c as Element));
      return;
    }

    Array.from(node.children).forEach((c) => walk(c as Element));
  };

  Array.from(doc.body.children).forEach((c) => walk(c as Element));
  // Prefer body inner HTML; fall back to plain text paragraphs
  let out = doc.body.innerHTML.trim();
  if (!out) {
    const text = doc.body.textContent || '';
    out = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('');
  }
  return out;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearDescendantFontLocks(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    el.style.removeProperty('font-size');
    el.style.removeProperty('font-family');
    el.style.removeProperty('line-height');
    if (el.tagName === 'FONT') {
      el.removeAttribute('size');
      el.removeAttribute('face');
    }
    // Drop empty style attrs
    if (el.getAttribute('style') === '') el.removeAttribute('style');
  });
}

/**
 * Apply font-family or font-size to the current selection (or whole editor if nothing selected).
 * Clears nested paste locks so the change actually shows — Docs/Word-style behavior.
 */
function applyStyleToEditableSelection(
  editor: HTMLDivElement,
  style: { fontFamily?: string; fontSize?: string },
  savedRange?: Range | null,
) {
  editor.focus();
  if (savedRange) restoreSelection(savedRange);

  const sel = window.getSelection();
  if (!sel) return false;

  let range: Range;
  if (sel.rangeCount > 0 && !sel.isCollapsed && editor.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0);
  } else {
    // No selection → format entire letter body (common after paste)
    range = document.createRange();
    range.selectNodeContents(editor);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const span = document.createElement('span');
  if (style.fontFamily) span.style.fontFamily = style.fontFamily;
  if (style.fontSize) span.style.fontSize = style.fontSize;

  try {
    const frag = range.extractContents();
    span.appendChild(frag);
    clearDescendantFontLocks(span);
    range.insertNode(span);
  } catch {
    // Fallback for awkward partial-node selections
    try {
      range.surroundContents(span);
      clearDescendantFontLocks(span);
    } catch {
      runCommand('insertHTML', `<span style="${style.fontFamily ? `font-family:${style.fontFamily};` : ''}${style.fontSize ? `font-size:${style.fontSize};` : ''}">${sel.toString()}</span>`);
      return true;
    }
  }

  sel.removeAllRanges();
  const next = document.createRange();
  next.selectNodeContents(span);
  sel.addRange(next);
  return true;
}

function clearFormattingInSelection(editor: HTMLDivElement, savedRange?: Range | null) {
  editor.focus();
  if (savedRange) restoreSelection(savedRange);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  if (sel.isCollapsed) {
    // Clear whole body
    const plain = editor.innerText;
    editor.innerHTML = plain
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `<p>${escapeHtml(l)}</p>`)
      .join('') || '<p><br></p>';
    return;
  }
  runCommand('removeFormat');
  // Also strip font locks left behind
  const range = sel.getRangeAt(0);
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_ELEMENT);
  const nodes: HTMLElement[] = [];
  let n = walker.nextNode();
  while (n) {
    if (n instanceof HTMLElement && range.intersectsNode(n)) nodes.push(n);
    n = walker.nextNode();
  }
  nodes.forEach((el) => {
    el.style.removeProperty('font-size');
    el.style.removeProperty('font-family');
  });
}

type Props = {
  /** Inner HTML of the editable content (not full document). */
  value: string;
  onChange: (html: string) => void;
  /** Optional full-bleed background (letterhead / slide bg). */
  backgroundImage?: string;
  backgroundColor?: string;
  /** Padding of the editable region (CSS). */
  contentPadding?: string;
  className?: string;
  editorKey?: string | number;
  placeholder?: string;
  /** Page size: A4 portrait default. */
  pageWidth?: string;
  pageMinHeight?: string;
  /** Extra toolbar actions (placeholders, etc.) */
  toolbarExtra?: ReactNode;
  /** Place formatting toolbar on top (default) or left of the page canvas. */
  toolbarPlacement?: 'top' | 'left';
  onEditorReady?: (el: HTMLDivElement | null) => void;
  /** Free-form text boxes (Slides-style) overlaid on the page. */
  textBoxes?: OfferTextBox[];
  onTextBoxesChange?: (boxes: OfferTextBox[]) => void;
  enableTextBoxes?: boolean;
  /** Main letter body position (movable on the A4 page). */
  bodyBox?: OfferBodyBox;
  onBodyBoxChange?: (box: OfferBodyBox) => void;
  /**
   * When true: background + body margins stay fixed.
   * Letter text and free text/image boxes remain editable.
   */
  layoutLocked?: boolean;
  /**
   * CSS from the full HTML template `<style>` block so Design mode
   * matches Preview (subject-line, tables, signatures, etc.).
   */
  documentCss?: string;
};

export function DocumentTemplateEditor({
  value,
  onChange,
  backgroundImage,
  backgroundColor = '#ffffff',
  contentPadding = '48px 56px',
  className,
  editorKey,
  placeholder = 'Paste or type — select text, then set Font & Size. Paste is cleaned so formatting still works.',
  pageWidth = '210mm',
  pageMinHeight = '297mm',
  toolbarExtra,
  toolbarPlacement = 'top',
  onEditorReady,
  textBoxes = [],
  onTextBoxesChange,
  enableTextBoxes = false,
  bodyBox = DEFAULT_OFFER_BODY_BOX,
  onBodyBoxChange,
  layoutLocked = false,
  documentCss = '',
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef(value);
  const savedRangeRef = useRef<Range | null>(null);
  const [textColor, setTextColor] = useState('#1a1a2e');
  const [highlight, setHighlight] = useState('#fef08a');
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(enableTextBoxes ? '__body__' : null);
  const [activeFont, setActiveFont] = useState<string>(TEMPLATE_FONT_FACES[0].value);
  const [activeSize, setActiveSize] = useState<string>('16px');
  const [pasteTip, setPasteTip] = useState<string | null>(null);
  const bodySelected = selectedBoxId === '__body__';

  const selectedBox = textBoxes.find((b) => b.id === selectedBoxId) || null;

  function patchBox(id: string, patch: Partial<OfferTextBox>) {
    if (!onTextBoxesChange) return;
    onTextBoxesChange(textBoxes.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function syncToolbarFromSelection() {
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    if (!el.contains(sel.anchorNode) && !el.contains(sel.focusNode)) return;
    const typo = readSelectionTypography(el);
    setActiveFont(typo.fontFamily);
    setActiveSize(typo.fontSize);
  }

  function rememberSelection() {
    const el = ref.current;
    const range = saveSelection();
    if (range && el && el.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range;
      syncToolbarFromSelection();
    }
  }

  function addTextBox() {
    if (!onTextBoxesChange) return;
    const box: OfferTextBox = {
      id: crypto.randomUUID(),
      type: 'text',
      content: '{{candidate_name}}',
      x: 50,
      y: 45,
      width: 42,
      height: 10,
      fontSize: 16,
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#1a1a2e',
      align: 'center',
    };
    onTextBoxesChange([...textBoxes, box]);
    setSelectedBoxId(box.id);
  }

  function addImageBox(src: string) {
    if (!onTextBoxesChange) return;
    const box: OfferTextBox = {
      id: crypto.randomUUID(),
      type: 'image',
      content: src,
      x: 50,
      y: 55,
      width: 28,
      height: 18,
    };
    onTextBoxesChange([...textBoxes, box]);
    setSelectedBoxId(box.id);
  }

  function removeSelectedBox() {
    if (!selectedBoxId || selectedBoxId === '__body__' || !onTextBoxesChange) return;
    onTextBoxesChange(textBoxes.filter((b) => b.id !== selectedBoxId));
    setSelectedBoxId('__body__');
  }

  useEffect(() => {
    onEditorReady?.(ref.current);
    return () => onEditorReady?.(null);
  }, [onEditorReady]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value === lastEmitted.current && el.innerHTML === value) return;
    if (document.activeElement === el) return;
    el.innerHTML = value || '';
    lastEmitted.current = value;
  }, [value, editorKey]);

  useEffect(() => {
    if (!pasteTip) return;
    const t = window.setTimeout(() => setPasteTip(null), 5000);
    return () => window.clearTimeout(t);
  }, [pasteTip]);

  useEffect(() => {
    const onSelChange = () => {
      const el = ref.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!el.contains(sel.anchorNode) && !el.contains(sel.focusNode)) return;
      const range = sel.getRangeAt(0).cloneRange();
      savedRangeRef.current = range;
      syncToolbarFromSelection();
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, []);

  function emitFromEditor() {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML;
    const empty = !el.textContent?.trim() && !el.querySelector('img');
    const next = empty ? '' : html;
    lastEmitted.current = next;
    onChange(next);
  }

  function focusEditor() {
    ref.current?.focus();
    restoreSelection(savedRangeRef.current);
  }

  function applyFontFamily(face: string) {
    const matched = matchTemplateFontFace(face);
    setActiveFont(matched);
    const el = ref.current;
    if (!el) return;
    applyStyleToEditableSelection(el, { fontFamily: matched }, savedRangeRef.current);
    rememberSelection();
    emitFromEditor();
  }

  function applyFontSize(size: string) {
    const matched = matchTemplateFontSize(size);
    setActiveSize(matched);
    const el = ref.current;
    if (!el) return;
    applyStyleToEditableSelection(el, { fontSize: matched }, savedRangeRef.current);
    rememberSelection();
    emitFromEditor();
  }

  function cmd(command: string, value?: string) {
    focusEditor();
    runCommand(command, value);
    rememberSelection();
    emitFromEditor();
  }

  function cmdList(ordered: boolean) {
    const el = ref.current;
    if (!el) return;
    toggleListInEditor(el, ordered, savedRangeRef.current);
    rememberSelection();
    emitFromEditor();
  }

  function handleClearFormat() {
    const el = ref.current;
    if (!el) return;
    clearFormattingInSelection(el, savedRangeRef.current);
    rememberSelection();
    emitFromEditor();
    setPasteTip('Formatting cleared — pick Font & Size, then type or select text.');
  }

  function handleSelectAll() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    savedRangeRef.current = range.cloneRange();
    setPasteTip('All text selected — change Font or Size now.');
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    let insert = '';
    if (html) {
      insert = sanitizePasteHtml(html);
    } else if (text) {
      insert = text
        .split(/\r?\n/)
        .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
        .join('');
    }
    if (!insert) return;
    focusEditor();
    runCommand('insertHTML', insert);
    rememberSelection();
    emitFromEditor();
    setPasteTip('Pasted cleanly — select text (or Select all) → Font / Size to restyle.');
  }

  function insertImage(file: File) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      if (enableTextBoxes && onTextBoxesChange) {
        addImageBox(src);
        return;
      }
      focusEditor();
      runCommand('insertHTML', `<img src="${src}" alt="" style="max-width:100%;height:auto;display:block;margin:8px 0;" />`);
      emitFromEditor();
    };
    reader.readAsDataURL(file);
  }

  const leftToolbar = toolbarPlacement === 'left';
  const toolBtn = leftToolbar ? 'h-8 w-full justify-start text-xs gap-1.5 px-2' : 'h-8 text-xs gap-1';
  const toolIcon = leftToolbar ? 'h-8 w-8 shrink-0' : 'h-8 w-8';

  return (
    <div className={cn(leftToolbar ? 'flex flex-row h-full min-h-0' : 'flex flex-col h-full min-h-0', className)}>
      {/* Formatting + layout tools */}
      <div
        className={cn(
          'bg-muted/40 shrink-0',
          leftToolbar
            ? 'w-[220px] border-r overflow-y-auto flex flex-col gap-1.5 p-2'
            : 'flex flex-wrap items-center gap-1 px-2 py-1.5 border-b',
        )}
      >
        {toolbarExtra && leftToolbar ? (
          <>
            {toolbarExtra}
            <div className="h-px w-full bg-border my-1" />
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">Format</p>
          </>
        ) : null}

        <Select
          value={activeFont}
          onOpenChange={(open) => {
            if (open) rememberSelection();
          }}
          onValueChange={applyFontFamily}
        >
          <SelectTrigger
            className={cn('text-xs bg-background', leftToolbar ? 'h-8 w-full' : 'h-8 w-[148px]')}
            onMouseDown={(e) => {
              e.preventDefault();
              rememberSelection();
            }}
          >
            <SelectValue placeholder="Font" />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_FONT_FACES.map((f) => (
              <SelectItem key={f.label} value={f.value}>
                <span style={{ fontFamily: f.value }}>{f.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={activeSize}
          onOpenChange={(open) => {
            if (open) rememberSelection();
          }}
          onValueChange={applyFontSize}
        >
          <SelectTrigger
            className={cn('text-xs bg-background', leftToolbar ? 'h-8 w-full' : 'h-8 w-[72px]')}
            onMouseDown={(e) => {
              e.preventDefault();
              rememberSelection();
            }}
          >
            <SelectValue placeholder="Size" />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_FONT_SIZES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!leftToolbar ? <div className="h-5 w-px bg-border mx-0.5" /> : null}

        <div className={cn(leftToolbar ? 'flex flex-wrap gap-1' : 'contents')}>
        <Button type="button" variant="ghost" size="icon" className={toolIcon} title="Bold"
          onMouseDown={(e) => { e.preventDefault(); rememberSelection(); }} onClick={() => cmd('bold')}>
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={toolIcon} title="Italic"
          onMouseDown={(e) => { e.preventDefault(); rememberSelection(); }} onClick={() => cmd('italic')}>
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={toolIcon} title="Underline"
          onMouseDown={(e) => { e.preventDefault(); rememberSelection(); }} onClick={() => cmd('underline')}>
          <Underline className="h-3.5 w-3.5" />
        </Button>
        </div>

        {!leftToolbar ? <div className="h-5 w-px bg-border mx-0.5" /> : null}

        <div className={cn(leftToolbar ? 'flex flex-wrap gap-1' : 'contents')}>
        <Button type="button" variant="ghost" size="icon" className={toolIcon} title="Align left"
          onMouseDown={(e) => { e.preventDefault(); rememberSelection(); }} onClick={() => cmd('justifyLeft')}>
          <AlignLeft className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={toolIcon} title="Align center"
          onMouseDown={(e) => { e.preventDefault(); rememberSelection(); }} onClick={() => cmd('justifyCenter')}>
          <AlignCenter className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={toolIcon} title="Align right"
          onMouseDown={(e) => { e.preventDefault(); rememberSelection(); }} onClick={() => cmd('justifyRight')}>
          <AlignRight className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={toolIcon} title="Justify"
          onMouseDown={(e) => { e.preventDefault(); rememberSelection(); }} onClick={() => cmd('justifyFull')}>
          <AlignJustify className="h-3.5 w-3.5" />
        </Button>
        </div>

        {!leftToolbar ? <div className="h-5 w-px bg-border mx-0.5" /> : null}

        <div className={cn(leftToolbar ? 'flex flex-wrap gap-1' : 'contents')}>
        <Button type="button" variant="ghost" size="icon" className={toolIcon} title="Bullet list"
          onMouseDown={(e) => { e.preventDefault(); rememberSelection(); }}
          onClick={() => cmdList(false)}>
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={toolIcon} title="Numbered list"
          onMouseDown={(e) => { e.preventDefault(); rememberSelection(); }}
          onClick={() => cmdList(true)}>
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>
        </div>

        {!leftToolbar ? <div className="h-5 w-px bg-border mx-0.5" /> : null}

        <div className={cn(leftToolbar ? 'flex flex-wrap gap-1 items-center' : 'contents')}>
        <label className="inline-flex items-center gap-1 h-8 px-1.5 rounded-md hover:bg-accent cursor-pointer" title="Text color">
          <Type className="h-3.5 w-3.5" />
          <Input
            type="color"
            value={textColor}
            className="h-6 w-7 p-0 border-0 cursor-pointer"
            onMouseDown={() => rememberSelection()}
            onChange={(e) => {
              setTextColor(e.target.value);
              cmd('foreColor', e.target.value);
            }}
          />
        </label>
        <label className="inline-flex items-center gap-1 h-8 px-1.5 rounded-md hover:bg-accent cursor-pointer" title="Highlight">
          <Highlighter className="h-3.5 w-3.5" />
          <Input
            type="color"
            value={highlight}
            className="h-6 w-7 p-0 border-0 cursor-pointer"
            onMouseDown={() => rememberSelection()}
            onChange={(e) => {
              setHighlight(e.target.value);
              cmd('hiliteColor', e.target.value);
            }}
          />
        </label>
        </div>

        {!leftToolbar ? <div className="h-5 w-px bg-border mx-0.5" /> : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolBtn}
          title="Select all letter text"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleSelectAll}
        >
          <Paintbrush className="h-3.5 w-3.5" /> Select all
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolBtn}
          title="Clear paste formatting so Font/Size apply cleanly"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleClearFormat}
        >
          <RemoveFormatting className="h-3.5 w-3.5" /> Clear format
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolBtn}
          title="Insert a horizontal divider line in the letter body"
          onMouseDown={(e) => {
            e.preventDefault();
            rememberSelection();
          }}
          onClick={() => {
            focusEditor();
            restoreSelection(savedRangeRef.current);
            try {
              document.execCommand('insertHorizontalRule');
            } catch {
              document.execCommand(
                'insertHTML',
                false,
                '<hr style="border:none;border-top:1px solid #334155;margin:12pt 0;" />',
              );
            }
            emitFromEditor();
          }}
        >
          <SeparatorHorizontal className="h-3.5 w-3.5" /> Divider
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={toolBtn}
          title="Upload image as a movable box on the page"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => imageInputRef.current?.click()}
        >
          <ImageIcon className="h-3.5 w-3.5" /> Image
        </Button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) insertImage(f);
            e.target.value = '';
          }}
        />

        {enableTextBoxes ? (
          <>
            {!leftToolbar ? <div className="h-5 w-px bg-border mx-0.5" /> : <div className="h-px w-full bg-border my-1" />}
            <Button
              type="button"
              variant={bodySelected ? 'default' : 'outline'}
              size="sm"
              className={toolBtn}
              title="Select the letter body, then drag the Move bar to reposition"
              onClick={() => setSelectedBoxId('__body__')}
            >
              <Move className="h-3.5 w-3.5" /> Move text
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolBtn}
              title="Add a movable text box"
              onClick={addTextBox}
            >
              <Plus className="h-3.5 w-3.5" /> Text box
            </Button>
            {selectedBox && selectedBox.type !== 'image' ? (
              <>
                <Select
                  value={matchTemplateFontFace(selectedBox.fontFamily)}
                  onValueChange={(v) => patchBox(selectedBox.id, { fontFamily: v })}
                >
                  <SelectTrigger className={cn('text-xs', leftToolbar ? 'h-8 w-full' : 'h-8 w-[130px]')}><SelectValue placeholder="Font" /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_FONT_FACES.map((f) => (
                      <SelectItem key={f.label} value={f.value}>
                        <span style={{ fontFamily: f.value }}>{f.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(parseInt(matchTemplateFontSize(selectedBox.fontSize ?? 16), 10))}
                  onValueChange={(v) => patchBox(selectedBox.id, { fontSize: Number(v) })}
                >
                  <SelectTrigger className={cn('text-xs', leftToolbar ? 'h-8 w-full' : 'h-8 w-[68px]')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_FONT_SIZES.map((s) => (
                      <SelectItem key={s.value} value={String(parseInt(s.value, 10))}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className={cn(leftToolbar ? 'flex flex-wrap gap-1 items-center' : 'contents')}>
                <Button
                  type="button"
                  variant={selectedBox.fontWeight === 'bold' ? 'default' : 'ghost'}
                  size="icon"
                  className={toolIcon}
                  onClick={() => patchBox(selectedBox.id, { fontWeight: selectedBox.fontWeight === 'bold' ? 'normal' : 'bold' })}
                >
                  <Bold className="h-3.5 w-3.5" />
                </Button>
                <Input
                  type="color"
                  className="h-8 w-9 p-1 cursor-pointer"
                  value={selectedBox.color || '#1a1a2e'}
                  onChange={(e) => patchBox(selectedBox.id, { color: e.target.value })}
                  title="Text box color"
                />
                </div>
                <Button
                  type="button"
                  variant={selectedBox.divider && selectedBox.divider !== 'none' ? 'default' : 'outline'}
                  size="sm"
                  className={toolBtn}
                  title={
                    selectedBox.divider === 'bottom'
                      ? 'Divider: bottom (click for top)'
                      : selectedBox.divider === 'top'
                        ? 'Divider: top (click to remove)'
                        : 'Add divider line (bottom → top → off)'
                  }
                  onClick={() =>
                    patchBox(selectedBox.id, { divider: cycleTextBoxDivider(selectedBox.divider) })
                  }
                >
                  <Minus className="h-3.5 w-3.5" />
                  {selectedBox.divider === 'bottom'
                    ? 'Line: bottom'
                    : selectedBox.divider === 'top'
                      ? 'Line: top'
                      : 'Add line'}
                </Button>
              </>
            ) : null}
            {selectedBox ? (
              <Button
                type="button"
                variant="ghost"
                size={leftToolbar ? 'sm' : 'icon'}
                className={leftToolbar ? `${toolBtn} text-destructive` : 'h-8 w-8 text-destructive'}
                title="Delete selected box"
                onClick={removeSelectedBox}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {leftToolbar ? ' Delete box' : null}
              </Button>
            ) : null}
          </>
        ) : null}

        {toolbarExtra && !leftToolbar ? (
          <>
            <div className="h-5 w-px bg-border mx-0.5" />
            {toolbarExtra}
          </>
        ) : null}
      </div>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      {pasteTip ? (
        <div className="px-3 py-1.5 text-[11px] bg-sky-50 text-sky-900 border-b border-sky-100 shrink-0">
          {pasteTip}
        </div>
      ) : (
        <div className="px-3 py-1 text-[10px] text-muted-foreground border-b bg-muted/20 shrink-0">
          {layoutLocked && enableTextBoxes ? (
            <>
              Layout locked: background and letter margins are fixed. Edit letter text and move free text/image boxes only. Unlock layout to reposition the letter body. Select a text box → <strong>Add line</strong> for an optional divider.
            </>
          ) : (
            <>
              Tip: Paste from Word/Docs is cleaned automatically. Select text → Font / Size. No selection? Font applies to the whole letter. Use <strong>Select all</strong> or <strong>Clear format</strong> if styles feel stuck.
            </>
          )}
        </div>
      )}

      {/* Page canvas */}
      <div className="flex-1 overflow-auto bg-muted/30 p-4 flex justify-center items-start">
        <div
          data-canvas-root
          className="relative bg-white shadow-lg shrink-0 offer-template-canvas"
          style={{
            width: pageWidth,
            height: pageMinHeight,
            minHeight: pageMinHeight,
            backgroundColor,
            backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined,
            backgroundSize: backgroundImage ? 'contain' : undefined,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'top center',
          }}
          onClick={() => setSelectedBoxId(null)}
        >
          {documentCss ? (
            <style
              // Template CSS scoped so Design mode matches Preview layout/typography.
              dangerouslySetInnerHTML={{
                __html: scopeOfferEditorCss(documentCss),
              }}
            />
          ) : null}
          <style
            dangerouslySetInnerHTML={{
              __html: `
                @font-face {
                  font-family: 'Futura';
                  src: local('Futura'), local('Futura-Book'), local('Futura Book'), local('Futura-Medium'), local('Futura Medium'), local('FuturaPT-Book'), local('Futura Std Book');
                  font-weight: 400;
                  font-style: normal;
                  font-display: swap;
                }
                @font-face {
                  font-family: 'Futura';
                  src: local('Futura-Bold'), local('Futura Bold'), local('Futura-Medium'), local('Futura Medium'), local('FuturaPT-Bold'), local('Futura Std Bold');
                  font-weight: 700;
                  font-style: normal;
                  font-display: swap;
                }
              `,
            }}
          />
          {enableTextBoxes ? (
            <CanvasTextBoxFrame
              geom={bodyBox}
              selected={bodySelected}
              locked={layoutLocked}
              editable
              centerOrigin={false}
              showMoveHandle={!layoutLocked}
              moveHandleLabel="Drag to move letter text"
              contentOverflow="visible"
              growWithContent
              allowResize={!layoutLocked}
              onSelect={() => setSelectedBoxId('__body__')}
              onMove={(g) => {
                if (!layoutLocked) onBodyBoxChange?.(g);
              }}
              onResize={(g) => {
                if (!layoutLocked) onBodyBoxChange?.(g);
              }}
              style={{ zIndex: 2, background: 'transparent' }}
            >
              {!value?.trim() ? (
                <div className="pointer-events-none absolute inset-0 text-sm text-muted-foreground/60 p-2">
                  {placeholder}
                </div>
              ) : null}
              <div
                key={editorKey}
                ref={ref}
                role="textbox"
                aria-multiline
                contentEditable
                suppressContentEditableWarning
                className="content-area outline-none max-w-none focus-visible:ring-0 [&_img]:max-w-full [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6"
                style={{
                  // Defaults only — template CSS overrides via .content-area rules
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: '12pt',
                  lineHeight: 1.7,
                  color: '#1a1a2e',
                  position: 'relative',
                  padding: 0,
                  margin: 0,
                  width: '100%',
                  height: 'auto',
                  minHeight: '100%',
                  overflow: 'visible',
                  boxSizing: 'border-box',
                }}
                onInput={emitFromEditor}
                onBlur={emitFromEditor}
                onMouseUp={rememberSelection}
                onKeyUp={rememberSelection}
                onPaste={handlePaste}
              />
            </CanvasTextBoxFrame>
          ) : (
            <div className="relative z-[1]" style={{ padding: contentPadding }}>
              {!value?.trim() ? (
                <div className="pointer-events-none absolute text-sm text-muted-foreground/60" style={{ padding: contentPadding }}>
                  {placeholder}
                </div>
              ) : null}
              <div
                key={editorKey}
                ref={ref}
                role="textbox"
                aria-multiline
                contentEditable
                suppressContentEditableWarning
                className="content-area min-h-[200mm] outline-none max-w-none focus-visible:ring-0 [&_img]:max-w-full [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6"
                style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '12pt', lineHeight: 1.7, color: '#1a1a2e' }}
                onInput={emitFromEditor}
                onBlur={emitFromEditor}
                onMouseUp={rememberSelection}
                onKeyUp={rememberSelection}
                onPaste={handlePaste}
              />
            </div>
          )}

          {enableTextBoxes
            ? textBoxes.map((box) => {
                const isImage = box.type === 'image';
                return (
                  <CanvasTextBoxFrame
                    key={box.id}
                    geom={{ x: box.x, y: box.y, width: box.width, height: box.height }}
                    selected={selectedBoxId === box.id}
                    editable
                    centerOrigin
                    showMoveHandle
                    moveHandleLabel={isImage ? 'Move image' : 'Move text'}
                    divider={box.divider || 'none'}
                    contentOverflow="hidden"
                    onSelect={() => setSelectedBoxId(box.id)}
                    onMove={(g) => patchBox(box.id, g)}
                    onResize={(g) => patchBox(box.id, g)}
                    style={{
                      zIndex: 8,
                      color: box.color || '#1a1a2e',
                      fontSize: isImage ? undefined : `${box.fontSize ?? 16}px`,
                      fontFamily: isImage ? undefined : box.fontFamily || 'Georgia, serif',
                      fontWeight: box.fontWeight || 'normal',
                      fontStyle: box.fontStyle || 'normal',
                      textAlign: box.align || 'center',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.4,
                      overflow: 'hidden',
                      background: selectedBoxId === box.id ? 'rgba(26,115,232,0.06)' : 'transparent',
                    }}
                  >
                    {isImage ? (
                      <img
                        src={box.content}
                        alt=""
                        draggable={false}
                        className="h-full w-full object-contain pointer-events-none select-none"
                      />
                    ) : selectedBoxId === box.id ? (
                      <textarea
                        className="h-full w-full resize-none border-0 outline-none shadow-none bg-transparent px-1"
                        value={box.content}
                        onChange={(e) => patchBox(box.id, { content: e.target.value })}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div
                        className="h-full w-full outline-none border-0 px-1 whitespace-pre-wrap"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setSelectedBoxId(box.id);
                        }}
                      >
                        {box.content}
                      </div>
                    )}
                  </CanvasTextBoxFrame>
                );
              })
            : null}
        </div>
      </div>
      </div>
    </div>
  );
}

/** Remove persisted overlay markup so it never leaks into the contentEditable body. */
export function stripOfferOverlayArtifacts(html: string): string {
  let out = html
    .replace(/<!--\s*SYNC_TEXT_BOXES:[\s\S]*?-->/gi, '')
    .replace(/<div\s+class="sync-text-boxes"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<!--\s*SYNC_OFFER_BODY:[\s\S]*?-->/gi, '')
    .replace(/<!--\s*SYNC_BODY_BOX:[\s\S]*?-->/gi, '');
  // Stray horizontal rules often appear at the top of a moved text box
  out = out.replace(/^(?:\s|&nbsp;|<br\s*\/?>)*<hr\b[^>]*>/i, '');
  return out.trim();
}

/** Pull CSS text from a full offer-letter HTML document. */
export function extractDocumentCss(pageHtml: string): string {
  const parts: string[] = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pageHtml)) !== null) {
    const css = (m[1] || '').trim();
    if (css) parts.push(css);
  }
  return parts.join('\n');
}

/**
 * Scope template CSS to the design canvas so Design ≈ Preview.
 * Neutralize page-level absolute .content-area rules (the canvas frame owns position).
 */
export function scopeOfferEditorCss(css: string): string {
  let out = String(css || '');
  // Drop @page (print-only)
  out = out.replace(/@page\s*\{[^}]*\}/gi, '');
  // body rules → canvas root
  out = out.replace(/(^|})\s*body\s*\{/gi, '$1 .offer-template-canvas {');
  out = out.replace(/(^|})\s*html\s*\{/gi, '$1 .offer-template-canvas {');
  // Keep content-area typography but not absolute page offsets inside the frame
  out = out.replace(
    /\.content-area\s*\{[^}]*\}/gi,
    `.content-area {
      position: relative !important;
      left: auto !important;
      top: auto !important;
      width: 100% !important;
      min-height: 100% !important;
      height: auto !important;
      padding: 0 !important;
      margin: 0 !important;
      overflow: visible !important;
      z-index: 1;
      box-sizing: border-box;
    }`,
  );
  // Hide letterhead img tags if any leaked into body HTML (canvas uses backgroundImage)
  out += `
    .offer-template-canvas img.letterhead-bg { display: none !important; }
    .offer-template-canvas .content-area > hr:first-child,
    .offer-template-canvas .content-area > div:first-child > hr:first-child {
      display: none;
    }
    .offer-template-canvas .content-area hr {
      border: none;
      border-top: 1px solid #334155;
      margin: 12pt 0;
      height: 0;
    }
    .offer-template-canvas .sync-textbox {
      border: none;
    }
  `;
  return out;
}

/** Find the end index of the matching closing </div> for a div that opened at openEnd. */
function findMatchingDivClose(html: string, openEnd: number): number {
  const lower = html.toLowerCase();
  let depth = 1;
  let i = openEnd;
  while (i < html.length && depth > 0) {
    const nextOpen = lower.indexOf('<div', i);
    const nextClose = lower.indexOf('</div>', i);
    if (nextClose < 0) return -1;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      // Only count real div tags (not <divider> etc.) — '<div' already scoped
      depth += 1;
      i = nextOpen + 4;
    } else {
      depth -= 1;
      if (depth === 0) return nextClose;
      i = nextClose + 6;
    }
  }
  return -1;
}

/** Pull inner HTML of `.content-area` from a full offer-letter page document. */
export function extractContentAreaHtml(pageHtml: string): string {
  const openMatch = /<div\s+class="content-area"[^>]*>/i.exec(pageHtml);
  if (!openMatch || openMatch.index == null) {
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(pageHtml);
    return stripOfferOverlayArtifacts(body ? body[1] : pageHtml);
  }
  const start = openMatch.index + openMatch[0].length;
  const closeAt = findMatchingDivClose(pageHtml, start);
  if (closeAt < 0) {
    return stripOfferOverlayArtifacts(pageHtml.slice(start));
  }
  return stripOfferOverlayArtifacts(pageHtml.slice(start, closeAt));
}

/** Replace `.content-area` inner HTML inside a full page document. */
export function injectContentAreaHtml(pageHtml: string, innerHtml: string): string {
  const cleanInner = stripOfferOverlayArtifacts(innerHtml);
  const openMatch = /<div\s+class="content-area"[^>]*>/i.exec(pageHtml);
  if (!openMatch || openMatch.index == null) {
    if (/<body[^>]*>/i.test(pageHtml)) {
      return pageHtml.replace(/<body[^>]*>[\s\S]*<\/body>/i, `<body>\n${cleanInner}\n</body>`);
    }
    return cleanInner;
  }
  const openEnd = openMatch.index + openMatch[0].length;
  const closeAt = findMatchingDivClose(pageHtml, openEnd);
  if (closeAt < 0) {
    return `${pageHtml.slice(0, openEnd)}\n${cleanInner}\n${pageHtml.slice(openEnd)}`;
  }
  return `${pageHtml.slice(0, openEnd)}\n${cleanInner}\n${pageHtml.slice(closeAt)}`;
}

import { useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Move } from 'lucide-react';

export type CanvasBoxGeom = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export type TextBoxDivider = 'none' | 'top' | 'bottom';

type Props = {
  geom: CanvasBoxGeom;
  selected?: boolean;
  locked?: boolean;
  /** When false, only show content (print / issue preview). */
  editable?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  onSelect?: () => void;
  onMove?: (next: CanvasBoxGeom) => void;
  onResize?: (next: CanvasBoxGeom) => void;
  /** Center-origin positioning (certificates). Default true. */
  centerOrigin?: boolean;
  /**
   * Show a grab bar so nested contentEditable text can still be moved
   * (drag from the bar, not from inside the text).
   */
  showMoveHandle?: boolean;
  moveHandleLabel?: string;
  /**
   * Optional divider line on the box (off by default).
   * Never draws a permanent frame edge — only this opt-in line.
   */
  divider?: TextBoxDivider;
  /** Inner content overflow. Body letter text should be `visible` (no scrollbar). */
  contentOverflow?: 'auto' | 'hidden' | 'visible';
  /**
   * Use min-height instead of fixed height so content can grow like print/PDF
   * (avoids an inner scrollbar and keeps wrap width stable).
   */
  growWithContent?: boolean;
  /** When false, hide corner resize handles (move-only). */
  allowResize?: boolean;
};

/**
 * Google Slides–style frame: drag to move, corner handles to resize.
 * Geometry is percent of the parent canvas (0–100).
 */
export function CanvasTextBoxFrame({
  geom,
  selected,
  locked,
  editable = true,
  className,
  style,
  children,
  onSelect,
  onMove,
  onResize,
  centerOrigin = true,
  showMoveHandle = false,
  moveHandleLabel = 'Move text',
  divider = 'none',
  contentOverflow = 'auto',
  growWithContent = false,
  allowResize = true,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onMoveRef = useRef(onMove);
  const onResizeRef = useRef(onResize);
  onMoveRef.current = onMove;
  onResizeRef.current = onResize;

  const dragRef = useRef<{
    mode: 'move' | ResizeCorner;
    startX: number;
    startY: number;
    orig: CanvasBoxGeom;
    canvasW: number;
    canvasH: number;
  } | null>(null);

  useEffect(() => {
    if (!editable || locked) return;
    const onMoveWin = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      const dxPct = ((e.clientX - d.startX) / d.canvasW) * 100;
      const dyPct = ((e.clientY - d.startY) / d.canvasH) * 100;

      if (d.mode === 'move') {
        const fn = onMoveRef.current;
        if (!fn) return;
        if (centerOrigin) {
          fn({
            ...d.orig,
            x: clamp(d.orig.x + dxPct, 0, 100),
            y: clamp(d.orig.y + dyPct, 0, 100),
          });
        } else {
          fn({
            ...d.orig,
            x: clamp(d.orig.x + dxPct, 0, Math.max(0, 100 - d.orig.width)),
            y: clamp(d.orig.y + dyPct, 0, Math.max(0, 100 - d.orig.height)),
          });
        }
        return;
      }

      const fn = onResizeRef.current;
      if (!fn) return;
      let { x, y, width, height } = d.orig;
      const min = 4;

      if (centerOrigin) {
        if (d.mode === 'se' || d.mode === 'ne') width = Math.max(min, d.orig.width + dxPct);
        if (d.mode === 'sw' || d.mode === 'nw') width = Math.max(min, d.orig.width - dxPct);
        if (d.mode === 'se' || d.mode === 'sw') height = Math.max(min, d.orig.height + dyPct);
        if (d.mode === 'ne' || d.mode === 'nw') height = Math.max(min, d.orig.height - dyPct);
        width = Math.min(width, 100);
        height = Math.min(height, 100);
        fn({ x, y, width, height });
        return;
      }

      if (d.mode.includes('e')) width = Math.max(min, d.orig.width + dxPct);
      if (d.mode.includes('s')) height = Math.max(min, d.orig.height + dyPct);
      if (d.mode.includes('w')) {
        const nextW = Math.max(min, d.orig.width - dxPct);
        x = d.orig.x + (d.orig.width - nextW);
        width = nextW;
      }
      if (d.mode.includes('n')) {
        const nextH = Math.max(min, d.orig.height - dyPct);
        y = d.orig.y + (d.orig.height - nextH);
        height = nextH;
      }
      width = Math.min(width, 100 - x);
      height = Math.min(height, 100 - y);
      fn({
        x: clamp(x, 0, 100),
        y: clamp(y, 0, 100),
        width: Math.max(min, width),
        height: Math.max(min, height),
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMoveWin, { passive: false });
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMoveWin);
      window.removeEventListener('mouseup', onUp);
    };
  }, [editable, locked, centerOrigin]);

  const resolveCanvasRect = () => {
    const el = rootRef.current;
    if (!el) return null;
    const canvas =
      (el.closest('[data-canvas-root]') as HTMLElement | null) ||
      (el.offsetParent as HTMLElement | null);
    if (!canvas) return null;
    return canvas.getBoundingClientRect();
  };

  const startDrag = (e: ReactMouseEvent, mode: 'move' | ResizeCorner) => {
    if (!editable || locked) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.();
    const rect = resolveCanvasRect();
    if (!rect) return;
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...geom },
      canvasW: rect.width || 1,
      canvasH: rect.height || 1,
    };
  };

  const handles: ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];
  const handlePos: Record<ResizeCorner, string> = {
    nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
    ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
    sw: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
    se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        'absolute flex flex-col',
        editable && !locked && 'select-none',
        selected && editable && 'z-30',
        className,
      )}
      style={{
        left: `${geom.x}%`,
        top: `${geom.y}%`,
        width: `${geom.width}%`,
        ...(growWithContent
          ? { minHeight: `${geom.height}%`, height: 'auto' }
          : { height: `${geom.height}%` }),
        transform: centerOrigin ? 'translate(-50%, -50%)' : undefined,
        // Only show selection chrome when selected — never a permanent edge line
        // that would look like part of the letter / preview.
        outline: selected && editable && !locked ? '2px solid #1a73e8' : 'none',
        outlineOffset: selected && editable && !locked ? 2 : 0,
        cursor: editable && !locked && !showMoveHandle ? 'move' : undefined,
        boxSizing: 'border-box',
        ...style,
        // Force no frame border; optional divider is the only printed edge line.
        borderStyle: 'solid',
        borderColor: '#334155',
        borderWidth: 0,
        borderTopWidth: divider === 'top' ? 1 : 0,
        borderBottomWidth: divider === 'bottom' ? 1 : 0,
      }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement)?.closest('[data-resize-handle]')) return;
        if ((e.target as HTMLElement)?.closest('[data-move-handle]')) return;
        if ((e.target as HTMLElement)?.isContentEditable) return;
        if ((e.target as HTMLElement)?.closest('[contenteditable="true"]')) return;
        if (showMoveHandle) {
          onSelect?.();
          return;
        }
        startDrag(e, 'move');
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
    >
      {editable && showMoveHandle && !locked ? (
        <div
          data-move-handle
          className={cn(
            'absolute left-0 right-0 z-50 flex h-5 -translate-y-full cursor-grab active:cursor-grabbing items-center justify-center gap-1 rounded-t-sm text-[10px] font-medium select-none opacity-90 hover:opacity-100',
            selected ? 'bg-[#1a73e8] text-white' : 'bg-sky-600/90 text-white',
          )}
          style={{ top: 0 }}
          onMouseDown={(e) => startDrag(e, 'move')}
          title="Drag to move on the page"
        >
          <Move className="h-3 w-3" />
          {moveHandleLabel}
        </div>
      ) : null}
      <div
        className={cn(
          'relative pointer-events-auto w-full',
          growWithContent ? 'min-h-full' : 'min-h-0 flex-1 h-full',
          contentOverflow === 'visible' && 'overflow-visible',
          contentOverflow === 'hidden' && 'overflow-hidden',
          contentOverflow === 'auto' && 'overflow-auto',
        )}
      >
        {children}
      </div>
      {editable && selected && !locked && allowResize ? (
        <>
          {handles.map((h) => (
            <span
              key={h}
              data-resize-handle
              className={cn(
                'absolute z-40 h-3.5 w-3.5 rounded-sm border-2 border-white bg-[#1a73e8] shadow-md',
                handlePos[h],
              )}
              onMouseDown={(e) => startDrag(e, h)}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export type OfferTextBox = {
  id: string;
  /** text (default) or image (content = data URL / src) */
  type?: 'text' | 'image';
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** Optional divider line (off by default). */
  divider?: TextBoxDivider;
};

export function normalizeTextBoxDivider(v: unknown): TextBoxDivider {
  if (v === 'top' || v === 'bottom') return v;
  if (v === true || v === 'true' || v === 1) return 'bottom';
  return 'none';
}

export function cycleTextBoxDivider(current?: TextBoxDivider): TextBoxDivider {
  if (current === 'bottom') return 'top';
  if (current === 'top') return 'none';
  return 'bottom';
}

export type OfferBodyBox = CanvasBoxGeom;

const BODY_MARKER_RE = /<!--\s*SYNC_BODY_BOX:([\s\S]*?)-->/i;

export const DEFAULT_OFFER_BODY_BOX: OfferBodyBox = {
  x: 13.3,
  y: 18.5,
  width: 73.4,
  height: 73,
};

export function extractOfferBodyBox(pageHtml: string): OfferBodyBox {
  const m = BODY_MARKER_RE.exec(pageHtml);
  if (m?.[1]) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && typeof parsed === 'object') {
        return {
          x: Number(parsed.x) || DEFAULT_OFFER_BODY_BOX.x,
          y: Number(parsed.y) || DEFAULT_OFFER_BODY_BOX.y,
          width: Number(parsed.width) || DEFAULT_OFFER_BODY_BOX.width,
          height: Number(parsed.height) || DEFAULT_OFFER_BODY_BOX.height,
        };
      }
    } catch {
      /* fall through */
    }
  }
  const pad = pageHtml.match(
    /\.content-area\s*\{[^}]*padding:\s*([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm/,
  );
  if (pad) {
    const top = parseFloat(pad[1]);
    const right = parseFloat(pad[2]);
    const bottom = parseFloat(pad[3]);
    const left = parseFloat(pad[4]);
    return {
      x: (left / 210) * 100,
      y: (top / 297) * 100,
      width: ((210 - left - right) / 210) * 100,
      height: ((297 - top - bottom) / 297) * 100,
    };
  }
  return { ...DEFAULT_OFFER_BODY_BOX };
}

/** Persist body position + update .content-area CSS for print/PDF. */
export function injectOfferBodyBox(pageHtml: string, box: OfferBodyBox): string {
  const marker = `<!--SYNC_BODY_BOX:${JSON.stringify(box)}-->`;
  let html = pageHtml.replace(BODY_MARKER_RE, '');

  // Same geometry model as the editor frame (top-left origin, % of A4 page).
  // min-height (not fixed height) so content grows; no overflow scroll.
  const contentCss = `.content-area {
    position: absolute;
    left: ${box.x}%;
    top: ${box.y}%;
    width: ${box.width}%;
    min-height: ${box.height}%;
    height: auto;
    z-index: 1;
    padding: 0;
    margin: 0;
    overflow: visible;
    box-sizing: border-box;
  }`;

  if (/\.content-area\s*\{[^}]*\}/i.test(html)) {
    html = html.replace(/\.content-area\s*\{[^}]*\}/i, contentCss);
  } else if (/<\/style>/i.test(html)) {
    html = html.replace(/<\/style>/i, `${contentCss}\n</style>`);
  }

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${marker}\n</body>`);
  }
  return `${html}\n${marker}`;
}

const BOX_MARKER_RE = /<!--\s*SYNC_TEXT_BOXES:([\s\S]*?)-->/i;

export function extractOfferTextBoxes(pageHtml: string): OfferTextBox[] {
  const m = BOX_MARKER_RE.exec(pageHtml);
  if (!m?.[1]) return [];
  try {
    const parsed = JSON.parse(m[1].trim());
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((b) => b && typeof b.id === 'string')
      .map((b) => ({
        id: String(b.id),
        type: b.type === 'image' ? 'image' : 'text',
        content: String(b.content ?? ''),
        x: Number(b.x) || 50,
        y: Number(b.y) || 40,
        width: Number(b.width) || 40,
        height: Number(b.height) || 8,
        fontSize: b.fontSize != null ? Number(b.fontSize) : 14,
        fontFamily: b.fontFamily ? String(b.fontFamily) : undefined,
        fontWeight: b.fontWeight === 'bold' ? 'bold' : 'normal',
        fontStyle: b.fontStyle === 'italic' ? 'italic' : 'normal',
        color: b.color ? String(b.color) : '#1a1a2e',
        align: b.align === 'left' || b.align === 'right' ? b.align : 'center',
        divider: normalizeTextBoxDivider(b.divider ?? b.showDivider),
      }));
  } catch {
    return [];
  }
}

export function injectOfferTextBoxesMarker(pageHtml: string, boxes: OfferTextBox[]): string {
  const marker = `<!--SYNC_TEXT_BOXES:${JSON.stringify(boxes)}-->`;
  let without = pageHtml.replace(BOX_MARKER_RE, '');
  without = without.replace(/<div\s+class="sync-text-boxes"[^>]*>[\s\S]*?<\/div>/i, '');
  const rendered = boxes.length
    ? `\n<div class="sync-text-boxes" style="position:absolute;inset:0;pointer-events:none;z-index:5;">${boxes
        .map((b) => {
          const divider = normalizeTextBoxDivider(b.divider);
          const dividerCss =
            divider === 'top'
              ? 'border-top:1px solid #334155;border-bottom:none;'
              : divider === 'bottom'
                ? 'border-bottom:1px solid #334155;border-top:none;'
                : 'border:none;';
          if (b.type === 'image') {
            return `<div class="sync-textbox sync-imagebox" style="position:absolute;left:${b.x}%;top:${b.y}%;width:${b.width}%;height:${b.height}%;transform:translate(-50%,-50%);overflow:hidden;${dividerCss}"><img src="${escapeAttr(b.content)}" alt="" style="width:100%;height:100%;object-fit:contain;" /></div>`;
          }
          return `<div class="sync-textbox" style="position:absolute;left:${b.x}%;top:${b.y}%;width:${b.width}%;min-height:${b.height}%;transform:translate(-50%,-50%);font-size:${b.fontSize ?? 14}px;font-family:${escapeAttr(b.fontFamily || 'Georgia, serif')};font-weight:${b.fontWeight || 'normal'};font-style:${b.fontStyle || 'normal'};color:${escapeAttr(b.color || '#1a1a2e')};text-align:${b.align || 'center'};white-space:pre-wrap;line-height:1.4;${dividerCss}">${escapeHtml(b.content)}</div>`;
        })
        .join('')}</div>\n`
    : '';

  if (/<\/body>/i.test(without)) {
    return without.replace(/<\/body>/i, `${marker}${rendered}</body>`);
  }
  return `${without}\n${marker}${rendered}`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string) {
  return s.replace(/"/g, '&quot;');
}

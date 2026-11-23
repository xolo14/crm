import { useEffect, useState } from "react";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  /** Short question, e.g. "Delete this lead?" */
  title: string;
  /** Optional consequence, e.g. "This cannot be undone." */
  description?: string;
  /** Label of the confirming button (default "Confirm"). */
  confirmLabel?: string;
  /** Label of the cancelling button (default "Cancel"). */
  cancelLabel?: string;
  /** Red confirm button for deletes and other destructive actions. */
  destructive?: boolean;
}

type Pending = ConfirmOptions & {
  resolve: (ok: boolean) => void;
  settled?: boolean;
  /** When set, the dialog shows a text box and resolveText receives its value. */
  input?: { label: string; placeholder?: string };
  resolveText?: (value: string | null) => void;
};

let enqueue: ((pending: Pending) => void) | null = null;

/**
 * Like confirmAction, with a text box (e.g. a reason). Resolves with the trimmed text
 * (possibly empty) when confirmed, or null when cancelled.
 */
export function promptAction(options: ConfirmOptions & { inputLabel: string; placeholder?: string }): Promise<string | null> {
  if (!enqueue) {
    const v = typeof window !== "undefined" ? window.prompt([options.title, options.description].filter(Boolean).join("\n\n")) : null;
    return Promise.resolve(v === null ? null : v.trim());
  }
  return new Promise<string | null>((resolveText) =>
    enqueue?.({
      ...options,
      input: { label: options.inputLabel, placeholder: options.placeholder },
      resolve: () => undefined,
      resolveText,
    }),
  );
}

/**
 * App-styled replacement for window.confirm(): resolves true when the user confirms.
 * Works from any handler (no hook needed) once <ConfirmDialogHost /> is mounted.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (!enqueue) {
    // Host not mounted (tests, error screens): fall back to the browser prompt.
    const text = [options.title, options.description].filter(Boolean).join("\n\n");
    return Promise.resolve(typeof window !== "undefined" ? window.confirm(text) : false);
  }
  return new Promise<boolean>((resolve) => enqueue?.({ ...options, resolve }));
}

/** Mount once near the app root. Shows one confirmation at a time, above every other layer. */
export function ConfirmDialogHost() {
  const [queue, setQueue] = useState<Pending[]>([]);

  useEffect(() => {
    enqueue = (pending) => setQueue((q) => [...q, pending]);
    return () => {
      enqueue = null;
    };
  }, []);

  const current = queue[0];
  const [text, setText] = useState("");
  useEffect(() => {
    setText("");
  }, [current]);
  // Both the button's onClick and Radix's onOpenChange(false) fire for one click: settle once.
  const settle = (ok: boolean) => {
    if (!current || current.settled) return;
    current.settled = true;
    current.resolve(ok);
    current.resolveText?.(ok ? text.trim() : null);
    setQueue((q) => q.filter((p) => p !== current));
  };

  return (
    <AlertDialog
      open={!!current}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      {/* z-[200]: above full-screen dialogs (z-[100]) and bottom sheets (z-[120]). */}
      <AlertDialogContent className="z-[200]" overlayClassName="z-[200]">
        <AlertDialogHeader>
          <AlertDialogTitle>{current?.title}</AlertDialogTitle>
          {current?.description ? (
            <AlertDialogDescription className="whitespace-pre-line">{current.description}</AlertDialogDescription>
          ) : (
            <AlertDialogDescription className="sr-only">Confirm or cancel this action.</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {current?.input ? (
          <div className="space-y-1.5">
            <label htmlFor="confirm-dialog-input" className="text-sm font-medium">
              {current.input.label}
            </label>
            <textarea
              id="confirm-dialog-input"
              className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={current.input.placeholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>{current?.cancelLabel || "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(current?.destructive && buttonVariants({ variant: "destructive" }))}
            onClick={() => settle(true)}
          >
            {current?.confirmLabel || "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

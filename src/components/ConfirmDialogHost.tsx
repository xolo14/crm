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

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void; settled?: boolean };

let enqueue: ((pending: Pending) => void) | null = null;

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
  // Both the button's onClick and Radix's onOpenChange(false) fire for one click: settle once.
  const settle = (ok: boolean) => {
    if (!current || current.settled) return;
    current.settled = true;
    current.resolve(ok);
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

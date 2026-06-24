import { useCallback } from "react";
import { Delete, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;
const SUB: Record<string, string> = {
  "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL",
  "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ",
};

interface DialerPadProps {
  value: string;
  onChange: (v: string) => void;
  onCall?: () => void;
  className?: string;
}

export default function DialerPad({ value, onChange, onCall, className }: DialerPadProps) {
  const append = useCallback((k: string) => onChange(value + k), [onChange, value]);
  const backspace = useCallback(() => onChange(value.slice(0, -1)), [onChange, value]);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="rounded-xl border bg-muted/30 px-4 py-3 text-center">
        <input
          type="tel"
          inputMode="tel"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d+*#]/g, ""))}
          placeholder="Enter number"
          className="w-full bg-transparent text-center text-2xl font-semibold tracking-wider outline-none placeholder:text-muted-foreground/50"
          aria-label="Phone number"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 max-w-xs mx-auto">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => append(k)}
            className="flex h-14 sm:h-16 flex-col items-center justify-center rounded-2xl bg-muted/50 text-xl font-semibold transition-colors hover:bg-muted active:scale-95"
          >
            <span>{k}</span>
            {SUB[k] ? <span className="text-[9px] font-normal text-muted-foreground tracking-widest">{SUB[k]}</span> : null}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-center gap-4 pt-1">
        <Button type="button" variant="ghost" size="icon" className="h-12 w-12 rounded-full" onClick={backspace} disabled={!value}>
          <Delete className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          size="icon"
          className="h-16 w-16 rounded-full bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/30"
          onClick={onCall}
          disabled={!value.trim()}
          aria-label="Call"
        >
          <Phone className="h-7 w-7" />
        </Button>
        <div className="h-12 w-12" />
      </div>
    </div>
  );
}

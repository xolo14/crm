import { Loader2 } from "lucide-react";

interface SaveButtonProps {
  onClick: () => void;
  loading?: boolean;
  label?: string;
  disabled?: boolean;
}

export function SaveButton({ onClick, loading = false, label = "Save Changes", disabled = false }: SaveButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="inline-flex items-center gap-2 rounded-lg bg-[#2ed573] px-5 py-2 text-sm font-semibold text-[#0f2318] transition-all duration-150 ease-in-out hover:bg-[#22c265] disabled:cursor-not-allowed disabled:opacity-70"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {label}
    </button>
  );
}

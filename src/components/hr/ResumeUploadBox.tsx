import { useCallback, useRef } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = {
  label?: string;
  value?: File | undefined;
  onChange: (file: File | undefined) => void;
  error?: string;
  className?: string;
};

export default function ResumeUploadBox({ label = "Resume", value: resumeFile, onChange, error, className }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearResume = useCallback(() => {
    onChange(undefined);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onChange]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      onChange(f);
    },
    [onChange],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const f = e.dataTransfer.files?.[0];
      if (!f) return;
      onChange(f);
    },
    [onChange],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      <div
        role="button"
        tabIndex={0}
        className="border-2 border-dashed border-input rounded-md p-4 text-center cursor-pointer hover:border-teal-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        {!resumeFile ? (
          <>
            <Upload className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Click to upload or drag & drop</p>
            <p className="text-xs text-muted-foreground mt-0.5">PDF or Word · Max 5MB</p>
          </>
        ) : (
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 shrink-0 text-teal-500" />
              <span className="text-sm truncate max-w-[220px]">{resumeFile.name}</span>
            </div>
            <button type="button" className="shrink-0 p-1 rounded-md hover:bg-muted" onClick={(e) => { e.stopPropagation(); clearResume(); }}>
              <X className="h-4 w-4 text-muted-foreground hover:text-red-500" />
            </button>
          </div>
        )}
        <input
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileChange}
        />
      </div>
      {error ? <p className="text-xs text-red-500 mt-1">{error}</p> : null}
    </div>
  );
}

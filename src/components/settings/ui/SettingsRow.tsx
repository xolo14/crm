import { ReactNode } from "react";

interface SettingsRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  border?: boolean;
}

export function SettingsRow({ label, description, children, border = true }: SettingsRowProps) {
  return (
    <div className={`flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between ${border ? "border-b border-gray-100" : ""}`}>
      <div className="max-w-sm">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {description && <p className="mt-0.5 text-xs text-gray-400">{description}</p>}
      </div>
      <div className="w-full md:w-[320px]">{children}</div>
    </div>
  );
}

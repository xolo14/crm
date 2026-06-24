import { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <div className="mb-8">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mb-4 text-sm text-gray-500">{description}</p>
      <div className="rounded-xl border border-gray-200 bg-white">{children}</div>
    </div>
  );
}

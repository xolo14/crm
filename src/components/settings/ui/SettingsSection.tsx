import { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <div className="mb-8">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mb-4 text-sm text-muted-foreground">{description}</p>
      <div className="rounded-xl border border-border bg-card text-card-foreground">{children}</div>
    </div>
  );
}

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { useTheme } from "next-themes";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SaveButton } from "@/components/settings/ui/SaveButton";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";
import { SettingsSelect } from "@/components/settings/ui/SettingsSelect";
import { ToggleSwitch } from "@/components/settings/ui/ToggleSwitch";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface GeneralSettingsProps {
  personalOnly?: boolean;
}

export const GENERAL_SETTINGS_KEY = "crm_general_settings";
export const THEME_STORAGE_KEY = "crm-ui-theme";

type ThemeChoice = "light" | "dark" | "system";

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredTheme(): ThemeChoice | null {
  try {
    const fromNext = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeChoice(fromNext)) return fromNext;
  } catch {
    /* ignore */
  }
  try {
    const saved = JSON.parse(localStorage.getItem(GENERAL_SETTINGS_KEY) || "{}") as Record<string, unknown>;
    if (isThemeChoice(saved.theme)) return saved.theme;
  } catch {
    /* ignore */
  }
  return null;
}

function persistThemePreference(theme: ThemeChoice) {
  try {
    const prev = JSON.parse(localStorage.getItem(GENERAL_SETTINGS_KEY) || "{}") as Record<string, unknown>;
    localStorage.setItem(GENERAL_SETTINGS_KEY, JSON.stringify({ ...prev, theme }));
  } catch {
    /* ignore */
  }
}

export function GeneralSettings({ personalOnly = false }: GeneralSettingsProps) {
  const { profile, refreshOrganization } = useAuth();
  const { toast } = useToast();
  const { theme: activeTheme, setTheme: applyTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [theme, setTheme] = useState<ThemeChoice>("light");
  const [compactMode, setCompactMode] = useState(false);
  const [collapsedSidebar, setCollapsedSidebar] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [inAppNotifications, setInAppNotifications] = useState(true);
  const [smsAlerts, setSmsAlerts] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState(true);
  const [dateFormat, setDateFormat] = useState("ddmmyyyy");
  const [timeFormat, setTimeFormat] = useState("12h");
  const [timezone, setTimezone] = useState("ist");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = JSON.parse(localStorage.getItem(GENERAL_SETTINGS_KEY) || "{}") as Record<string, unknown>;
      const storedTheme = readStoredTheme();
      if (storedTheme) {
        setTheme(storedTheme);
        applyTheme(storedTheme);
      } else if (isThemeChoice(activeTheme)) {
        setTheme(activeTheme);
      }
      setCompactMode(saved.compactMode === true);
      setCollapsedSidebar(saved.collapsedSidebar === true);
      setEmailNotifications(saved.emailNotifications !== false);
      setInAppNotifications(saved.inAppNotifications !== false);
      setSmsAlerts(saved.smsAlerts === true);
      setWeeklySummary(saved.weeklySummary !== false);
      if (["ddmmyyyy", "mmddyyyy", "yyyymmdd"].includes(String(saved.dateFormat))) setDateFormat(String(saved.dateFormat));
      if (["12h", "24h"].includes(String(saved.timeFormat))) setTimeFormat(String(saved.timeFormat));
      if (["ist", "utc", "est", "pst", "gmt"].includes(String(saved.timezone))) setTimezone(String(saved.timezone));
    } catch {
      // Invalid browser storage falls back to safe defaults.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once on mount
  }, []);

  useEffect(() => {
    if (!mounted || !isThemeChoice(activeTheme)) return;
    setTheme(activeTheme);
  }, [activeTheme, mounted]);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setEmail(profile?.email ?? "");
    setPhone(profile?.phone ?? "");
    setAvatarPreview(profile?.avatar_url ?? "");
    setAvatarFile(null);
    setRemoveAvatar(false);
    setProfileError("");
  }, [profile?.full_name, profile?.email, profile?.phone, profile?.avatar_url]);

  const profileChanged = useMemo(() => {
    if (!profile) return false;
    return (
      fullName.trim() !== (profile.full_name ?? "").trim() ||
      email.trim().toLowerCase() !== (profile.email ?? "").trim().toLowerCase() ||
      phone.trim() !== (profile.phone ?? "").trim() ||
      avatarFile !== null ||
      removeAvatar
    );
  }, [profile, fullName, email, phone, avatarFile, removeAvatar]);

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      toast({ title: "Invalid profile photo", description: "Choose a JPG, PNG, or WebP image up to 2 MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
    setAvatarFile(file);
    setRemoveAvatar(false);
    setProfileError("");
  };

  const saveProfile = async () => {
    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    if (cleanName.length < 2 || cleanName.length > 100) {
      setProfileError("Full name must contain 2 to 100 characters.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setProfileError("Enter a valid email address.");
      return;
    }
    const compactPhone = cleanPhone.replace(/[\s()-]/g, "");
    if (cleanPhone && !/^\+?[0-9]{7,15}$/.test(compactPhone)) {
      setProfileError("Enter a valid phone number containing 7 to 15 digits.");
      return;
    }

    setProfileSaving(true);
    setProfileError("");
    try {
      await api.auth.updateProfile({
        full_name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        avatar: avatarFile,
        remove_avatar: removeAvatar,
      });
      await refreshOrganization();
      setAvatarFile(null);
      setRemoveAvatar(false);
      toast({ title: "Profile updated", description: "Your profile and sidebar have been refreshed." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update your profile.";
      setProfileError(message);
      toast({ title: "Profile update failed", description: message, variant: "destructive" });
    } finally {
      setProfileSaving(false);
    }
  };

  const selectTheme = (next: ThemeChoice) => {
    setTheme(next);
    applyTheme(next);
    persistThemePreference(next);
    // Ensure class is correct even if next-themes is mid-hydration
    const root = document.documentElement;
    if (next === "light") {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    } else if (next === "dark") {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", prefersDark);
      root.style.colorScheme = prefersDark ? "dark" : "light";
    }
  };

  const onSave = () => {
    setSaving(true);
    const settings = {
      theme,
      compactMode,
      collapsedSidebar,
      emailNotifications,
      inAppNotifications,
      smsAlerts,
      weeklySummary,
      dateFormat,
      timeFormat,
      timezone,
    };
    try {
      localStorage.setItem(GENERAL_SETTINGS_KEY, JSON.stringify(settings));
      selectTheme(theme);
      document.documentElement.classList.toggle("crm-compact", compactMode);
      window.dispatchEvent(new CustomEvent("crm-appearance-change", {
        detail: { compactMode, collapsedSidebar },
      }));
      toast({ title: "General settings saved", description: "Your appearance preferences have been applied." });
    } catch {
      toast({ title: "Settings could not be saved", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const themeOptions: { key: ThemeChoice; icon: string; label: string }[] = [
    { key: "light", icon: "☀", label: "Light" },
    { key: "dark", icon: "🌙", label: "Dark" },
    { key: "system", icon: "💻", label: "System" },
  ];

  const selectedTheme = mounted && isThemeChoice(activeTheme) ? activeTheme : theme;

  return (
    <div className="bg-transparent">
      <SettingsSection title="Personal Profile" description="Manage the personal details shown on your account.">
        <div className="border-b border-border px-5 py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar className="h-20 w-20 border border-border">
              {avatarPreview && <AvatarImage src={avatarPreview} alt={fullName || "Profile photo"} className="object-cover" />}
              <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
                {(fullName || email || "U").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
                  <Upload className="h-4 w-4" />
                  Choose photo
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarChange} className="hidden" />
                </label>
                {avatarPreview && (
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarPreview("");
                      setAvatarFile(null);
                      setRemoveAvatar(Boolean(profile?.avatar_url));
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">JPG, PNG, or WebP. Maximum size 2 MB.</p>
            </div>
          </div>
        </div>
        <SettingsRow label="Full name" description="Your name as shown throughout the CRM.">
          <Input value={fullName} maxLength={100} onChange={(event) => { setFullName(event.target.value); setProfileError(""); }} autoComplete="name" />
        </SettingsRow>
        <SettingsRow label="Email address" description="Used for signing in and account communication.">
          <Input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setProfileError(""); }} autoComplete="email" />
        </SettingsRow>
        <SettingsRow label="Phone number" description="Include the country code when applicable." border={false}>
          <Input type="tel" value={phone} maxLength={24} onChange={(event) => { setPhone(event.target.value); setProfileError(""); }} autoComplete="tel" />
        </SettingsRow>
        <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-destructive">{profileError}</p>
          <SaveButton onClick={() => void saveProfile()} loading={profileSaving} disabled={!profileChanged} label="Save Changes" />
        </div>
      </SettingsSection>

      <SettingsSection title="Appearance" description="Customize how the CRM looks and feels. Theme applies immediately.">
        <SettingsRow label="Theme" description={`Choose light, dark, or follow your device (${mounted ? resolvedTheme || "…" : "…"})`}>
          <div className="flex gap-2">
            {themeOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => selectTheme(option.key)}
                className={cn(
                  "w-24 rounded-xl p-3 text-center text-xs font-medium transition-all duration-150 ease-in-out",
                  option.key === selectedTheme
                    ? "border-2 border-primary bg-primary/10 text-foreground"
                    : "border border-border bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                <div>{option.icon}</div>
                <div className="mt-1">{option.label}</div>
              </button>
            ))}
          </div>
        </SettingsRow>
        {!personalOnly ? (
          <>
            <SettingsRow label="Compact Mode" description="Reduce spacing for denser layout">
              <ToggleSwitch enabled={compactMode} onChange={setCompactMode} />
            </SettingsRow>
            <SettingsRow label="Sidebar collapsed by default" description="Start with sidebar minimized" border={false}>
              <ToggleSwitch enabled={collapsedSidebar} onChange={setCollapsedSidebar} />
            </SettingsRow>
          </>
        ) : (
          <div className="px-5 pb-4 text-xs text-muted-foreground">Theme is saved automatically when you select an option.</div>
        )}
      </SettingsSection>

      {!personalOnly && (
        <>
      <SettingsSection title="Account" description="Profile information and referral code.">
        <SettingsRow label="Referral code" description="Read-only. Contact your administrator if this is blank." border={false}>
          <Input readOnly value={profile?.referral_code || "—"} className="max-w-md rounded-lg border border-border bg-muted font-mono text-sm" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Notifications" description="Control which notifications you receive.">
        <SettingsRow label="Email Notifications">
          <ToggleSwitch enabled={emailNotifications} onChange={setEmailNotifications} />
        </SettingsRow>
        <SettingsRow label="In-app Notifications">
          <ToggleSwitch enabled={inAppNotifications} onChange={setInAppNotifications} />
        </SettingsRow>
        <SettingsRow label="SMS Alerts">
          <ToggleSwitch enabled={smsAlerts} onChange={setSmsAlerts} />
        </SettingsRow>
        <SettingsRow label="Weekly Summary Email" border={false}>
          <ToggleSwitch enabled={weeklySummary} onChange={setWeeklySummary} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Date & Time" description="Display preferences (activity times use India Standard Time / IST across the CRM).">
        <SettingsRow label="Date Format">
          <SettingsSelect
            value={dateFormat}
            onChange={setDateFormat}
            options={[
              { value: "ddmmyyyy", label: "DD/MM/YYYY" },
              { value: "mmddyyyy", label: "MM/DD/YYYY" },
              { value: "yyyymmdd", label: "YYYY-MM-DD" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Time Format">
          <SettingsSelect
            value={timeFormat}
            onChange={setTimeFormat}
            options={[
              { value: "12h", label: "12 Hour" },
              { value: "24h", label: "24 Hour" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Timezone" border={false}>
          <SettingsSelect
            value={timezone}
            onChange={setTimezone}
            options={[
              { value: "ist", label: "IST" },
              { value: "utc", label: "UTC" },
              { value: "est", label: "EST" },
              { value: "pst", label: "PST" },
              { value: "gmt", label: "GMT" },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <div className="flex justify-end">
        <SaveButton onClick={onSave} loading={saving} label="Save General Settings" />
      </div>
        </>
      )}
    </div>
  );
}

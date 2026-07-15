import { ChangeEvent, useEffect, useState } from "react";
import { Globe, Instagram, Linkedin, Upload, Twitter } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { SaveButton } from "@/components/settings/ui/SaveButton";
import { SettingsInput } from "@/components/settings/ui/SettingsInput";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";
import { SettingsSelect } from "@/components/settings/ui/SettingsSelect";

export function CompanyProfile() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [companyName, setCompanyName] = useState("");
  const [tagline, setTagline] = useState("");
  const [website, setWebsite] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [country, setCountry] = useState("india");
  const [postalCode, setPostalCode] = useState("");
  const [linkedIn, setLinkedIn] = useState("");
  const [twitter, setTwitter] = useState("");
  const [instagram, setInstagram] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.organizations.myOrg();
        if (!active) return;
        const org = (res as any)?.data;
        if (!org) return;
        const profile = org.profile || {};
        setCompanyName(org.name || "");
        setLogoPreview(org.logo_url || "");
        setTagline(profile.tagline || "");
        setWebsite(profile.website || "");
        setSupportEmail(profile.support_email || "");
        setSupportPhone(profile.support_phone || "");
        setStreet(profile.street || "");
        setCity(profile.city || "");
        setStateName(profile.state || "");
        setCountry(profile.country || "india");
        setPostalCode(profile.postal_code || "");
        setLinkedIn(profile.linkedin || "");
        setTwitter(profile.twitter || "");
        setInstagram(profile.instagram || "");
      } catch (e) {
        // Non-fatal — form just stays blank if this fails (e.g. no org on account yet).
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const onSave = async () => {
    setSaving(true);
    try {
      await api.organizations.updateProfile({
        name: companyName,
        tagline,
        website,
        support_email: supportEmail,
        support_phone: supportPhone,
        street,
        city,
        state: stateName,
        country,
        postal_code: postalCode,
        linkedin: linkedIn,
        twitter,
        instagram,
      });
      toast({ title: "Company profile saved" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save company profile";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/svg+xml"];
    if (!allowed.includes(file.type) || file.size > 2 * 1024 * 1024) {
      window.alert("Only PNG, JPG, SVG up to 2MB are allowed.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setLogoPreview(e.target?.result as string);
    reader.readAsDataURL(file);
    toast({ title: "Logo preview updated", description: "Logo upload storage is coming soon — this preview isn't saved yet." });
  };

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading company profile…</div>;
  }

  return (
    <div className="bg-gray-50">
      <SettingsSection title="Brand Identity" description="Manage your company branding details.">
        <div className="border-b border-gray-100 px-5 py-6">
          <div className="flex flex-col items-center">
            <div className="flex h-40 w-40 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50">
              {logoPreview ? (
                <img src={logoPreview} alt="Company logo" className="h-full w-full rounded-xl object-cover" />
              ) : (
                <Globe className="h-10 w-10 text-gray-400" />
              )}
            </div>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-all duration-150 ease-in-out hover:bg-gray-100">
              <Upload className="h-4 w-4" />
              Upload Logo
              <input type="file" accept=".png,.jpg,.jpeg,.svg" onChange={handleLogoUpload} className="hidden" />
            </label>
            <p className="mt-2 text-xs text-gray-400">PNG, JPG, SVG - max 2MB. Upload storage coming soon.</p>
          </div>
        </div>
        <SettingsRow label="Company Name">
          <SettingsInput value={companyName} onChange={setCompanyName} />
        </SettingsRow>
        <SettingsRow label="Tagline / Description">
          <textarea
            value={tagline}
            rows={3}
            onChange={(e) => setTagline(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1"
          />
        </SettingsRow>
        <SettingsRow label="Website URL">
          <SettingsInput value={website} onChange={setWebsite} type="url" />
        </SettingsRow>
        <SettingsRow label="Support Email">
          <SettingsInput value={supportEmail} onChange={setSupportEmail} type="email" />
        </SettingsRow>
        <SettingsRow label="Support Phone" border={false}>
          <SettingsInput value={supportPhone} onChange={setSupportPhone} type="tel" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Address" description="Set your official business address.">
        <SettingsRow label="Street Address">
          <SettingsInput value={street} onChange={setStreet} />
        </SettingsRow>
        <SettingsRow label="City">
          <SettingsInput value={city} onChange={setCity} />
        </SettingsRow>
        <SettingsRow label="State">
          <SettingsInput value={stateName} onChange={setStateName} />
        </SettingsRow>
        <SettingsRow label="Country">
          <SettingsSelect
            value={country}
            onChange={setCountry}
            options={[
              { value: "india", label: "India" },
              { value: "usa", label: "United States" },
              { value: "uk", label: "United Kingdom" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Postal Code" border={false}>
          <SettingsInput value={postalCode} onChange={setPostalCode} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Social Links" description="Add your official social media pages.">
        <SettingsRow label="LinkedIn">
          <div className="relative">
            <Linkedin className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={linkedIn}
              onChange={(e) => setLinkedIn(e.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1"
            />
          </div>
        </SettingsRow>
        <SettingsRow label="Twitter/X">
          <div className="relative">
            <Twitter className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={twitter}
              onChange={(e) => setTwitter(e.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1"
            />
          </div>
        </SettingsRow>
        <SettingsRow label="Instagram" border={false}>
          <div className="relative">
            <Instagram className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1"
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      <div className="flex justify-end">
        <SaveButton onClick={onSave} loading={saving} label="Save Company Profile" />
      </div>
    </div>
  );
}

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, Globe, Instagram, Linkedin, Search, Upload, Twitter } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { resolveUploadSrc } from "@/lib/resumeHref";
import { normalizeAppRole } from "@/lib/roleUtils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SaveButton } from "@/components/settings/ui/SaveButton";
import { SettingsInput } from "@/components/settings/ui/SettingsInput";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";
import { SettingsSelect } from "@/components/settings/ui/SettingsSelect";

type OrgListItem = {
  id: string;
  name?: string;
  slug?: string;
  logo_url?: string | null;
  is_active?: number | boolean;
  plan?: string;
  industry?: string;
};

type ProfileFields = {
  logoPreview: string;
  logoUrl: string;
  companyName: string;
  tagline: string;
  website: string;
  supportEmail: string;
  supportPhone: string;
  staffIdPrefix: string;
  /** Prefix in effect when none is saved (derived from the company name). */
  staffIdPrefixEffective: string;
  staffIdPrefixAuto: boolean;
  street: string;
  city: string;
  stateName: string;
  country: string;
  postalCode: string;
  linkedIn: string;
  twitter: string;
  instagram: string;
};

const emptyProfile = (): ProfileFields => ({
  logoPreview: "",
  logoUrl: "",
  companyName: "",
  tagline: "",
  website: "",
  supportEmail: "",
  supportPhone: "",
  staffIdPrefix: "",
  staffIdPrefixEffective: "",
  staffIdPrefixAuto: false,
  street: "",
  city: "",
  stateName: "",
  country: "india",
  postalCode: "",
  linkedIn: "",
  twitter: "",
  instagram: "",
});

function applyOrgToProfile(org: any): ProfileFields {
  const profile = org?.profile || {};
  const nextLogo = String(org?.logo_url || "").trim();
  return {
    logoUrl: nextLogo,
    logoPreview: nextLogo ? resolveUploadSrc(nextLogo) : "",
    companyName: String(org?.name || ""),
    tagline: String(profile.tagline || ""),
    website: String(profile.website || ""),
    supportEmail: String(profile.support_email || ""),
    supportPhone: String(profile.support_phone || ""),
    staffIdPrefix: String(profile.staff_id_prefix || "").toUpperCase(),
    staffIdPrefixEffective: String(org?.staff_id_prefix_effective || profile.staff_id_prefix || "").toUpperCase(),
    staffIdPrefixAuto: profile.staff_id_prefix_auto === true || profile.staff_id_prefix_auto === 1,
    street: String(profile.street || ""),
    city: String(profile.city || ""),
    stateName: String(profile.state || ""),
    country: String(profile.country || "india"),
    postalCode: String(profile.postal_code || ""),
    linkedIn: String(profile.linkedin || ""),
    twitter: String(profile.twitter || ""),
    instagram: String(profile.instagram || ""),
  };
}

function DetailValue({ value, mono }: { value?: string; mono?: boolean }) {
  const v = String(value || "").trim();
  if (!v) return <span className="text-muted-foreground">—</span>;
  return <span className={cn("break-all", mono && "font-mono text-xs")}>{v}</span>;
}

function CompanyDetailsReadonly({ fields }: { fields: ProfileFields }) {
  const countryLabel =
    fields.country === "usa"
      ? "United States"
      : fields.country === "uk"
        ? "United Kingdom"
        : fields.country === "india"
          ? "India"
          : fields.country || "—";

  return (
    <div className="space-y-4">
      <SettingsSection title="Brand Identity" description="Logo and company name saved by the organization admin.">
        <div className="border-b border-gray-100 px-5 py-6">
          <div className="flex flex-col items-center sm:flex-row sm:items-start gap-4">
            <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-transparent">
              {fields.logoPreview ? (
                <img
                  src={fields.logoPreview}
                  alt="Company logo"
                  className="max-h-full max-w-full object-contain bg-transparent"
                />
              ) : (
                <Globe className="h-8 w-8 text-gray-400" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Company name</p>
                <p className="font-semibold text-foreground">{fields.companyName || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tagline</p>
                <p className="text-foreground whitespace-pre-wrap">{fields.tagline || "—"}</p>
              </div>
            </div>
          </div>
        </div>
        <SettingsRow label="Website">
          <DetailValue value={fields.website} />
        </SettingsRow>
        <SettingsRow label="Support Email">
          <DetailValue value={fields.supportEmail} />
        </SettingsRow>
        <SettingsRow label="Support Phone">
          <DetailValue value={fields.supportPhone} />
        </SettingsRow>
        <SettingsRow label="Org ID prefix" border={false}>
          <span className="inline-flex items-center gap-2">
            <DetailValue value={fields.staffIdPrefix || fields.staffIdPrefixEffective} mono />
            {(fields.staffIdPrefixAuto || !fields.staffIdPrefix) && (fields.staffIdPrefix || fields.staffIdPrefixEffective) ? (
              <span className="text-[10px] text-muted-foreground">auto from company name</span>
            ) : null}
          </span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Address" description="Official business address from the org admin.">
        <SettingsRow label="Street">
          <DetailValue value={fields.street} />
        </SettingsRow>
        <SettingsRow label="City">
          <DetailValue value={fields.city} />
        </SettingsRow>
        <SettingsRow label="State">
          <DetailValue value={fields.stateName} />
        </SettingsRow>
        <SettingsRow label="Country">
          <DetailValue value={countryLabel} />
        </SettingsRow>
        <SettingsRow label="Postal Code" border={false}>
          <DetailValue value={fields.postalCode} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Social Links" description="Social pages saved by the org admin.">
        <SettingsRow label="LinkedIn">
          <DetailValue value={fields.linkedIn} />
        </SettingsRow>
        <SettingsRow label="Twitter/X">
          <DetailValue value={fields.twitter} />
        </SettingsRow>
        <SettingsRow label="Instagram" border={false}>
          <DetailValue value={fields.instagram} />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

export function CompanyProfile() {
  const { toast } = useToast();
  const { organization, role, refreshOrganization } = useAuth();
  const isSuperAdmin = normalizeAppRole(role) === "super_admin";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [fields, setFields] = useState<ProfileFields>(emptyProfile);

  // Super admin: company directory
  const [orgs, setOrgs] = useState<OrgListItem[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgSearch, setOrgSearch] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const filteredOrgs = useMemo(() => {
    const q = orgSearch.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter(
      (o) =>
        String(o.name || "").toLowerCase().includes(q) ||
        String(o.slug || "").toLowerCase().includes(q) ||
        String(o.industry || "").toLowerCase().includes(q),
    );
  }, [orgs, orgSearch]);

  // Org admin: load own company profile
  useEffect(() => {
    if (isSuperAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api.organizations.myOrg();
        if (!active) return;
        const org = (res as any)?.data;
        setFields(org ? applyOrgToProfile(org) : emptyProfile());
      } catch {
        if (active) setFields(emptyProfile());
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isSuperAdmin]);

  // Super admin: load all companies
  useEffect(() => {
    if (!isSuperAdmin) return;
    let active = true;
    (async () => {
      setOrgsLoading(true);
      setLoading(false);
      try {
        const res = await api.organizations.list();
        if (!active) return;
        const rows = Array.isArray((res as any)?.data) ? (res as any).data : Array.isArray(res) ? res : [];
        setOrgs(
          rows
            .map((r: any) => ({
              id: String(r?.id || "").trim(),
              name: String(r?.name || "").trim(),
              slug: String(r?.slug || "").trim(),
              logo_url: r?.logo_url ?? null,
              is_active: r?.is_active,
              plan: r?.plan,
              industry: r?.industry,
            }))
            .filter((r: OrgListItem) => r.id),
        );
      } catch {
        if (active) setOrgs([]);
      } finally {
        if (active) setOrgsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isSuperAdmin]);

  const openOrgDetails = async (orgId: string) => {
    setSelectedOrgId(orgId);
    setDetailLoading(true);
    try {
      const res = await api.organizations.myOrg(orgId);
      const org = (res as any)?.data;
      setFields(org ? applyOrgToProfile(org) : emptyProfile());
    } catch (e: unknown) {
      setFields(emptyProfile());
      const msg = e instanceof Error ? e.message : "Could not load company details";
      toast({ variant: "destructive", title: "Load failed", description: msg });
    } finally {
      setDetailLoading(false);
    }
  };

  const patchField = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await api.organizations.updateProfile({
        name: fields.companyName,
        logo_url: fields.logoUrl,
        tagline: fields.tagline,
        website: fields.website,
        support_email: fields.supportEmail,
        support_phone: fields.supportPhone,
        staff_id_prefix: fields.staffIdPrefix,
        street: fields.street,
        city: fields.city,
        state: fields.stateName,
        country: fields.country,
        postal_code: fields.postalCode,
        linkedin: fields.linkedIn,
        twitter: fields.twitter,
        instagram: fields.instagram,
      }, isSuperAdmin && selectedOrgId ? selectedOrgId : undefined);
      await refreshOrganization();
      const assigned = Number((res as { staff_ids_assigned?: number })?.staff_ids_assigned || 0);
      const myStaffId = String((res as { my_staff_id?: string })?.my_staff_id || "").trim();
      if (myStaffId) {
        try {
          const raw = localStorage.getItem("auth_user");
          if (raw) {
            const stored = JSON.parse(raw);
            if (stored && stored.referral_code !== myStaffId) {
              stored.referral_code = myStaffId;
              localStorage.setItem("auth_user", JSON.stringify(stored));
            }
          }
        } catch {
          /* keep the saved profile even if the session cache cannot be patched */
        }
      }
      toast({
        title: "Company profile saved",
        description:
          assigned > 0
            ? `Assigned ${assigned} staff ID${assigned === 1 ? "" : "s"}. Other users see theirs after a page refresh.`
            : "Staff IDs are up to date.",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save company profile";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
    if (!allowed.includes(file.type) || file.size > 2 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Invalid logo",
        description: "Use PNG, JPG, SVG, or WebP up to 2MB (preferably transparent PNG).",
      });
      return;
    }
    setUploadingLogo(true);
    try {
      const res = await api.organizations.uploadLogo(file);
      const next = String(res.logo_url || "").trim();
      setFields((prev) => ({
        ...prev,
        logoUrl: next,
        logoPreview: next ? resolveUploadSrc(next) : "",
      }));
      await refreshOrganization();
      toast({ title: "Logo uploaded", description: "Saved without background — shown in the sidebar." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not upload logo";
      toast({ variant: "destructive", title: "Upload failed", description: msg });
    } finally {
      setUploadingLogo(false);
    }
  };

  if (isSuperAdmin) {
    if (selectedOrgId) {
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setSelectedOrgId(null)}>
              <ArrowLeft className="h-3.5 w-3.5" /> All companies
            </Button>
            <p className="text-sm text-muted-foreground">
              Full company details entered by the organization admin
            </p>
          </div>
          {detailLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading company details…</div>
          ) : (
            <CompanyDetailsReadonly fields={fields} />
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Company details</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            All organizations. Click a company to view the full profile saved by its admin.
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={orgSearch}
            onChange={(e) => setOrgSearch(e.target.value)}
            placeholder="Search by name, slug, or industry…"
          />
        </div>

        {orgsLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading companies…</div>
        ) : filteredOrgs.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No companies found.
          </div>
        ) : (
          <div className="rounded-lg border bg-white divide-y overflow-hidden">
            {filteredOrgs.map((org) => {
              const logo = org.logo_url ? resolveUploadSrc(org.logo_url) : "";
              const active = org.is_active === 1 || org.is_active === true || org.is_active === undefined;
              return (
                <button
                  key={org.id}
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                  onClick={() => void openOrgDetails(org.id)}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-transparent">
                    {logo ? (
                      <img src={logo} alt="" className="max-h-9 max-w-9 object-contain bg-transparent" />
                    ) : (
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{org.name || "Untitled"}</p>
                      <Badge variant={active ? "default" : "secondary"} className="text-[10px]">
                        {active ? "Active" : "Inactive"}
                      </Badge>
                      {org.plan ? (
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {org.plan}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {[org.slug, org.industry].filter(Boolean).join(" · ") || "No slug"}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">View details</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading company profile…</div>;
  }

  return (
    <div className="bg-gray-50">
      <SettingsSection title="Brand Identity" description="Logo and name appear at the top of the sidebar. Prefer a transparent PNG (no background).">
        <div className="border-b border-gray-100 px-5 py-6">
          <div className="flex flex-col items-center">
            <div className="flex h-40 w-40 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-transparent">
              {fields.logoPreview ? (
                <img
                  src={fields.logoPreview}
                  alt="Company logo"
                  className="max-h-full max-w-full object-contain bg-transparent"
                />
              ) : (
                <Globe className="h-10 w-10 text-gray-400" />
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-all duration-150 ease-in-out hover:bg-gray-100">
                <Upload className="h-4 w-4" />
                {uploadingLogo ? "Uploading…" : "Upload Logo"}
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={(e) => void handleLogoUpload(e)}
                  className="hidden"
                  disabled={uploadingLogo}
                />
              </label>
              {fields.logoPreview ? (
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                  onClick={() => setFields((prev) => ({ ...prev, logoUrl: "", logoPreview: "" }))}
                >
                  Remove
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-gray-400">PNG / JPG / SVG / WebP · max 2MB · no background fill applied</p>
          </div>
        </div>
        <SettingsRow label="Company Name">
          <SettingsInput value={fields.companyName} onChange={(v) => patchField("companyName", v)} />
        </SettingsRow>
        <SettingsRow label="Tagline / Description">
          <textarea
            value={fields.tagline}
            rows={3}
            onChange={(e) => patchField("tagline", e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1"
          />
        </SettingsRow>
        <SettingsRow label="Website URL">
          <SettingsInput value={fields.website} onChange={(v) => patchField("website", v)} type="url" />
        </SettingsRow>
        <SettingsRow label="Support Email">
          <SettingsInput value={fields.supportEmail} onChange={(v) => patchField("supportEmail", v)} type="email" />
        </SettingsRow>
        <SettingsRow label="Support Phone">
          <SettingsInput value={fields.supportPhone} onChange={(v) => patchField("supportPhone", v)} type="tel" />
        </SettingsRow>
        <SettingsRow label="Org ID prefix" border={false}>
          <div className="space-y-1">
            <SettingsInput
              value={fields.staffIdPrefix}
              onChange={(v) => patchField("staffIdPrefix", v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
              placeholder={fields.staffIdPrefixEffective || "SYN"}
            />
            {(() => {
              const p = fields.staffIdPrefix || fields.staffIdPrefixEffective || "SYN";
              const auto = !fields.staffIdPrefix || fields.staffIdPrefixAuto;
              return (
                <p className="text-[11px] text-muted-foreground">
                  {auto && fields.staffIdPrefixEffective
                    ? `Using ${fields.staffIdPrefixEffective} from the company name until you set one. `
                    : ""}
                  2–4 letters. Admin {p}0001, managers {p}0101, sales / HR / marketing {p}1001. Used as the form and payment referral.
                </p>
              );
            })()}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Address" description="Official business address.">
        <SettingsRow label="Street Address">
          <SettingsInput value={fields.street} onChange={(v) => patchField("street", v)} />
        </SettingsRow>
        <SettingsRow label="City">
          <SettingsInput value={fields.city} onChange={(v) => patchField("city", v)} />
        </SettingsRow>
        <SettingsRow label="State">
          <SettingsInput value={fields.stateName} onChange={(v) => patchField("stateName", v)} />
        </SettingsRow>
        <SettingsRow label="Country">
          <SettingsSelect
            value={fields.country}
            onChange={(v) => patchField("country", v)}
            options={[
              { value: "india", label: "India" },
              { value: "usa", label: "United States" },
              { value: "uk", label: "United Kingdom" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Postal Code" border={false}>
          <SettingsInput value={fields.postalCode} onChange={(v) => patchField("postalCode", v)} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Social Links" description="Official social media pages.">
        <SettingsRow label="LinkedIn">
          <div className="relative">
            <Linkedin className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={fields.linkedIn}
              onChange={(e) => patchField("linkedIn", e.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1"
            />
          </div>
        </SettingsRow>
        <SettingsRow label="Twitter/X">
          <div className="relative">
            <Twitter className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={fields.twitter}
              onChange={(e) => patchField("twitter", e.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1"
            />
          </div>
        </SettingsRow>
        <SettingsRow label="Instagram" border={false}>
          <div className="relative">
            <Instagram className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={fields.instagram}
              onChange={(e) => patchField("instagram", e.target.value)}
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

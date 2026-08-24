import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Megaphone, RefreshCw, Unplug } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";

type MetaAccount = {
  id: string;
  ad_account_id: string;
  account_name?: string | null;
  currency?: string | null;
  timezone_name?: string | null;
  is_enabled?: number | boolean;
  last_synced_at?: string | null;
  last_sync_error?: string | null;
};

type MetaConnection = {
  id: string;
  meta_user_name?: string | null;
  meta_user_id?: string | null;
  token_expires_at?: string | null;
  scopes?: string | null;
  status?: string;
  last_error?: string | null;
};

type MetaStatus = {
  configured?: boolean;
  redirect_uri?: string;
  oauth_scopes?: string;
  leads_retrieval_configured?: boolean;
  leads_retrieval_granted?: boolean;
  leads_ready?: boolean;
  connection?: MetaConnection | null;
  accounts?: MetaAccount[];
};

export function MetaAdsSetup() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<MetaStatus>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await api.metaAds.status()) as { data?: MetaStatus };
      setStatus(res?.data ?? {});
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not load Meta Ads",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flag = searchParams.get("meta_ads");
    if (!flag) return;
    if (flag === "connected") {
      toast({ title: "Meta Ads connected", description: "Enable the ad accounts you want to sync." });
      void load();
    } else if (flag === "error") {
      toast({
        variant: "destructive",
        title: "Meta Ads connection failed",
        description: searchParams.get("reason") || "Try again",
      });
    }
    const next = new URLSearchParams(searchParams);
    next.delete("meta_ads");
    next.delete("reason");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, toast, load]);

  const onConnect = async () => {
    setConnecting(true);
    try {
      const res = (await api.metaAds.oauthStart()) as { data?: { url?: string } };
      const url = res?.data?.url;
      if (!url) throw new Error("No OAuth URL returned");
      window.location.href = url;
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not start Meta login",
        description: e instanceof Error ? e.message : String(e),
      });
      setConnecting(false);
    }
  };

  const onDisconnect = async () => {
    if (!window.confirm("Disconnect Meta Ads for this organization?")) return;
    try {
      await api.metaAds.disconnect();
      toast({ title: "Meta Ads disconnected" });
      await load();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Disconnect failed",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const onSyncNow = async () => {
    setSyncing(true);
    try {
      const res = (await api.metaAds.syncNow()) as {
        data?: { upserted?: number; leads_imported?: number; errors?: string[] };
      };
      const errs = res?.data?.errors ?? [];
      const leadsN = res?.data?.leads_imported ?? 0;
      const leadBlock = errs.find((e) => /lead/i.test(e));
      toast({
        variant: leadBlock && leadsN === 0 ? "destructive" : "default",
        title: leadBlock && leadsN === 0 ? "Insights synced — leads blocked" : "Sync complete",
        description:
          leadBlock && leadsN === 0
            ? leadBlock
            : `Insights ${res?.data?.upserted ?? 0} · Leads imported ${leadsN}${
                errs.length ? ` · ${errs.length} warning(s)` : ""
              }`,
      });
      await load();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSyncing(false);
    }
  };

  const toggleAccount = async (adAccountId: string, enabled: boolean) => {
    setSaving(true);
    try {
      const next = (status.accounts ?? []).map((a) =>
        a.ad_account_id === adAccountId ? { ...a, is_enabled: enabled ? 1 : 0 } : a,
      );
      setStatus((s) => ({ ...s, accounts: next }));
      await api.metaAds.updateAccounts(
        next.map((a) => ({
          ad_account_id: a.ad_account_id,
          is_enabled: Boolean(a.is_enabled),
        })),
      );
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not update account",
        description: e instanceof Error ? e.message : String(e),
      });
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading Meta Ads…
      </div>
    );
  }

  const conn = status.connection;
  const connected = Boolean(conn);

  return (
    <div className="space-y-4">
      <SettingsSection
        title="Meta Ads connection"
        description="Campaign insights use ads_read. Your Business Integration screenshot shows ads + WhatsApp only — Lead Ads need Meta Advanced Access for leads_retrieval, then META_ADS_OAUTH_SCOPES and a reconnect. If you use Login for Business, also enable Leads Access on that config."
      >
        {connected && !status.leads_ready ? (
          <div className="mx-5 mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
            <p className="font-medium">Lead Ads are not importing yet</p>
            <p className="mt-1 text-amber-900/90">
              Your Facebook Business Integration only has ads/stats (and WhatsApp). There is no{" "}
              <span className="font-medium">Retrieve leads</span> / <code className="text-xs">leads_retrieval</code>{" "}
              permission. Insights can sync; CRM lead import cannot until Meta grants Advanced Access for that
              permission.
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-amber-900/90">
              <li>
                Meta Developer → App Review → request Advanced Access for{" "}
                <code className="text-xs">leads_retrieval</code> (and usually Pages access Meta requires with it).
              </li>
              <li>
                After approval, in <code className="text-xs">api/config.php</code> set{" "}
                <code className="text-xs">META_ADS_OAUTH_SCOPES</code> to{" "}
                <code className="text-xs">ads_read,leads_retrieval</code>.
              </li>
              <li>Click Reconnect here and accept the new lead permission, then Sync now.</li>
            </ol>
            <p className="mt-2 text-xs text-amber-800">
              Server OAuth scopes: {status.oauth_scopes || "ads_read"}
              {conn?.scopes ? ` · Token scopes: ${conn.scopes}` : " · Token scopes: (none stored / ads only)"}
            </p>
          </div>
        ) : null}
        <SettingsRow label="Server app">
          <span className="text-sm">
            {status.configured ? (
              <span className="text-emerald-700 font-medium">Configured</span>
            ) : (
              <span className="text-amber-700">
                Set META_ADS_APP_ID / META_ADS_APP_SECRET in api/config.php
              </span>
            )}
          </span>
        </SettingsRow>
        {status.redirect_uri ? (
          <SettingsRow label="OAuth redirect">
            <code className="text-[11px] break-all text-muted-foreground">{status.redirect_uri}</code>
          </SettingsRow>
        ) : null}
        <SettingsRow label="Status" border={false}>
          <div className="flex flex-wrap items-center gap-2">
            {connected ? (
              <>
                <span className="text-sm font-medium text-foreground">
                  Connected{conn?.meta_user_name ? ` as ${conn.meta_user_name}` : ""}
                </span>
                {conn?.token_expires_at ? (
                  <span className="text-xs text-muted-foreground">
                    Token ≈ {new Date(conn.token_expires_at).toLocaleDateString()}
                  </span>
                ) : null}
                {conn?.status && conn.status !== "active" ? (
                  <span className="text-xs text-amber-700">{conn.status}</span>
                ) : null}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Not connected</span>
            )}
          </div>
        </SettingsRow>
        <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
          {!connected ? (
            <Button
              type="button"
              className="gap-1.5 bg-[#2ed573] hover:bg-[#25c066] text-[#0f2318]"
              disabled={!status.configured || connecting}
              onClick={() => void onConnect()}
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
              Connect Meta Ads
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" className="gap-1.5" disabled={syncing} onClick={() => void onSyncNow()}>
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Sync now
              </Button>
              <Button type="button" variant="outline" className="gap-1.5" onClick={() => void onConnect()}>
                <ExternalLink className="h-4 w-4" />
                Reconnect
              </Button>
              <Button type="button" variant="ghost" className="gap-1.5 text-red-700" onClick={() => void onDisconnect()}>
                <Unplug className="h-4 w-4" />
                Disconnect
              </Button>
            </>
          )}
        </div>
      </SettingsSection>

      {connected ? (
        <SettingsSection
          title="Ad accounts"
          description="Enable the accounts to include in the hourly campaign sync. Multiple accounts per organization are supported."
        >
          {(status.accounts ?? []).length === 0 ? (
            <div className="px-5 py-6 text-sm text-muted-foreground">
              No ad accounts returned. Reconnect or check ads_read permissions in Meta.
            </div>
          ) : (
            (status.accounts ?? []).map((a, idx) => {
              const enabled = Boolean(a.is_enabled);
              const last = (status.accounts ?? []).length - 1 === idx;
              return (
                <SettingsRow
                  key={a.ad_account_id}
                  label={a.account_name || a.ad_account_id}
                  border={!last}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-end w-full">
                    <div className="text-xs text-muted-foreground min-w-0">
                      <p className="font-mono truncate">{a.ad_account_id}</p>
                      {a.last_synced_at ? (
                        <p>Last sync {new Date(a.last_synced_at).toLocaleString()}</p>
                      ) : (
                        <p>Never synced</p>
                      )}
                      {a.last_sync_error ? (
                        <p className="text-red-600 truncate" title={a.last_sync_error}>
                          {a.last_sync_error}
                        </p>
                      ) : null}
                    </div>
                    <Switch
                      checked={enabled}
                      disabled={saving}
                      onCheckedChange={(v) => void toggleAccount(a.ad_account_id, v)}
                    />
                  </div>
                </SettingsRow>
              );
            })
          )}
        </SettingsSection>
      ) : null}
    </div>
  );
}

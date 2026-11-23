import { useEffect, useMemo, useState } from "react";
import { api, type AuditLogEntry } from "@/lib/api";
import { formatServerDateTime } from "@/lib/dateTime";
import { localDateKey } from "@/lib/localDate";

const actionLabelMap: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  restored: "Restored",
  status_updated: "Status changed",
  assigned: "Assigned",
  imported: "Imported",
  sent: "Sent",
  issued: "Issued",
  revoked: "Revoked",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  connected: "Connected",
  disconnected: "Disconnected",
  exported: "Exported",
  logged_in: "Logged in",
  updated_profile: "Profile updated",
};

const actionColorMap: Record<string, string> = {
  created: "bg-green-100 text-green-700",
  updated: "bg-blue-100 text-blue-700",
  deleted: "bg-red-100 text-red-700",
  restored: "bg-purple-100 text-purple-700",
  status_updated: "bg-sky-100 text-sky-700",
  assigned: "bg-indigo-100 text-indigo-700",
  imported: "bg-teal-100 text-teal-700",
  sent: "bg-cyan-100 text-cyan-700",
  issued: "bg-emerald-100 text-emerald-700",
  revoked: "bg-rose-100 text-rose-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-orange-100 text-orange-700",
  cancelled: "bg-orange-100 text-orange-700",
  connected: "bg-lime-100 text-lime-700",
  disconnected: "bg-zinc-200 text-zinc-700",
  exported: "bg-amber-100 text-amber-700",
  logged_in: "bg-gray-100 text-gray-700",
  updated_profile: "bg-gray-100 text-gray-700",
};

/** Friendly names for audit_log.entity_type ("payment_link" → "Payment link"). */
const entityLabelMap: Record<string, string> = {
  lead: "Lead",
  team_member: "Team member",
  certificate: "Certificate",
  certificate_template: "Certificate template",
  offer_letter: "Offer letter",
  offer_letter_template: "Offer letter template",
  form: "Form",
  form_api_key: "Form API key",
  form_campaign: "Form campaign",
  form_link: "Paid form link",
  payment: "Payment record",
  payment_link: "Payment link",
  coupon: "Coupon",
  coupon_api_key: "Coupon API key",
  coupon_settings: "Coupon settings",
  student: "Student",
  course: "Course",
  batch: "Batch",
  timetable: "Timetable",
  holiday: "Holiday",
  task: "Task",
  email_campaign: "Email campaign",
  whatsapp_campaign: "WhatsApp campaign",
  whatsapp_template: "WhatsApp template",
  whatsapp_settings: "WhatsApp setup",
  email_settings: "Email (SMTP) setup",
  razorpay_settings: "Razorpay setup",
  meta_ads: "Meta Ads",
  organization: "Organization",
  organization_features: "Organization features",
  organization_profile: "Company profile",
  organization_logo: "Company logo",
  organization_payment_qr: "Payment QR",
  trash: "Trash",
  auth: "Sign-in",
  user: "User profile",
};

const entityLabel = (type: string) =>
  entityLabelMap[type] ?? (type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ") : "—");

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [users, setUsers] = useState<{ user_id: string; user_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.auditLogs.list({
        user_id: userFilter !== "all" ? userFilter : undefined,
        action_type: actionFilter !== "all" ? actionFilter : undefined,
        date: dateFilter || undefined,
        search: search || undefined,
        limit: 200,
      });
      setLogs(res.data || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load audit logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.auditLogs
      .users()
      .then((res) => setUsers(res.data || []))
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFilter, actionFilter, dateFilter]);

  const filtered = useMemo(() => {
    if (!search) return logs;
    const q = search.toLowerCase();
    return logs.filter((log) =>
      `${log.user_name ?? ""} ${log.action} ${log.entity_type} ${log.details ?? ""} ${log.ip_address ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [logs, search]);

  const exportCsv = () => {
    const header = ["Timestamp", "User", "Action", "Entity", "Details", "IP"];
    const rows = filtered.map((log) => [
      log.created_at,
      log.user_name ?? "",
      actionLabelMap[log.action] ?? log.action,
      entityLabel(log.entity_type),
      log.details ?? "",
      log.ip_address ?? "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${localDateKey()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Audit Logs</h3>
          <p className="text-sm text-gray-500">Who did what and when — leads, payments, certificates, campaigns, settings and sign-ins</p>
        </div>
        <button type="button" onClick={exportCsv} className="rounded-lg border border-gray-200 px-4 py-2 text-sm">
          Export CSV
        </button>
      </div>

      <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-4">
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <option value="all">All users</option>
          {users.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.user_name || u.user_id}
            </option>
          ))}
        </select>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <option value="all">All actions</option>
          {Object.entries(actionLabelMap).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-red-600">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                  No activity recorded yet.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              filtered.map((log) => (
                <tr key={log.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 whitespace-nowrap">{formatServerDateTime(log.created_at)}</td>
                  <td className="px-4 py-3">{log.user_name || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs ${actionColorMap[log.action] ?? "bg-gray-100 text-gray-700"}`}>
                      {actionLabelMap[log.action] ?? log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{entityLabel(log.entity_type)}</td>
                  <td className="px-4 py-3">{log.details || "—"}</td>
                  <td className="px-4 py-3">{log.ip_address || "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="px-4 py-3 text-sm text-gray-500">Showing {filtered.length} entries</div>
      </div>
    </div>
  );
}

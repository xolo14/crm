import { useEffect, useMemo, useState } from "react";
import { api, type AuditLogEntry } from "@/lib/api";
import { formatServerDateTime } from "@/lib/dateTime";

const actionLabelMap: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  restored: "Restored",
  logged_in: "Logged in",
  exported: "Exported",
};

const actionColorMap: Record<string, string> = {
  created: "bg-green-100 text-green-700",
  updated: "bg-blue-100 text-blue-700",
  deleted: "bg-red-100 text-red-700",
  restored: "bg-purple-100 text-purple-700",
  logged_in: "bg-gray-100 text-gray-700",
  exported: "bg-amber-100 text-amber-700",
};

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
      log.entity_type,
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
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Audit Logs</h3>
          <p className="text-sm text-gray-500">Track real user activity in your CRM</p>
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
          <option value="created">Created</option>
          <option value="updated">Updated</option>
          <option value="deleted">Deleted</option>
          <option value="restored">Restored</option>
          <option value="logged_in">Logged in</option>
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
                  <td className="px-4 py-3">{log.entity_type}</td>
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

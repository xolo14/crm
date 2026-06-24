import { useMemo, useState } from "react";

interface LogEntry {
  id: string;
  timestamp: string;
  user: string;
  action: "Created" | "Updated" | "Deleted" | "Logged in" | "Exported";
  entity: string;
  details: string;
  ip: string;
}

const mockLogs: LogEntry[] = [
  { id: "1", timestamp: "2026-05-09 10:15", user: "ragh", action: "Created", entity: "Lead", details: "Created Lead: Priya Sharma", ip: "192.168.1.1" },
  { id: "2", timestamp: "2026-05-09 10:45", user: "ragh", action: "Updated", entity: "Pipeline Stage", details: "Updated Pipeline Stage: Qualified", ip: "192.168.1.1" },
  { id: "3", timestamp: "2026-05-09 11:00", user: "ragh", action: "Logged in", entity: "Auth", details: "User logged in", ip: "192.168.1.1" },
  { id: "4", timestamp: "2026-05-09 11:10", user: "admin", action: "Deleted", entity: "Contact", details: "Deleted Contact: Raj Verma", ip: "10.0.0.4" },
  { id: "5", timestamp: "2026-05-09 11:20", user: "admin", action: "Exported", entity: "Report", details: "Exported monthly report", ip: "10.0.0.4" },
  { id: "6", timestamp: "2026-05-09 11:30", user: "ragh", action: "Updated", entity: "Deal", details: "Updated Deal: ACME Corp", ip: "192.168.1.1" },
  { id: "7", timestamp: "2026-05-09 11:40", user: "sales1", action: "Created", entity: "Task", details: "Created follow-up task", ip: "172.16.1.22" },
  { id: "8", timestamp: "2026-05-09 11:45", user: "sales1", action: "Updated", entity: "Lead", details: "Changed lead status to Warm", ip: "172.16.1.22" },
  { id: "9", timestamp: "2026-05-09 11:47", user: "admin", action: "Deleted", entity: "Tag", details: "Removed tag: Obsolete", ip: "10.0.0.4" },
  { id: "10", timestamp: "2026-05-09 11:55", user: "ragh", action: "Exported", entity: "Contacts", details: "Exported contacts CSV", ip: "192.168.1.1" },
];

const actionColorMap: Record<LogEntry["action"], string> = {
  Created: "bg-green-100 text-green-700",
  Updated: "bg-blue-100 text-blue-700",
  Deleted: "bg-red-100 text-red-700",
  "Logged in": "bg-gray-100 text-gray-700",
  Exported: "bg-amber-100 text-amber-700",
};

export function AuditLogs() {
  const [userFilter, setUserFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () =>
      mockLogs.filter((log) => {
        const userOk = userFilter === "all" || log.user === userFilter;
        const actionOk = actionFilter === "all" || log.action === actionFilter;
        const searchOk =
          !search ||
          `${log.user} ${log.action} ${log.entity} ${log.details} ${log.ip}`.toLowerCase().includes(search.toLowerCase());
        return userOk && actionOk && searchOk;
      }),
    [userFilter, actionFilter, search],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Audit Logs</h3>
          <p className="text-sm text-gray-500">Track all user activity in your CRM</p>
        </div>
        <button type="button" className="rounded-lg border border-gray-200 px-4 py-2 text-sm">Export CSV</button>
      </div>

      <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-4">
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <option value="all">All users</option>
          <option value="ragh">ragh</option>
          <option value="admin">admin</option>
          <option value="sales1">sales1</option>
        </select>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <option value="all">All actions</option>
          <option value="Created">Created</option>
          <option value="Updated">Updated</option>
          <option value="Deleted">Deleted</option>
          <option value="Logged in">Logged in</option>
          <option value="Exported">Exported</option>
        </select>
        <input type="date" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
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
            {filtered.map((log) => (
              <tr key={log.id} className="border-b border-gray-100">
                <td className="px-4 py-3">{log.timestamp}</td>
                <td className="px-4 py-3">{log.user}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs ${actionColorMap[log.action]}`}>{log.action}</span>
                </td>
                <td className="px-4 py-3">{log.entity}</td>
                <td className="px-4 py-3">{log.details}</td>
                <td className="px-4 py-3">{log.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 text-sm text-gray-500">Showing 1–{filtered.length} of 147 entries</div>
      </div>
    </div>
  );
}

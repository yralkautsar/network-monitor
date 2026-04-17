// app/dashboard/network/page.tsx
// Network monitoring dashboard — consumes SSE stream from /api/network-stream
// Sections: system overview, interfaces, connected clients, traffic per IP

"use client";

import { useNetworkStream } from "@/hooks/useNetworkStream";
import type { MikroTikInterface, MikroTikDhcpLease, MikroTikAccountingEntry } from "@/lib/mikrotik";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useRef, useState } from "react";

// --- Helpers ---

// Converts bytes string to human-readable format
function formatBytes(bytes: string | number): string {
  const n = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (isNaN(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} GB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)} KB`;
  return `${n} B`;
}

// Converts bps string to Mbps or Kbps
function formatRate(bps: string | number): string {
  const n = typeof bps === "string" ? parseInt(bps, 10) : bps;
  if (isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mbps`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)} Kbps`;
  return `${n} bps`;
}

// Formats RouterOS uptime string (e.g. "3d2h15m10s") into readable form
function formatUptime(uptime: string): string {
  if (!uptime) return "—";
  return uptime.replace("d", "d ").replace("h", "h ").replace("m", "m ").trim();
}

// Returns Tailwind color class based on CPU load percentage
function cpuColor(load: string): string {
  const n = parseInt(load, 10);
  if (n >= 80) return "text-red-500";
  if (n >= 50) return "text-yellow-500";
  return "text-green-500";
}

// Max history entries kept for bandwidth sparkline chart
const MAX_HISTORY = 30;

// --- Types ---

interface BandwidthPoint {
  time: string;
  tx: number;
  rx: number;
}

// --- Sub-components ---

// Status indicator badge for SSE connection state
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    connected: "bg-green-100 text-green-700",
    connecting: "bg-yellow-100 text-yellow-700",
    reconnecting: "bg-orange-100 text-orange-700",
    error: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] ?? styles.error}`}>
      {status}
    </span>
  );
}

// Single stat card — label + value
function StatCard({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}

// Interface row — shows name, status, tx/rx rate and cumulative bytes
function InterfaceRow({ iface }: { iface: MikroTikInterface }) {
  const isUp = iface.running === "true" && iface.disabled === "false";

  return (
    <div className="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        {/* Status dot */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isUp ? "bg-green-500" : "bg-red-400"}`} />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{iface.name}</p>
          <p className="text-xs text-zinc-500">{iface.type}</p>
        </div>
      </div>
      <div className="flex gap-6 text-right text-sm flex-shrink-0">
        <div>
          <p className="text-xs text-zinc-500">TX</p>
          <p className="font-mono">{formatRate(iface["tx-rate"])}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">RX</p>
          <p className="font-mono">{formatRate(iface["rx-rate"])}</p>
        </div>
        <div className="hidden md:block">
          <p className="text-xs text-zinc-500">Total TX</p>
          <p className="font-mono text-xs">{formatBytes(iface["tx-byte"])}</p>
        </div>
        <div className="hidden md:block">
          <p className="text-xs text-zinc-500">Total RX</p>
          <p className="font-mono text-xs">{formatBytes(iface["rx-byte"])}</p>
        </div>
      </div>
    </div>
  );
}

// DHCP lease row — connected client
function LeaseRow({ lease }: { lease: MikroTikDhcpLease }) {
  const isBound = lease.status === "bound";

  return (
    <div className="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{lease["host-name"] ?? "Unknown"}</p>
        <p className="text-xs text-zinc-500 font-mono">{lease["mac-address"]}</p>
      </div>
      <div className="flex items-center gap-4 flex-shrink-0">
        <p className="font-mono text-sm">{lease.address}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full ${isBound ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>
          {lease.status}
        </span>
      </div>
    </div>
  );
}

// Accounting row — traffic per IP pair
function AccountingRow({ entry }: { entry: MikroTikAccountingEntry }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className="flex items-center gap-2 min-w-0 text-sm font-mono">
        <span className="truncate">{entry.src}</span>
        <span className="text-zinc-400">→</span>
        <span className="truncate">{entry.dst}</span>
      </div>
      <div className="flex gap-4 text-right flex-shrink-0">
        <div>
          <p className="text-xs text-zinc-500">Bytes</p>
          <p className="text-sm font-mono">{formatBytes(entry.bytes)}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Packets</p>
          <p className="text-sm font-mono">{parseInt(entry.packets, 10).toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}

// --- Main Page ---

export default function NetworkDashboard() {
  const { data, status, error, lastUpdated } = useNetworkStream();

  // Bandwidth history for sparkline — accumulates tx/rx rate snapshots
  // Keyed by interface name so each interface gets its own chart history
  const historyRef = useRef<Record<string, BandwidthPoint[]>>({});

  // Selected interface for bandwidth sparkline
  const [selectedIface, setSelectedIface] = useState<string | null>(null);

  // Search filter for connected clients table
  const [clientSearch, setClientSearch] = useState("");

  // Search filter for traffic table
  const [trafficSearch, setTrafficSearch] = useState("");

  // Update bandwidth history when new data arrives
  if (data?.interfaces) {
    const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    data.interfaces.forEach((iface) => {
      if (!historyRef.current[iface.name]) {
        historyRef.current[iface.name] = [];
      }

      const history = historyRef.current[iface.name];
      history.push({
        time: now,
        tx: parseInt(iface["tx-rate"], 10) / 1_000_000, // convert to Mbps
        rx: parseInt(iface["rx-rate"], 10) / 1_000_000,
      });

      // Keep only last MAX_HISTORY points
      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
      }
    });

    // Auto-select first running interface if none selected
    if (!selectedIface && data.interfaces.length > 0) {
      const firstRunning = data.interfaces.find((i) => i.running === "true" && i.disabled === "false");
      if (firstRunning) setSelectedIface(firstRunning.name);
    }
  }

  // Filtered clients based on search input
  const filteredLeases: MikroTikDhcpLease[] = (data?.leases ?? []).filter((l) => {
    const q = clientSearch.toLowerCase();
    return (
      l.address.includes(q) ||
      (l["host-name"] ?? "").toLowerCase().includes(q) ||
      l["mac-address"].toLowerCase().includes(q)
    );
  });

  // Filtered accounting entries — only show top 50 by bytes, then filter
  const filteredAccounting: MikroTikAccountingEntry[] = (data?.accounting ?? [])
    .sort((a, b) => parseInt(b.bytes, 10) - parseInt(a.bytes, 10))
    .slice(0, 50)
    .filter((e) => {
      const q = trafficSearch.toLowerCase();
      return e.src.includes(q) || e.dst.includes(q);
    });

  const sparklineData = selectedIface ? (historyRef.current[selectedIface] ?? []) : [];
  const boundClients = (data?.leases ?? []).filter((l) => l.status === "bound").length;

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Network Monitor</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {lastUpdated ? `Last updated: ${new Date(lastUpdated).toLocaleTimeString()}` : "Waiting for data..."}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Error banner — only shows on SSE-level errors */}
      {error && status !== "connected" && (
        <div className="bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 px-6 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">

        {/* --- Section 1: System Overview --- */}
        <section>
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide mb-3">System</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Board"
              value={data?.system["board-name"] ?? "—"}
            />
            <StatCard
              label="Uptime"
              value={formatUptime(data?.system.uptime ?? "")}
            />
            <StatCard
              label="CPU Load"
              value={data ? `${data.system["cpu-load"]}%` : "—"}
              valueClass={cpuColor(data?.system["cpu-load"] ?? "0")}
            />
            <StatCard
              label="Free Memory"
              value={
                data
                  ? `${formatBytes(data.system["free-memory"])} / ${formatBytes(data.system["total-memory"])}`
                  : "—"
              }
            />
          </div>
        </section>

        {/* --- Section 2: Interfaces + Sparkline --- */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Interface list */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide">Interfaces</h2>
              <span className="text-xs text-zinc-400">{data?.interfaces.length ?? 0} total</span>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {(data?.interfaces ?? []).map((iface) => (
                <div
                  key={iface[".id"]}
                  className={`cursor-pointer rounded-lg transition-colors ${selectedIface === iface.name ? "bg-zinc-50 dark:bg-zinc-800" : ""}`}
                  onClick={() => setSelectedIface(iface.name)}
                >
                  <InterfaceRow iface={iface} />
                </div>
              ))}
              {!data && <p className="text-sm text-zinc-400 py-4 text-center">Connecting...</p>}
            </div>
          </div>

          {/* Bandwidth sparkline for selected interface */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide">
                Bandwidth — <span className="text-zinc-900 dark:text-zinc-100">{selectedIface ?? "select interface"}</span>
              </h2>
              <span className="text-xs text-zinc-400">last {MAX_HISTORY} polls</span>
            </div>
            {sparklineData.length > 1 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={sparklineData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(1)}M`} width={55} />
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value.toFixed(3)} Mbps`, name.toUpperCase()]}
                    labelStyle={{ fontSize: 11 }}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="tx" stroke="#3b82f6" fill="url(#txGrad)" strokeWidth={1.5} dot={false} name="tx" />
                  <Area type="monotone" dataKey="rx" stroke="#22c55e" fill="url(#rxGrad)" strokeWidth={1.5} dot={false} name="rx" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-sm text-zinc-400">
                {selectedIface ? "Collecting data..." : "Click an interface to view bandwidth"}
              </div>
            )}
            {/* Legend */}
            <div className="flex gap-4 mt-2 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-blue-500 inline-block" /> TX
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-green-500 inline-block" /> RX
              </span>
            </div>
          </div>
        </section>

        {/* --- Section 3: Connected Clients --- */}
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide">Connected Clients</h2>
              <p className="text-xs text-zinc-400 mt-0.5">{boundClients} bound leases</p>
            </div>
            <input
              type="text"
              placeholder="Filter by IP, hostname, or MAC..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400 w-full sm:w-64"
            />
          </div>
          <div>
            {filteredLeases.length > 0
              ? filteredLeases.map((lease) => <LeaseRow key={lease[".id"]} lease={lease} />)
              : <p className="text-sm text-zinc-400 py-4 text-center">{data ? "No clients found" : "Connecting..."}</p>
            }
          </div>
        </section>

        {/* --- Section 4: Traffic per IP --- */}
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide">Traffic per IP</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Top 50 by bytes — accounting snapshot</p>
            </div>
            <input
              type="text"
              placeholder="Filter by source or destination IP..."
              value={trafficSearch}
              onChange={(e) => setTrafficSearch(e.target.value)}
              className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400 w-full sm:w-64"
            />
          </div>
          <div>
            {filteredAccounting.length > 0
              ? filteredAccounting.map((entry, idx) => <AccountingRow key={idx} entry={entry} />)
              : <p className="text-sm text-zinc-400 py-4 text-center">
                  {data ? "No traffic data — is /ip accounting enabled?" : "Connecting..."}
                </p>
            }
          </div>
        </section>

      </div>
    </main>
  );
}
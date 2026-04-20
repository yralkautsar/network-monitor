// app/dashboard/network/page.tsx
// Network Monitor — Option C: minimal light, data-first, no nav chrome
// Layout: metric cards left | active interfaces right | bandwidth full width | clients table

"use client";

import { useNetworkStream } from "@/hooks/useNetworkStream";
import type { MikroTikInterface, MikroTikDhcpLease } from "@/lib/mikrotik";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useRef, useState, useEffect } from "react";

// --- Helpers ---

function formatBytes(bytes: string | number): string {
  const n = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (isNaN(n)) return "—";
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(2)} TB`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} GB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)} KB`;
  return `${n} B`;
}

function formatRate(bps: string | number): string {
  const n = typeof bps === "string" ? parseInt(bps, 10) : bps;
  if (isNaN(n) || n === 0) return "0 bps";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mbps`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)} Kbps`;
  return `${n} bps`;
}

function formatUptime(uptime: string): string {
  if (!uptime) return "—";
  return uptime.replace("d", "d ").replace("h", "h ").replace("m", "m ").trim();
}

function formatMemory(free: string, total: string): string {
  const f = parseInt(free, 10);
  const t = parseInt(total, 10);
  if (isNaN(f) || isNaN(t)) return "—";
  const usedPct = Math.round(((t - f) / t) * 100);
  return `${formatBytes(t - f)} used · ${usedPct}%`;
}

const MAX_HISTORY = 40;

interface BandwidthPoint {
  time: string;
  tx: number;
  rx: number;
}

// --- Sub-components ---

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    connected: "bg-emerald-400",
    connecting: "bg-amber-400",
    reconnecting: "bg-orange-400",
    error: "bg-red-400",
  };
  return (
    <span className="flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={`w-1.5 h-1.5 rounded-full ${colors[status] ?? "bg-red-400"}`} />
      {status}
    </span>
  );
}

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-4 dark:bg-zinc-900 dark:border-zinc-800">
      <p className="text-[11px] uppercase tracking-widest text-zinc-400 mb-1">{label}</p>
      <p className={`text-2xl font-medium ${accent ?? "text-zinc-900 dark:text-zinc-100"}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function InterfaceBar({
  iface,
  maxBytes,
  isSelected,
  onClick,
}: {
  iface: MikroTikInterface;
  maxBytes: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const txBytes = parseInt(iface["tx-byte"], 10) || 0;
  const rxBytes = parseInt(iface["rx-byte"], 10) || 0;
  const txPct = maxBytes > 0 ? (txBytes / maxBytes) * 100 : 0;
  const rxPct = maxBytes > 0 ? (rxBytes / maxBytes) * 100 : 0;
  const txRate = parseInt(iface["tx-rate"], 10) || 0;
  const rxRate = parseInt(iface["rx-rate"], 10) || 0;
  const isLive = txRate > 0 || rxRate > 0;

  return (
    <div
      onClick={onClick}
      className={`group cursor-pointer rounded-lg px-3 py-2.5 transition-colors ${
        isSelected
          ? "bg-zinc-50 dark:bg-zinc-800"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              iface.running === "true" ? "bg-emerald-400" : "bg-red-300"
            }`}
          />
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
            {iface.name}
          </span>
          {isLive && (
            <span className="text-[10px] text-emerald-500 font-medium flex-shrink-0">live</span>
          )}
        </div>
        <div className="flex gap-4 text-right flex-shrink-0 ml-4">
          <span className="text-xs font-mono text-zinc-500">{formatBytes(txBytes)}</span>
        </div>
      </div>

      {/* TX bar */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-400 w-4">TX</span>
          <div className="flex-1 h-1 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(txPct, 0.5)}%` }}
            />
          </div>
          {isLive && (
            <span className="text-[10px] font-mono text-zinc-400 w-20 text-right">
              {formatRate(txRate)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-400 w-4">RX</span>
          <div className="flex-1 h-1 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(rxPct, 0.5)}%` }}
            />
          </div>
          {isLive && (
            <span className="text-[10px] font-mono text-zinc-400 w-20 text-right">
              {formatRate(rxRate)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ClientRow({ lease }: { lease: MikroTikDhcpLease }) {
  const isBound = lease.status === "bound";
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-zinc-50 dark:border-zinc-800 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-800 dark:text-zinc-200 truncate">
          {lease["host-name"] ?? "Unknown"}
        </p>
        <p className="text-[11px] text-zinc-400 font-mono">{lease["mac-address"]}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-4">
        <span className="font-mono text-sm text-zinc-600 dark:text-zinc-400">{lease.address}</span>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            isBound
              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
              : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
          }`}
        >
          {lease.status}
        </span>
      </div>
    </div>
  );
}

// Groups leases by subnet prefix (e.g. "192.168.1")
function groupBySubnet(leases: MikroTikDhcpLease[]): Record<string, MikroTikDhcpLease[]> {
  return leases.reduce((acc, lease) => {
    const parts = lease.address.split(".");
    const subnet = parts.slice(0, 3).join(".");
    if (!acc[subnet]) acc[subnet] = [];
    acc[subnet].push(lease);
    return acc;
  }, {} as Record<string, MikroTikDhcpLease[]>);
}

// --- Main Page ---

export default function NetworkDashboard() {
  const { data, status, lastUpdated } = useNetworkStream();

  const historyRef = useRef<Record<string, BandwidthPoint[]>>({});
  const [selectedIface, setSelectedIface] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!data?.interfaces) return;

    const now = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    data.interfaces.forEach((iface) => {
      if (!historyRef.current[iface.name]) {
        historyRef.current[iface.name] = [];
      }
      const txRate = parseInt(iface["tx-rate"], 10);
      const rxRate = parseInt(iface["rx-rate"], 10);
      const newPoint = {
        time: now,
        tx: isNaN(txRate) ? 0 : txRate / 1_000_000,
        rx: isNaN(rxRate) ? 0 : rxRate / 1_000_000,
      };
      historyRef.current[iface.name] = [
        ...historyRef.current[iface.name],
        newPoint,
      ].slice(-MAX_HISTORY);
    });

    if (!selectedIface && data.interfaces.length > 0) {
      const firstRunning = data.interfaces.find(
        (i) => i.running === "true" && i.disabled === "false"
      );
      if (firstRunning) setSelectedIface(firstRunning.name);
    }

    forceUpdate((n) => n + 1);
  }, [data]);

  // Sort interfaces by total TX bytes descending, split active/inactive
  const allInterfaces = data?.interfaces ?? [];
  const activeInterfaces = allInterfaces
    .filter((i) => i.running === "true" && i.disabled === "false")
    .sort((a, b) => parseInt(b["tx-byte"], 10) - parseInt(a["tx-byte"], 10));
  const inactiveInterfaces = allInterfaces.filter(
    (i) => i.running !== "true" || i.disabled === "true"
  );
  const displayedInterfaces = showInactive
    ? [...activeInterfaces, ...inactiveInterfaces]
    : activeInterfaces;

  // Max TX bytes across active interfaces — used to scale bars
  const maxTxBytes = activeInterfaces.reduce(
    (max, i) => Math.max(max, parseInt(i["tx-byte"], 10) || 0),
    1
  );

  const sparklineData = selectedIface
    ? historyRef.current[selectedIface] ?? []
    : [];

  // Clients
  const boundCount = (data?.leases ?? []).filter((l) => l.status === "bound").length;
  const filteredLeases = (data?.leases ?? []).filter((l) => {
    const q = clientSearch.toLowerCase();
    return (
      l.address.includes(q) ||
      (l["host-name"] ?? "").toLowerCase().includes(q) ||
      l["mac-address"].toLowerCase().includes(q)
    );
  });
  const grouped = groupBySubnet(filteredLeases);
  const subnets = Object.keys(grouped).sort();

  const cpuLoad = data?.system["cpu-load"] ?? "0";
  const cpuNum = parseInt(cpuLoad, 10);
  const cpuAccent =
    cpuNum >= 80
      ? "text-red-500"
      : cpuNum >= 50
      ? "text-amber-500"
      : "text-emerald-500";

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">

      {/* Minimal header */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Network Monitor</span>
          <span className="text-xs text-zinc-300 dark:text-zinc-600">·</span>
          <span className="text-xs text-zinc-400">
            {data?.system["board-name"] ?? "—"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {lastUpdated && (
            <span className="text-xs text-zinc-400 hidden sm:block">
              {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
          <StatusDot status={status} />
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">

        {/* --- Row 1: Metric cards --- */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Uptime"
            value={formatUptime(data?.system.uptime ?? "")}
          />
          <MetricCard
            label="CPU Load"
            value={data ? `${cpuLoad}%` : "—"}
            accent={cpuAccent}
          />
          <MetricCard
            label="Memory"
            value={data ? formatBytes(parseInt(data.system["total-memory"], 10) - parseInt(data.system["free-memory"], 10)) : "—"}
            sub={data ? formatMemory(data.system["free-memory"], data.system["total-memory"]) : undefined}
          />
          <MetricCard
            label="Clients"
            value={data ? `${boundCount}` : "—"}
            sub="bound leases"
          />
        </div>

        {/* --- Row 2: Interfaces + Sparkline --- */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

          {/* Interfaces ranked by traffic */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-50 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium">Interfaces</h2>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  {activeInterfaces.length} active · ranked by total TX
                </p>
              </div>
              <button
                onClick={() => setShowInactive((v) => !v)}
                className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                {showInactive
                  ? `hide inactive (${inactiveInterfaces.length})`
                  : `show inactive (${inactiveInterfaces.length})`}
              </button>
            </div>
            <div className="px-2 py-2 max-h-96 overflow-y-auto">
              {displayedInterfaces.length > 0 ? (
                displayedInterfaces.map((iface) => (
                  <InterfaceBar
                    key={iface[".id"]}
                    iface={iface}
                    maxBytes={maxTxBytes}
                    isSelected={selectedIface === iface.name}
                    onClick={() => setSelectedIface(iface.name)}
                  />
                ))
              ) : (
                <p className="text-sm text-zinc-400 py-6 text-center">Connecting...</p>
              )}
            </div>
          </div>

          {/* Bandwidth chart */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-50 dark:border-zinc-800">
              <h2 className="text-sm font-medium">
                Bandwidth
                {selectedIface && (
                  <span className="font-normal text-zinc-400 ml-2">— {selectedIface}</span>
                )}
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">last {MAX_HISTORY} polls · 5s interval</p>
            </div>
            <div className="p-4">
              {sparklineData.length > 1 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={sparklineData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="txG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="rxG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10, fill: "#a1a1aa" }}
                      interval="preserveStartEnd"
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#a1a1aa" }}
                      tickFormatter={(v) => `${v.toFixed(1)}M`}
                      width={52}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value) => [`${Number(value).toFixed(3)} Mbps`]}
                      contentStyle={{
                        fontSize: 12,
                        border: "0.5px solid #e4e4e7",
                        borderRadius: 8,
                        background: "white",
                        color: "#18181b",
                      }}
                      labelStyle={{ fontSize: 11, color: "#a1a1aa" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="tx"
                      stroke="#60a5fa"
                      fill="url(#txG)"
                      strokeWidth={1.5}
                      dot={false}
                      name="TX"
                    />
                    <Area
                      type="monotone"
                      dataKey="rx"
                      stroke="#a78bfa"
                      fill="url(#rxG)"
                      strokeWidth={1.5}
                      dot={false}
                      name="RX"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-60 flex items-center justify-center text-sm text-zinc-400">
                  {selectedIface ? "Collecting data..." : "Click an interface to view bandwidth"}
                </div>
              )}
              <div className="flex gap-4 mt-1 text-xs text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-px bg-blue-400 inline-block" /> TX
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-px bg-violet-400 inline-block" /> RX
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* --- Row 3: Connected Clients --- */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-50 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Connected Clients</h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">{boundCount} bound · grouped by subnet</p>
            </div>
            <input
              type="text"
              placeholder="Search IP, hostname, MAC..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-600 w-full sm:w-56 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400"
            />
          </div>

          {subnets.length > 0 ? (
            subnets.map((subnet) => (
              <div key={subnet}>
                <div className="px-4 py-1.5 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-500 font-mono">{subnet}.0/24</span>
                  <span className="text-[11px] text-zinc-400">{grouped[subnet].length} hosts</span>
                </div>
                <div className="px-4">
                  {grouped[subnet].map((lease) => (
                    <ClientRow key={lease[".id"]} lease={lease} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-400 py-6 text-center px-4">
              {data ? "No clients found" : "Connecting..."}
            </p>
          )}
        </div>

      </div>
    </main>
  );
}
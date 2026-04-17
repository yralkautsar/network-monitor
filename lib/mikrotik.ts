// lib/mikrotik.ts
// MikroTik REST API client
// All requests are server-side only — credentials never leave the backend

const MIKROTIK_HOST = process.env.MIKROTIK_HOST!;
const MIKROTIK_USER = process.env.MIKROTIK_USER!;
const MIKROTIK_PASS = process.env.MIKROTIK_PASS!;

// Basic Auth header builder
function getAuthHeader(): string {
  const credentials = Buffer.from(`${MIKROTIK_USER}:${MIKROTIK_PASS}`).toString("base64");
  return `Basic ${credentials}`;
}

// Base fetch wrapper — disables SSL cert verification (self-signed cert on router)
// Uses Node.js native fetch (Next.js 13+ supports this server-side)
async function mikrotikFetch(endpoint: string): Promise<any> {
  const url = `https://${MIKROTIK_HOST}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    // @ts-ignore — Node.js fetch option, not in standard TS types
    agent: new (require("https").Agent)({ rejectUnauthorized: false }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`MikroTik API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// --- Data fetchers ---

// Bandwidth usage per interface (tx/rx bytes, speed, status)
export async function getInterfaces(): Promise<MikroTikInterface[]> {
  return mikrotikFetch("/rest/interface");
}

// Connected DHCP clients (IP, MAC, hostname, lease status)
export async function getDhcpLeases(): Promise<MikroTikDhcpLease[]> {
  return mikrotikFetch("/rest/ip/dhcp-server/lease");
}

// Traffic per IP — requires /ip accounting to be enabled on the router
export async function getAccountingSnapshot(): Promise<MikroTikAccountingEntry[]> {
  return mikrotikFetch("/rest/ip/accounting/snapshot");
}

// System uptime, CPU load, memory usage, board name
export async function getSystemResource(): Promise<MikroTikSystemResource> {
  const data = await mikrotikFetch("/rest/system/resource");
  return data[0] ?? data; // RouterOS returns array for most endpoints, object for this one
}

// Convenience: fetch all four in parallel — used by the SSE handler
export async function getAllNetworkData(): Promise<NetworkSnapshot> {
  const [interfaces, leases, accounting, system] = await Promise.all([
    getInterfaces(),
    getDhcpLeases(),
    getAccountingSnapshot(),
    getSystemResource(),
  ]);

  return {
    interfaces,
    leases,
    accounting,
    system,
    timestamp: Date.now(),
  };
}

// --- Types ---

export interface MikroTikInterface {
  ".id": string;
  name: string;
  type: string;
  "tx-byte": string;
  "rx-byte": string;
  "tx-rate": string;
  "rx-rate": string;
  running: string;
  disabled: string;
  comment?: string;
}

export interface MikroTikDhcpLease {
  ".id": string;
  address: string;
  "mac-address": string;
  "host-name"?: string;
  status: string; // "bound" | "waiting" | "offered"
  server: string;
  comment?: string;
}

export interface MikroTikAccountingEntry {
  src: string;      // source IP
  dst: string;      // destination IP
  bytes: string;
  packets: string;
}

export interface MikroTikSystemResource {
  uptime: string;
  "cpu-load": string;       // percentage as string e.g. "12"
  "free-memory": string;    // bytes as string
  "total-memory": string;   // bytes as string
  "board-name": string;
  version: string;
}

export interface NetworkSnapshot {
  interfaces: MikroTikInterface[];
  leases: MikroTikDhcpLease[];
  accounting: MikroTikAccountingEntry[];
  system: MikroTikSystemResource;
  timestamp: number;
}
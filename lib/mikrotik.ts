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

// Base fetch wrapper — uses Node.js https module to support rejectUnauthorized: false
// Required because MikroTik uses a self-signed certificate
async function mikrotikFetch(endpoint: string): Promise<any> {
  const url = `https://${MIKROTIK_HOST}${endpoint}`;

  return new Promise((resolve, reject) => {
    const https = require("https");
    const options = {
      headers: {
        Authorization: getAuthHeader(),
      },
      rejectUnauthorized: false, // self-signed cert on MikroTik
    };

    https.get(url, options, (res: any) => {
      let data = "";

      res.on("data", (chunk: string) => { data += chunk; });

      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`MikroTik API error: ${res.statusCode} — ${endpoint}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Failed to parse MikroTik response from ${endpoint}`));
        }
      });
    }).on("error", (err: Error) => {
      reject(err);
    });
  });
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
  return Array.isArray(data) ? data[0] : data;
}

// Convenience: fetch all four in parallel — used by the SSE handler
// Uses allSettled so one failing endpoint doesn't kill the entire snapshot
export async function getAllNetworkData(): Promise<NetworkSnapshot> {
  const [interfaces, leases, system] = await Promise.allSettled([
    getInterfaces(),
    getDhcpLeases(),
    getSystemResource(),
  ]);

  return {
    interfaces: interfaces.status === "fulfilled" ? interfaces.value : [],
    leases: leases.status === "fulfilled" ? leases.value : [],
    accounting: [], // IP Accounting not available on RouterOS 7 CCR
    system: system.status === "fulfilled" ? system.value : {} as MikroTikSystemResource,
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
  src: string;
  dst: string;
  bytes: string;
  packets: string;
}

export interface MikroTikSystemResource {
  uptime: string;
  "cpu-load": string;
  "free-memory": string;
  "total-memory": string;
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
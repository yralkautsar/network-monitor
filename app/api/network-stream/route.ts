// app/api/network-stream/route.ts
// SSE handler — polls MikroTik every 5s and pushes data to the browser
// Runs in Node.js runtime (required for rejectUnauthorized: false in mikrotik.ts)

import { getAllNetworkData } from "@/lib/mikrotik";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // Prevent Next.js from caching this route

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Helper — formats data as SSE event string
      function sendEvent(data: unknown): void {
        const payload = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }

      // Helper — sends a named error event so the client can handle it gracefully
      function sendError(message: string): void {
        const payload = `event: error\ndata: ${JSON.stringify({ message })}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }

      // Poll loop — runs until client disconnects
      while (true) {
        try {
          const snapshot = await getAllNetworkData();
          sendEvent(snapshot);
        } catch (err) {
          // Don't kill the stream on a single failed poll — log and continue
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[network-stream] Poll error:", message);
          sendError(message);
        }

        // Wait 5s before next poll
        await sleep(5000);
      }
    },

    cancel() {
      // Client disconnected — ReadableStream cancel is called automatically
      // The while loop above will exit on next iteration when controller.enqueue throws
      console.log("[network-stream] Client disconnected");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Required for SSE to work through some proxies/nginx
      "X-Accel-Buffering": "no",
    },
  });
}

// Simple sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
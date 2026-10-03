import { route } from "@/lib/http";
import { TYPICAL_PRODUCTS } from "@/lib/eta";
import { onBranchesChanged } from "@/lib/events";
import { pointSchema, servingBranch } from "@/lib/stores";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

// Live version of /api/stores/closest (Server-Sent Events): sends the branch
// serving this point straight away, then again whenever it changes (a
// driver going online or offline, a queue growing or shrinking). A comment
// every 15 s keeps CloudFront and the load balancer from closing the
// connection; the app reconnects if it drops.
export const GET = route(async (req) => {
  const { lat, lng, products } = pointSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const encoder = new TextEncoder();
  let stop = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let last = "";
      let pending: ReturnType<typeof setTimeout> | null = null;
      const send = (text: string) => {
        try { controller.enqueue(encoder.encode(text)); } catch { stop(); }
      };
      const push = async () => {
        const branch = JSON.stringify(await servingBranch(lat, lng, products || TYPICAL_PRODUCTS));
        if (branch !== last) {
          last = branch;
          send(`event: branch\ndata: ${branch}\n\n`);
        }
      };
      // Several changes in a row become one recheck.
      const changed = () => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; push().catch(() => {}); }, 150);
      };

      const unsubscribe = onBranchesChanged(changed);
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);
      stop = () => {
        unsubscribe();
        clearInterval(heartbeat);
        if (pending) clearTimeout(pending);
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener("abort", () => stop());
      await push();
    },
    cancel() { stop(); },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
});

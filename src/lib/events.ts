import { EventEmitter } from "node:events";

// Tells open live connections (/api/stores/stream) that branch availability
// or a queue changed: a driver went online or offline, an order was paid or
// left a branch. In-process: right for a single server task. With several
// tasks, publish through a shared channel (Redis, AppSync Events) instead;
// callers only use the two functions below.
const globalForEvents = globalThis as unknown as { branchEvents?: EventEmitter };
const emitter = (globalForEvents.branchEvents ??= new EventEmitter().setMaxListeners(0));

export function branchesChanged() {
  emitter.emit("branches");
}

export function onBranchesChanged(listener: () => void) {
  emitter.on("branches", listener);
  return () => emitter.off("branches", listener);
}

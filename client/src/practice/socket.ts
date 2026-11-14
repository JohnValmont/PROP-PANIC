/** A WebSocket look-alike whose other end is a practice room in a Web Worker (./worker.ts), so Net and Game need no changes. */
export class PracticeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private w: Worker;

  constructor() {
    this.w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.w.onmessage = (e) => {
      if (typeof e.data === 'string') this.onmessage?.({ data: e.data });
      else if (e.data?.closed) this.close();
    };
    this.w.onerror = () => { this.onerror?.(); this.close(); };
    setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.(); }, 0);
  }

  send(s: string) { if (this.readyState === 1) this.w.postMessage(s); }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.w.terminate();
    this.onclose?.();
  }
}

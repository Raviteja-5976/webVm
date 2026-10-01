export type OutputChunk = string | Uint8Array;
type Listener = (data: OutputChunk) => void;

/**
 * Fan-out for VM console output. Output produced before the terminal
 * subscribes (e.g. early boot messages) is buffered and replayed once.
 */
export class OutputHub {
  private listeners = new Set<Listener>();
  private backlog: OutputChunk[] = [];
  private seenOutput = false;
  private firstWaiters: Array<() => void> = [];

  emit(data: OutputChunk): void {
    if (!this.seenOutput) {
      this.seenOutput = true;
      this.firstWaiters.splice(0).forEach((fn) => fn());
    }
    if (this.listeners.size === 0) {
      if (this.backlog.length < 4096) this.backlog.push(data);
      return;
    }
    for (const listener of this.listeners) listener(data);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.backlog.length) {
      const pending = this.backlog.splice(0);
      for (const chunk of pending) listener(chunk);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Resolves on the first emitted chunk, or after `timeoutMs` regardless. */
  waitForFirst(timeoutMs: number): Promise<void> {
    if (this.seenOutput) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.firstWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  clear(): void {
    this.listeners.clear();
    this.backlog = [];
    this.firstWaiters.splice(0).forEach((fn) => fn());
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

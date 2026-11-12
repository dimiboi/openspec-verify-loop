import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

export type PiConnection = {
  request(type: string, values: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  close(signal: AbortSignal, hard?: boolean): Promise<void>;
  alive(): boolean;
  flush(): Promise<void>;
};

/** Own exactly one fixture-scoped Pi process; no user session is attached. */
export class PiRpc implements PiConnection {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<string, {resolve(value: unknown): void; reject(error: unknown): void}>();
  private sequence = 0;
  private records: Promise<void> = Promise.resolve();
  private failure: Error | undefined;
  constructor(cwd: string, env: NodeJS.ProcessEnv, args: string[], private record: (value: unknown) => Promise<void>) {
    this.child = spawn('pi', ['--mode', 'rpc', ...args], {cwd, env: {...process.env, ...env}, stdio: 'pipe'});
    const lines = createInterface({input: this.child.stdout});
    lines.on('line', line => {
      try {
        const value = JSON.parse(line) as {type?: string; id?: string; success?: boolean; data?: unknown; error?: string};
        this.save({direction: 'receive', value});
        if (value.type !== 'response' || !value.id) return;
        const request = this.pending.get(value.id); if (!request) return;
        this.pending.delete(value.id);
        if (value.success) request.resolve(value.data); else request.reject(new Error(value.error ?? 'Pi RPC rejected request'));
      } catch (error) { this.fail(new Error(`Invalid Pi RPC record: ${String(error)}`)); }
    });
    this.child.stderr.on('data', data => this.save({stderr: String(data)}));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => this.fail(new Error(`Owned Pi process exited ${code ?? signal}`)));
    this.child.stdin.on('error', error => this.fail(error));
  }
  private save(value: unknown) { this.records = this.records.then(() => this.record(value)); this.records.catch(error => this.fail(error)); }
  private fail(error: Error) {
    this.failure ??= error;
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }
  alive() { return this.child.exitCode === null && this.child.signalCode === null && !this.failure; }
  flush() { return this.records; }
  async request(type: string, values: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted(); if (this.failure) throw this.failure;
    const id = `req-${++this.sequence}`;
    const request = {id, type, ...values};
    await this.record({direction: 'send', value: request});
    signal.throwIfAborted(); if (this.failure) throw this.failure;
    return new Promise((resolve, reject) => {
      const abort = () => {this.pending.delete(id); reject(signal.reason);};
      this.pending.set(id, {resolve: value => {signal.removeEventListener('abort', abort); resolve(value);},
        reject: error => {signal.removeEventListener('abort', abort); reject(error);}});
      signal.addEventListener('abort', abort, {once: true});
      this.child.stdin.write(`${JSON.stringify(request)}\n`, error => {if (error) this.fail(error);});
    });
  }
  async close(signal: AbortSignal, hard = false) {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {await this.flush(); return;}
    const exited = once(this.child, 'exit', {signal});
    this.child.kill(hard ? 'SIGKILL' : 'SIGTERM');
    await exited; await this.flush();
  }
}

import { WebSocket } from "ws";
import type { Clock, Timer } from "../src/clock.js";
import type { LivekitPort, LivekitTokenRequest } from "../src/livekit.js";

export type LivekitCall =
  | { op: "createRoom"; room: string }
  | { op: "deleteRoom"; room: string }
  | ({ op: "issueToken" } & LivekitTokenRequest)
  | { op: "setCanPublish"; room: string; identity: string; canPublish: boolean };

/** Faux LiveKit : enregistre les appels du serveur commun. */
export class FakeLivekit implements LivekitPort {
  readonly url = "wss://livekit.test";
  readonly calls: LivekitCall[] = [];

  async createRoom(room: string) {
    this.calls.push({ op: "createRoom", room });
  }
  async deleteRoom(room: string) {
    this.calls.push({ op: "deleteRoom", room });
  }
  async issueToken(request: LivekitTokenRequest) {
    this.calls.push({ op: "issueToken", ...request });
    return `livekit-token-${request.identity}`;
  }
  async setCanPublish(room: string, identity: string, canPublish: boolean) {
    this.calls.push({ op: "setCanPublish", room, identity, canPublish });
  }

  /** Rooms créées et pas encore supprimées. */
  get openRooms(): string[] {
    const open = new Set<string>();
    for (const call of this.calls) {
      if (call.op === "createRoom") open.add(call.room);
      if (call.op === "deleteRoom") open.delete(call.room);
    }
    return [...open];
  }
}

/** Horloge manuelle : le temps n'avance qu'avec `advance`, qui déclenche les minuteurs échus. */
export class ManualClock implements Clock {
  private current: number;
  private timers: { at: number; callback: () => void; cancelled: boolean }[] = [];

  constructor(start: Date) {
    this.current = start.getTime();
  }

  now() {
    return new Date(this.current);
  }

  setTimeout(callback: () => void, ms: number): Timer {
    const timer = { at: this.current + ms, callback, cancelled: false };
    this.timers.push(timer);
    return { cancel: () => (timer.cancelled = true) };
  }

  advance(ms: number) {
    const target = this.current + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => !t.cancelled && t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.cancelled = true;
      this.current = due.at;
      due.callback();
    }
    this.current = target;
    this.timers = this.timers.filter((t) => !t.cancelled);
  }
}

type Message = { type: string; [key: string]: unknown };

/** Client WebSocket de test : file des messages reçus et attente de la fermeture. */
export class TestSocket {
  private readonly queue: Message[] = [];
  private waiters: ((message: Message) => void)[] = [];
  readonly closed: Promise<{ code: number }>;
  readonly opened: Promise<void>;

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Message;
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.queue.push(message);
    });
    this.closed = new Promise((resolve) => ws.on("close", (code) => resolve({ code })));
    this.opened = new Promise((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
  }

  static async open(url: string, options: { autoPong?: boolean } = {}): Promise<TestSocket> {
    const socket = new TestSocket(new WebSocket(url, { autoPong: options.autoPong ?? true }));
    await socket.opened;
    return socket;
  }

  /** Prochain ping reçu du serveur. */
  nextPing(): Promise<void> {
    return new Promise((resolve) => this.ws.once("ping", () => resolve()));
  }

  send(message: unknown) {
    this.ws.send(typeof message === "string" ? message : JSON.stringify(message));
  }

  /** Prochain message reçu ; échoue au bout d'une seconde. */
  next(): Promise<Message> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error("aucun message reçu"));
      }, 1000);
      const waiter = (message: Message) => {
        clearTimeout(timeout);
        resolve(message);
      };
      this.waiters.push(waiter);
    });
  }

  get isOpen() {
    return this.ws.readyState === WebSocket.OPEN;
  }

  close() {
    this.ws.close();
  }
}

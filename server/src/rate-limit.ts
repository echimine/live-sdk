import type { Clock } from "./clock.js";

/**
 * Fenêtre glissante par clé : au plus `limit` passages sur les `windowMs`
 * dernières millisecondes. Vit en mémoire, comme les autres compteurs anti-spam.
 */
export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly windowMs: number) {}

  /**
   * Compte un passage pour `key` s'il reste de la place, et rend `undefined` ;
   * sinon rend le délai, en millisecondes, avant que le plus ancien ne sorte de la fenêtre.
   */
  take(key: string, limit: number, now: Date): number | undefined {
    const at = now.getTime();
    const recent = (this.hits.get(key) ?? []).filter((hit) => hit > at - this.windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return recent[recent.length - limit]! + this.windowMs - at;
    }
    recent.push(at);
    this.hits.set(key, recent);
    return undefined;
  }

  /** Rend le passage compté à `now` pour `key` (l'action a finalement échoué). */
  giveBack(key: string, now: Date): void {
    const hits = this.hits.get(key);
    const index = hits?.lastIndexOf(now.getTime()) ?? -1;
    if (hits && index >= 0) hits.splice(index, 1);
  }
}

/** Quota fixe : `limit` passages par `windowMs` et par clé, sur l'horloge injectable. */
export class Quota {
  private readonly window: SlidingWindow;

  constructor(
    private readonly limit: number,
    windowMs: number,
    private readonly clock: Clock,
  ) {
    this.window = new SlidingWindow(windowMs);
  }

  /** Compte un passage pour `key` et rend `undefined`, ou rend le délai avant de réessayer (ms). */
  take(key: string): number | undefined {
    return this.window.take(key, this.limit, this.clock.now());
  }
}

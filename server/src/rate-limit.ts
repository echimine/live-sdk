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

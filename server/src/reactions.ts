import type { Clock, Timer } from "./clock.js";
import { SlidingWindow } from "./rate-limit.js";

/** Cadence de diffusion des Réactions, agrégées entre deux diffusions. */
export const REACTIONS_INTERVAL_MS = 500;
/** Au-delà de `REACTIONS_PER_WINDOW` sur `REACTIONS_WINDOW_MS`, les Réactions d'un Participant sont ignorées. */
export const REACTIONS_PER_WINDOW = 10;
export const REACTIONS_WINDOW_MS = 1_000;
/** Le total des Réactions est écrit en base au plus à cette cadence, s'il a changé. */
export const REACTIONS_PERSIST_MS = 5_000;

/** Un emoji sans ses sélecteurs de variante : « ❤ » et « ❤️ » désignent la même Réaction. */
function withoutVariation(emoji: string): string {
  return emoji.replace(/[︎️]/g, "");
}

export interface LiveReactionsDeps {
  clock: Clock;
  /** Jeu de Réactions de la config : seules celles-ci comptent, sous leur forme de la config. */
  allowed: readonly string[];
  /** Diffuse les Réactions de la fenêtre écoulée et le total depuis le début du Live. */
  broadcast(counts: Record<string, number>, total: number): void;
  /** Écrit le total en base. */
  save(total: number): Promise<void>;
  /** Échec d'une écriture périodique (retentée au cycle suivant). */
  onSaveError(error: unknown): void;
}

/**
 * Réactions d'un Live : comptées par Participant (10 par seconde au plus),
 * agrégées puis diffusées toutes les 500 ms quand il y en a, et seul leur total
 * est conservé, écrit en base toutes les 5 s quand il a changé.
 */
export class LiveReactions {
  private totalCount: number;
  private savedTotal: number;
  private readonly pending = new Map<string, number>();
  private readonly perParticipant = new SlidingWindow(REACTIONS_WINDOW_MS);
  private readonly canonical: Map<string, string>;
  private broadcastTimer: Timer | undefined;
  private saveTimer: Timer | undefined;
  private halted = false;

  constructor(
    savedTotal: number,
    private readonly deps: LiveReactionsDeps,
  ) {
    this.totalCount = savedTotal;
    this.savedTotal = savedTotal;
    this.canonical = new Map(deps.allowed.map((emoji) => [withoutVariation(emoji), emoji]));
  }

  /** Total depuis le début du Live, Réactions pas encore diffusées comprises. */
  get total(): number {
    return this.totalCount;
  }

  /** Compte une Réaction ; un emoji hors du jeu ou au-delà de la limite est ignoré en silence. */
  add(participantId: string, emoji: string): void {
    const reaction = this.canonical.get(withoutVariation(emoji));
    if (reaction === undefined || this.halted) return;
    if (this.perParticipant.take(participantId, REACTIONS_PER_WINDOW, this.deps.clock.now()) !== undefined) return;
    this.totalCount++;
    this.pending.set(reaction, (this.pending.get(reaction) ?? 0) + 1);
    this.schedule();
  }

  /** Arrête les diffusions et les écritures (fin du Live, arrêt du serveur). */
  halt(): void {
    this.halted = true;
    this.broadcastTimer?.cancel();
    this.broadcastTimer = undefined;
    this.saveTimer?.cancel();
    this.saveTimer = undefined;
  }

  /** Reprend après un `halt` (la fin du Live a échoué) : ce qui restait à diffuser ou écrire repart. */
  resume(): void {
    this.halted = false;
    this.schedule();
  }

  /** Écrit le total s'il a changé depuis la dernière écriture. */
  async save(): Promise<void> {
    const total = this.totalCount;
    if (total === this.savedTotal) return;
    await this.deps.save(total);
    this.savedTotal = Math.max(this.savedTotal, total);
  }

  private schedule(): void {
    if (this.halted) return;
    if (this.pending.size > 0 && !this.broadcastTimer) {
      this.broadcastTimer = this.deps.clock.setTimeout(() => {
        this.broadcastTimer = undefined;
        const counts = Object.fromEntries(this.pending);
        this.pending.clear();
        this.deps.broadcast(counts, this.totalCount);
      }, REACTIONS_INTERVAL_MS);
    }
    if (this.totalCount !== this.savedTotal && !this.saveTimer) {
      this.saveTimer = this.deps.clock.setTimeout(() => {
        this.saveTimer = undefined;
        this.save().catch((error: unknown) => {
          this.deps.onSaveError(error);
          this.schedule();
        });
      }, REACTIONS_PERSIST_MS);
    }
  }
}

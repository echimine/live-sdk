import type { ChatStore } from "./chat-store.js";
import type { Clock } from "./clock.js";
import type { LivekitPort } from "./livekit.js";
import type { LiveStore } from "./live-store.js";
import type { ModerationStore } from "./moderation-store.js";
import type { ProductStore } from "./product-store.js";
import type { Config } from "./protocol/index.js";
import {
  AUDIENCE_INTERVAL_MS,
  audienceOf,
  broadcast,
  type Logger,
  type Presence,
  type RunningLive,
  sameAudience,
} from "./live-state.js";

export interface LivesDeps {
  store: LiveStore;
  chat: ChatStore;
  products: ProductStore;
  moderation: ModerationStore;
  livekit: LivekitPort;
  clock: Clock;
  log: Logger;
  /** Config servie aux SDK : le serveur applique les mêmes limites. */
  config: Config;
}

/**
 * Ce que tous les modules d'un Live partagent : les dépendances, le registre des
 * Lives en cours (la présence vit en mémoire, ADR 0002) et l'Audience.
 */
export class LiveContext {
  /** Lives en cours, par identifiant. */
  readonly running = new Map<string, RunningLive>();
  /** Arrêt du serveur : plus aucun minuteur ne doit tourner. */
  stopped = false;

  readonly store: LiveStore;
  readonly chat: ChatStore;
  readonly products: ProductStore;
  readonly moderation: ModerationStore;
  readonly livekit: LivekitPort;
  readonly clock: Clock;
  readonly log: Logger;
  readonly config: Config;

  constructor(deps: LivesDeps) {
    this.store = deps.store;
    this.chat = deps.chat;
    this.products = deps.products;
    this.moderation = deps.moderation;
    this.livekit = deps.livekit;
    this.clock = deps.clock;
    this.log = deps.log;
    this.config = deps.config;
  }

  /** Le Live est toujours en cours avec cet état (il a pu se terminer pendant une écriture). */
  isRunning(state: RunningLive): boolean {
    return !state.ending && this.running.get(state.live.id) === state;
  }

  /** Le Live en cours de cette présence, s'il n'est pas en train de se terminer. */
  runningFor(presence: Presence): RunningLive | undefined {
    const state = this.running.get(presence.liveId);
    return state && !state.ending ? state : undefined;
  }

  /**
   * L'Audience vient de changer (arrivée, départ, montée ou descente, exclusion) :
   * un nouveau sommet est retenu et écrit en base aussitôt, puis la diffusion est prévue.
   */
  audienceChanged(state: RunningLive): void {
    const total = audienceOf(state).total;
    if (total > state.peakAudience) {
      state.peakAudience = total;
      // Un échec est journalisé : la fin du Live réécrit de toute façon le sommet retenu en mémoire.
      state.peakSave = this.store.savePeakAudience(state.live.id, total).catch((error: unknown) => {
        this.log.error({ err: error, liveId: state.live.id }, "enregistrement de l'Audience maximale impossible");
      });
    }
    this.scheduleAudience(state);
  }

  /** Prévoit une diffusion de l'Audience, au plus tôt `AUDIENCE_INTERVAL_MS` après la précédente. */
  scheduleAudience(state: RunningLive): void {
    if (state.audienceTimer || state.ending || this.stopped) return;
    state.audienceTimer = this.clock.setTimeout(() => {
      state.audienceTimer = undefined;
      const audience = audienceOf(state);
      if (sameAudience(audience, state.audienceSent)) return;
      state.audienceSent = audience;
      broadcast(state, { type: "audience", ...audience });
    }, AUDIENCE_INTERVAL_MS);
  }
}

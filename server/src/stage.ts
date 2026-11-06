import type { Participant } from "./protocol/index.js";

/** Co-hôte redescendu, et sa place dans l'ordre de montée. */
export interface Demoted {
  cohost: Participant;
  place: number;
}

/** Au plus 5 Co-hôtes à l'écran aux côtés de l'Hôte. */
export const MAX_COHOSTS = 5;

/**
 * Co-hôtes d'un Live, par ordre de montée, et Demandes de montée en attente (en
 * mémoire, perdues au redémarrage ; une seule par Spectateur).
 */
export class LiveStage {
  private readonly requests = new Map<string, Participant>();
  private readonly onStage: Participant[];

  /** `cohosts` : Co-hôtes enregistrés, par ordre de montée (vide pour un Live neuf). */
  constructor(cohosts: Participant[]) {
    this.onStage = [...cohosts];
  }

  /** Co-hôtes, par ordre de montée. */
  get cohosts(): Participant[] {
    return [...this.onStage];
  }

  /** Demandes en attente, de la plus ancienne à la plus récente. */
  get joinRequests(): Participant[] {
    return [...this.requests.values()];
  }

  isCohost(participantId: string): boolean {
    return this.onStage.some((cohost) => cohost.id === participantId);
  }

  get isFull(): boolean {
    return this.onStage.length >= MAX_COHOSTS;
  }

  /** Enregistre une demande ; `false` si ce Spectateur en avait déjà une en attente. */
  request(participant: Participant): boolean {
    if (this.requests.has(participant.id)) return false;
    this.requests.set(participant.id, participant);
    return true;
  }

  /** La demande en attente de ce Participant, s'il en a une. */
  requestOf(participantId: string): Participant | undefined {
    return this.requests.get(participantId);
  }

  /** Retire la demande de ce Participant ; `false` s'il n'en avait pas. */
  withdraw(participantId: string): boolean {
    return this.requests.delete(participantId);
  }

  /** Fait monter ce Participant à l'écran, en dernier ; sa demande éventuelle est retirée. */
  promote(participant: Participant): void {
    this.requests.delete(participant.id);
    if (!this.isCohost(participant.id)) this.onStage.push(participant);
  }

  /**
   * Annule une montée (l'enregistrement a échoué) : il redevient Spectateur, et
   * retrouve sa demande s'il est toujours là.
   */
  undoPromote(participant: Participant, stillPresent: boolean): void {
    this.demote(participant.id);
    if (stillPresent) this.requests.set(participant.id, participant);
  }

  /** Fait redescendre ce Co-hôte ; rend qui et à quelle place, `undefined` s'il ne l'était pas. */
  demote(participantId: string): Demoted | undefined {
    const place = this.onStage.findIndex((cohost) => cohost.id === participantId);
    const [cohost] = place < 0 ? [] : this.onStage.splice(place, 1);
    return cohost && { cohost, place };
  }

  /** Annule une descente (l'enregistrement a échoué) : il retrouve sa place. */
  undoDemote({ cohost, place }: Demoted): void {
    if (!this.isCohost(cohost.id)) this.onStage.splice(place, 0, cohost);
  }
}

import type { Participant } from "./protocol/index.js";

/** Shadowbans et Bannissements d'un Live, tels que les voient ses Animateurs. */
export interface ModerationLists {
  shadowbanned: Participant[];
  banned: Participant[];
}

/**
 * Shadowbans et Bannissements d'un Live en cours, par ordre de décision. Un
 * Bannissement l'emporte sur un Shadowban : un Participant n'est que dans une liste.
 */
export class LiveModeration {
  private readonly shadowbans = new Map<string, Participant>();
  private readonly bans = new Map<string, Participant>();

  /** `lists` : Shadowbans et Bannissements enregistrés (vides pour un Live neuf). */
  constructor(lists: ModerationLists) {
    for (const participant of lists.shadowbanned) this.shadowbans.set(participant.id, participant);
    for (const participant of lists.banned) this.bans.set(participant.id, participant);
  }

  get lists(): ModerationLists {
    return { shadowbanned: [...this.shadowbans.values()], banned: [...this.bans.values()] };
  }

  isShadowbanned(participantId: string): boolean {
    return this.shadowbans.has(participantId);
  }

  isBanned(participantId: string): boolean {
    return this.bans.has(participantId);
  }

  /** Met ce Participant en Shadowban ; `false` s'il y était déjà ou est banni. */
  shadowban(participant: Participant): boolean {
    if (this.shadowbans.has(participant.id) || this.bans.has(participant.id)) return false;
    this.shadowbans.set(participant.id, participant);
    return true;
  }

  /** Lève le Shadowban de ce Participant et le rend ; `undefined` s'il n'en avait pas. */
  unshadowban(participantId: string): Participant | undefined {
    const participant = this.shadowbans.get(participantId);
    this.shadowbans.delete(participantId);
    return participant;
  }

  /**
   * Bannit ce Participant, à la place de son Shadowban éventuel ; rend s'il en
   * avait un (pour `undoBan`), `undefined` s'il était déjà banni.
   */
  ban(participant: Participant): { wasShadowbanned: boolean } | undefined {
    if (this.bans.has(participant.id)) return undefined;
    const wasShadowbanned = this.shadowbans.delete(participant.id);
    this.bans.set(participant.id, participant);
    return { wasShadowbanned };
  }

  /** Annule un Bannissement (son enregistrement a échoué) : il retrouve son Shadowban éventuel. */
  undoBan(participant: Participant, { wasShadowbanned }: { wasShadowbanned: boolean }): void {
    this.bans.delete(participant.id);
    if (wasShadowbanned) this.shadowbans.set(participant.id, participant);
  }
}

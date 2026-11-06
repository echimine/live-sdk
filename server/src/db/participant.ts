import type { Participant } from "../protocol/index.js";

/**
 * Un Participant est figé dans chaque table sous quatre colonnes préfixées
 * (`host_*` dans `lives`, `author_*` dans `chat_messages`, `buyer_*` dans
 * `purchases`, `participant_*` ailleurs) : identité, App d'origine, pseudo et avatar.
 */
type Prefix = "host" | "participant" | "author" | "buyer";

/** Les quatre colonnes d'un Participant, telles que Drizzle les lit ou les écrit. */
export type ParticipantColumns<P extends Prefix> = { [K in `${P}Id` | `${P}App` | `${P}Name`]: string } & {
  [K in `${P}Picture`]: string | null;
};

/** Le Participant d'une ligne, tel qu'il part sur le fil : sans `picture` quand l'avatar est nul. */
export function toParticipant<P extends Prefix>(row: ParticipantColumns<P>, prefix: P): Participant {
  const columns = row as Record<string, string | null>;
  const picture = columns[`${prefix}Picture`];
  return {
    id: columns[`${prefix}Id`] as string,
    app: columns[`${prefix}App`] as string,
    name: columns[`${prefix}Name`] as string,
    ...(picture != null && { picture }),
  };
}

/** Les colonnes à écrire pour ce Participant. */
export function participantColumns<P extends Prefix>(participant: Participant, prefix: P): ParticipantColumns<P> {
  return {
    [`${prefix}Id`]: participant.id,
    [`${prefix}App`]: participant.app,
    [`${prefix}Name`]: participant.name,
    [`${prefix}Picture`]: participant.picture ?? null,
  } as ParticipantColumns<P>;
}

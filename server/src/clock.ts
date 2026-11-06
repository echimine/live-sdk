/**
 * Horloge injectable : l'heure courante et les minuteurs (délai de `join`,
 * ping/pong) passent par elle, pour que les tests contrôlent le temps.
 */
export interface Clock {
  now(): Date;
  setTimeout(callback: () => void, ms: number): Timer;
}

export interface Timer {
  cancel(): void;
}

export const systemClock: Clock = {
  now: () => new Date(),
  setTimeout(callback, ms) {
    const handle = setTimeout(callback, ms);
    return { cancel: () => clearTimeout(handle) };
  },
};

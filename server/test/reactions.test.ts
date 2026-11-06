import { describe, expect, it } from "vitest";
import { REACTIONS_PERSIST_MS } from "../src/reactions.js";
import type { TestSocket } from "./fakes.js";
import { type Claims, useLiveServer } from "./live-harness.js";

const lea: Claims = { sub: "u_1042", name: "Léa" };
const noa: Claims = { iss: "demo-android", sub: "u_88", name: "Noa" };
const sam: Claims = { sub: "u_310", name: "Sam" };

describe("Réactions du Live", () => {
  const harness = useLiveServer();

  function react(socket: TestSocket, emoji: string, times = 1) {
    for (let i = 0; i < times; i++) socket.send({ type: "react", emoji });
  }

  it("agrégées et diffusées à tous toutes les 500 ms, sans `ack`", async () => {
    const created = await harness.launch(lea);
    const host = await harness.join(created.id, lea);
    const viewer = await harness.join(created.id, noa);
    const other = await harness.join(created.id, sam);

    react(viewer.socket, "❤️", 2);
    react(other.socket, "🔥");
    await harness.sync(viewer.socket);
    await harness.sync(other.socket);
    harness.live.clock.advance(500);

    const reactions = { type: "reactions", counts: { "❤️": 2, "🔥": 1 }, total: 3 };
    for (const socket of [host.socket, viewer.socket, other.socket]) expect(await socket.next()).toEqual(reactions);

    react(viewer.socket, "❤️");
    await harness.sync(viewer.socket);
    harness.live.clock.advance(500);
    expect(await host.socket.next()).toEqual({ type: "reactions", counts: { "❤️": 1 }, total: 4 });
  });

  it("un emoji hors du jeu de la config est ignoré en silence", async () => {
    const created = await harness.launch(lea);
    const viewer = await harness.join(created.id, noa);

    react(viewer.socket, "🍕");
    react(viewer.socket, "❤️");
    await harness.sync(viewer.socket);
    harness.live.clock.advance(500);

    expect(await viewer.socket.next()).toEqual({ type: "reactions", counts: { "❤️": 1 }, total: 1 });
  });

  it("un emoji du jeu envoyé sans sélecteur de variante compte comme celui de la config", async () => {
    const created = await harness.launch(lea);
    const viewer = await harness.join(created.id, noa);

    react(viewer.socket, "\u2764"); // ❤ sans U+FE0F ; la config contient « ❤️ »
    react(viewer.socket, "❤️");
    await harness.sync(viewer.socket);
    harness.live.clock.advance(500);

    expect(await viewer.socket.next()).toEqual({ type: "reactions", counts: { "❤️": 2 }, total: 2 });
  });

  it("au-delà de 10 par seconde, les Réactions d'un Participant sont ignorées en silence", async () => {
    const created = await harness.launch(lea);
    const viewer = await harness.join(created.id, noa);
    const other = await harness.join(created.id, sam);

    react(viewer.socket, "❤️", 12);
    react(other.socket, "🔥", 3);
    await harness.sync(viewer.socket);
    await harness.sync(other.socket);
    harness.live.clock.advance(500);
    expect(await viewer.socket.next()).toEqual({ type: "reactions", counts: { "❤️": 10, "🔥": 3 }, total: 13 });

    react(viewer.socket, "❤️");
    await harness.sync(viewer.socket);
    harness.live.clock.advance(499);
    await harness.sync(viewer.socket);
    harness.live.clock.advance(1);
    react(viewer.socket, "❤️");
    await harness.sync(viewer.socket);
    harness.live.clock.advance(500);
    expect(await viewer.socket.next()).toEqual({ type: "reactions", counts: { "❤️": 1 }, total: 14 });
  });

  describe("total des Réactions", () => {
    it("présent dans le snapshot, à jour même avant la diffusion suivante", async () => {
      const created = await harness.launch(lea);
      const viewer = await harness.join(created.id, noa);
      react(viewer.socket, "❤️", 3);
      await harness.sync(viewer.socket);

      const { reply } = await harness.join(created.id, sam);

      expect(reply).toMatchObject({ type: "snapshot", reactionsTotal: 3 });
    });

    it("persisté : il survit au redémarrage du serveur", async () => {
      const created = await harness.launch(lea);
      const viewer = await harness.join(created.id, noa);
      react(viewer.socket, "❤️", 3);
      await harness.sync(viewer.socket);

      await harness.restart();
      const { reply } = await harness.join(created.id, noa);

      expect(reply).toMatchObject({ type: "snapshot", reactionsTotal: 3 });
    });

    it("écrit périodiquement : un redémarrage brutal perd au plus les dernières secondes", async () => {
      const created = await harness.launch(lea);
      const viewer = await harness.join(created.id, noa);
      react(viewer.socket, "❤️", 3);
      await harness.sync(viewer.socket);
      harness.live.clock.advance(REACTIONS_PERSIST_MS);
      expect(await viewer.socket.next()).toMatchObject({ type: "reactions", total: 3 });
      expect(await viewer.socket.next()).toMatchObject({ type: "audience" });
      await harness.sync(viewer.socket);
      react(viewer.socket, "🔥", 2);
      await harness.sync(viewer.socket);

      await harness.crash();
      const { reply } = await harness.join(created.id, noa);

      expect(reply).toMatchObject({ type: "snapshot", reactionsTotal: 3 });
    });

    it("compté dans le récapitulatif de fin de l'Hôte", async () => {
      const created = await harness.launch(lea);
      const host = await harness.join(created.id, lea);
      const viewer = await harness.join(created.id, noa);
      react(viewer.socket, "👏", 2);
      await harness.sync(viewer.socket);

      host.socket.send({ type: "endLive", ref: "fin" });

      expect(await host.socket.next()).toEqual({ type: "ack", ref: "fin" });
      expect(await host.socket.next()).toMatchObject({ type: "liveEnded", summary: { reactions: 2 } });
    });
  });

  it("rien n'est diffusé quand il n'y a pas eu de Réaction", async () => {
    const created = await harness.launch(lea);
    const viewer = await harness.join(created.id, noa);

    harness.live.clock.advance(500);

    // L'aller-retour échoue si un autre message (une diffusion `reactions`) le précède.
    await harness.sync(viewer.socket);
  });
});

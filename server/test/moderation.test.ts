import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../src/protocol/index.js";
import type { TestSocket } from "./fakes.js";
import { type Claims, useLiveServer } from "./live-harness.js";

const lea: Claims = { sub: "u_1042", name: "Léa" };
const noa: Claims = { iss: "demo-android", sub: "u_88", name: "Noa" };
const sam: Claims = { sub: "u_310", name: "Sam" };

const noaOnWire = { id: "demo-android:u_88", app: "demo-android", name: "Noa" };

/** Messages du chat d'un `snapshot`. */
function messagesOf(reply: ServerMessage) {
  if (reply.type !== "snapshot") throw new Error(`snapshot attendu, reçu ${reply.type}`);
  return reply.messages;
}

/** Textes des messages du chat d'un `snapshot`. */
function textsOf(reply: ServerMessage) {
  return messagesOf(reply).map((message) => (message.kind === "text" ? message.text : message.kind));
}

describe("Modération", () => {
  const harness = useLiveServer();

  /** Envoie une commande et attend sa réponse (`ack` ou `error`). */
  async function command(socket: TestSocket, message: Record<string, unknown>) {
    socket.send({ ref: "c", ...message });
    return harness.nextNotAudience(socket);
  }

  /** L'Animateur met ce Participant en Shadowban : `ack` puis `moderationChanged`. */
  async function shadowban(animator: TestSocket, participantId: string) {
    expect(await command(animator, { type: "shadowban", participantId })).toEqual({ type: "ack", ref: "c" });
    expect(await harness.nextNotAudience(animator)).toMatchObject({ type: "moderationChanged" });
  }

  /** L'Hôte accepte la Demande de montée en attente de ce Participant ; `roleChanged` chez `sockets`. */
  async function promote(host: TestSocket, participantId: string, sockets: TestSocket[]) {
    expect(await command(host, { type: "acceptJoin", participantId })).toEqual({ type: "ack", ref: "c" });
    for (const socket of sockets) {
      expect(await harness.nextNotAudience(socket)).toMatchObject({ type: "roleChanged", role: "cohost" });
    }
  }

  /** Live de Léa, avec Noa et Sam en Spectateurs. */
  async function liveWithViewers() {
    const created = await harness.launch(lea);
    const host = await harness.join(created.id, lea);
    const viewer = await harness.join(created.id, noa);
    const other = await harness.join(created.id, sam);
    return { created, host: host.socket, viewer: viewer.socket, other: other.socket };
  }

  describe("Shadowban", () => {
    it("les messages d'un Participant en Shadowban ne reviennent qu'à lui", async () => {
      const { host, viewer, other } = await liveWithViewers();

      expect(await command(host, { type: "shadowban", participantId: noaOnWire.id })).toEqual({ type: "ack", ref: "c" });
      expect(await harness.nextNotAudience(host)).toMatchObject({ type: "moderationChanged" });

      expect(await command(viewer, { type: "sendMessage", text: "coucou" })).toEqual({ type: "ack", ref: "c" });
      expect(await harness.nextNotAudience(viewer)).toMatchObject({
        type: "chatMessage",
        message: { author: noaOnWire, text: "coucou" },
      });
      await harness.sync(other, { skipAudience: true });
      await harness.sync(host, { skipAudience: true });
    });

    it("dans le snapshot, ses messages ne sont servis qu'à lui, même après un redémarrage", async () => {
      const { created, host, viewer } = await liveWithViewers();
      await command(viewer, { type: "sendMessage", text: "avant" });
      await harness.nextNotAudience(host);
      await harness.nextNotAudience(viewer);
      await shadowban(host, noaOnWire.id);
      expect(await command(viewer, { type: "sendMessage", text: "pendant" })).toEqual({ type: "ack", ref: "c" });
      await harness.restart();

      const texts = async (claims: Claims) => textsOf((await harness.join(created.id, claims)).reply);
      expect(await texts(noa)).toEqual(["avant", "pendant"]);
      expect(await texts(sam)).toEqual(["avant"]);
      expect(await texts(lea)).toEqual(["avant"]);
    });

    it("lever le Shadowban rend ses messages suivants visibles, les précédents restent cachés", async () => {
      const { created, host, viewer, other } = await liveWithViewers();
      await shadowban(host, noaOnWire.id);
      await command(viewer, { type: "sendMessage", text: "caché" });

      expect(await command(host, { type: "unshadowban", participantId: noaOnWire.id })).toEqual({ type: "ack", ref: "c" });
      expect(await harness.nextNotAudience(host)).toEqual({ type: "moderationChanged", shadowbanned: [], banned: [] });
      await harness.nextNotAudience(viewer);
      await command(viewer, { type: "sendMessage", text: "visible" });

      expect(await harness.nextNotAudience(other)).toMatchObject({ type: "chatMessage", message: { text: "visible" } });
      const { reply } = await harness.join(created.id, { sub: "u_9", name: "Zoé" });
      expect(textsOf(reply)).toEqual(["visible"]);
    });

    it("ses Réactions sont ignorées", async () => {
      const { host, viewer, other } = await liveWithViewers();
      await shadowban(host, noaOnWire.id);

      viewer.send({ type: "react", emoji: "❤️" });
      other.send({ type: "react", emoji: "🔥" });
      await harness.sync(viewer, { skipAudience: true });
      await harness.sync(other, { skipAudience: true });
      harness.live.clock.advance(500);

      expect(await harness.nextNotAudience(host)).toEqual({ type: "reactions", counts: { "🔥": 1 }, total: 1 });
    });

    it("ses Achats comptent, mais leur Annonce n'est visible que de lui", async () => {
      const { host, viewer, other } = await liveWithViewers();
      await shadowban(host, noaOnWire.id);
      await command(host, { type: "pinProduct", name: "Gourde", price: 1500, currency: "EUR" });
      const { product } = (await harness.nextNotAudience(viewer)) as unknown as { product: { id: string } };
      await harness.nextNotAudience(host);
      await harness.nextNotAudience(other);

      expect(await command(viewer, { type: "purchase", productId: product.id })).toEqual({ type: "ack", ref: "c" });
      expect(await harness.nextNotAudience(viewer)).toMatchObject({ type: "chatMessage", message: { kind: "purchase" } });
      await harness.sync(other, { skipAudience: true });

      expect(await command(host, { type: "endLive" })).toEqual({ type: "ack", ref: "c" });
      expect(await harness.nextNotAudience(host)).toMatchObject({ type: "liveEnded", summary: { purchases: 1 } });
    });

    it("il compte toujours dans l'Audience", async () => {
      const { host } = await liveWithViewers();
      await shadowban(host, noaOnWire.id);

      harness.live.clock.advance(2_000);

      expect(await host.next()).toMatchObject({ type: "audience", total: 2 });
    });

    it("`moderationChanged` part vers les Animateurs seuls, et les listes figurent dans leur snapshot seul", async () => {
      const { created, host, viewer, other } = await liveWithViewers();

      await shadowban(host, noaOnWire.id);

      await harness.sync(viewer, { skipAudience: true });
      await harness.sync(other, { skipAudience: true });
      expect((await harness.join(created.id, lea)).reply).toMatchObject({
        moderation: { shadowbanned: [noaOnWire], banned: [] },
      });
      expect((await harness.join(created.id, sam)).reply).not.toHaveProperty("moderation");
    });

    it("un Spectateur ne peut pas modérer : `not_animator`", async () => {
      const { viewer } = await liveWithViewers();

      for (const type of ["shadowban", "unshadowban", "ban"]) {
        expect(await command(viewer, { type, participantId: "demo-ios:u_310" })).toMatchObject({
          type: "error",
          code: "not_animator",
        });
      }
    });

    it("un Participant inconnu du Live : `not_found`, pour mettre comme pour lever", async () => {
      const { host } = await liveWithViewers();

      for (const type of ["shadowban", "unshadowban"]) {
        expect(await command(host, { type, participantId: "demo-ios:fantome" })).toMatchObject({
          type: "error",
          code: "not_found",
        });
      }
    });

    it("un Co-hôte ne peut ni mettre ni lever le Shadowban d'un autre Co-hôte : `not_animator`", async () => {
      const { created, host, viewer, other } = await liveWithViewers();
      for (const socket of [viewer, other]) {
        await command(socket, { type: "requestToJoin" });
        await harness.nextNotAudience(host);
      }
      await promote(host, noaOnWire.id, [host, viewer, other]);
      await promote(host, "demo-ios:u_310", [host, viewer, other]);

      expect(await command(viewer, { type: "shadowban", participantId: "demo-ios:u_310" })).toMatchObject({
        type: "error",
        code: "not_animator",
      });
      expect(await command(viewer, { type: "unshadowban", participantId: "demo-ios:u_310" })).toMatchObject({
        type: "error",
        code: "not_animator",
      });
      expect((await harness.join(created.id, lea)).reply).toMatchObject({ moderation: { shadowbanned: [] } });
    });
  });

  describe("Bannissement", () => {
    /** Fait monter Noa à l'écran : il devient Co-hôte. */
    async function promoteNoa(host: TestSocket, viewer: TestSocket, other: TestSocket) {
      await command(viewer, { type: "requestToJoin" });
      await harness.nextNotAudience(host);
      expect(await command(host, { type: "acceptJoin", participantId: noaOnWire.id })).toEqual({ type: "ack", ref: "c" });
      for (const socket of [host, viewer, other]) {
        expect(await harness.nextNotAudience(socket)).toMatchObject({ type: "roleChanged", role: "cohost" });
      }
    }

    it("le banni reçoit `banned` puis son socket se ferme ; il quitte la room LiveKit", async () => {
      const { created, host, viewer } = await liveWithViewers();

      expect(await command(host, { type: "ban", participantId: noaOnWire.id })).toEqual({ type: "ack", ref: "c" });

      expect(await harness.nextNotAudience(viewer)).toEqual({ type: "banned" });
      expect(await viewer.closed).toEqual({ code: 1000 });
      expect(await harness.nextNotAudience(host)).toEqual({
        type: "moderationChanged",
        shadowbanned: [],
        banned: [noaOnWire],
      });
      expect(harness.live.livekit.calls).toContainEqual({
        op: "removeParticipant",
        room: created.id,
        identity: noaOnWire.id,
      });
    });

    it("ses `join` suivants sont refusés pour ce Live, même après un redémarrage, mais pas pour un autre", async () => {
      const { created, host } = await liveWithViewers();
      await command(host, { type: "ban", participantId: noaOnWire.id });
      await harness.restart();

      const { socket, reply } = await harness.join(created.id, noa);
      expect(reply).toMatchObject({ type: "error", code: "banned" });
      expect(reply).not.toHaveProperty("ref");
      expect(await socket.closed).toEqual({ code: 1008 });

      const other = await harness.launch(sam);
      expect((await harness.join(other.id, noa)).reply).toMatchObject({ type: "snapshot", role: "viewer" });
    });

    it("ses messages passés sont conservés", async () => {
      const { created, host, viewer } = await liveWithViewers();
      await command(viewer, { type: "sendMessage", text: "bonjour" });
      await harness.nextNotAudience(host);

      await command(host, { type: "ban", participantId: noaOnWire.id });

      const { reply } = await harness.join(created.id, { sub: "u_9", name: "Zoé" });
      expect(messagesOf(reply)).toMatchObject([{ author: noaOnWire, text: "bonjour" }]);
    });

    it("un Participant en Shadowban qui est banni passe d'une liste à l'autre", async () => {
      const { host } = await liveWithViewers();
      await shadowban(host, noaOnWire.id);

      await command(host, { type: "ban", participantId: noaOnWire.id });

      expect(await harness.nextNotAudience(host)).toEqual({
        type: "moderationChanged",
        shadowbanned: [],
        banned: [noaOnWire],
      });
    });

    it("l'Hôte bannit un Co-hôte : il redescend parmi les Spectateurs, puis il est exclu", async () => {
      const { host, viewer, other } = await liveWithViewers();
      await promoteNoa(host, viewer, other);

      expect(await command(host, { type: "ban", participantId: noaOnWire.id })).toEqual({ type: "ack", ref: "c" });

      expect(await harness.nextNotAudience(viewer)).toEqual({ type: "banned" });
      expect(await harness.nextNotAudience(other)).toEqual({
        type: "roleChanged",
        participant: noaOnWire,
        role: "viewer",
      });
      expect(await harness.nextNotAudience(host)).toMatchObject({ type: "roleChanged", role: "viewer" });
      expect(await harness.nextNotAudience(host)).toMatchObject({ type: "moderationChanged", banned: [noaOnWire] });
    });

    it("un Co-hôte ne peut pas bannir un autre Co-hôte : `not_animator`", async () => {
      const { created, host, viewer, other } = await liveWithViewers();
      await promoteNoa(host, viewer, other);
      await command(other, { type: "requestToJoin" });
      await harness.nextNotAudience(host);
      await command(host, { type: "acceptJoin", participantId: "demo-ios:u_310" });
      for (const socket of [host, viewer, other]) await harness.nextNotAudience(socket);

      expect(await command(viewer, { type: "ban", participantId: "demo-ios:u_310" })).toMatchObject({
        type: "error",
        code: "not_animator",
      });
      expect((await harness.join(created.id, lea)).reply).toMatchObject({ moderation: { banned: [] } });
    });

    it("un Co-hôte peut bannir un Spectateur", async () => {
      const { host, viewer, other } = await liveWithViewers();
      await promoteNoa(host, viewer, other);

      expect(await command(viewer, { type: "ban", participantId: "demo-ios:u_310" })).toEqual({ type: "ack", ref: "c" });

      expect(await harness.nextNotAudience(other)).toEqual({ type: "banned" });
    });

    it("personne ne bannit l'Hôte : `not_animator`", async () => {
      const { host, viewer, other } = await liveWithViewers();
      await promoteNoa(host, viewer, other);

      expect(await command(viewer, { type: "ban", participantId: "demo-ios:u_1042" })).toMatchObject({
        code: "not_animator",
      });
    });
  });
});

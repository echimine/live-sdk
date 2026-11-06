import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ServerMessage } from "../src/protocol/index.js";
import type { TestSocket } from "./fakes.js";
import { now } from "./support.js";
import { type Claims, useLiveServer } from "./live-harness.js";

const lea: Claims = { sub: "u_1042", name: "Léa", picture: "https://cdn.example/lea.jpg" };
const noa: Claims = { iss: "demo-android", sub: "u_88", name: "Noa" };

const noaOnWire = { id: "demo-android:u_88", app: "demo-android", name: "Noa" };

describe("chat du Live", () => {
  const harness = useLiveServer();

  /** Prochain message hors diffusion d'Audience (qui part dès que l'horloge passe 2 s). */
  async function nextChat(socket: TestSocket) {
    let message = await socket.next();
    while (message.type === "audience") message = await socket.next();
    return message;
  }

  /** Envoie un message, attend son `ack` puis sa diffusion à l'auteur, et rend son identifiant. */
  async function say(socket: TestSocket, text: string): Promise<string> {
    socket.send({ type: "sendMessage", ref: "say", text });
    expect(await nextChat(socket)).toEqual({ type: "ack", ref: "say" });
    const message = ServerMessage.parse(await nextChat(socket));
    if (message.type !== "chatMessage" || message.message.kind !== "text") {
      throw new Error(`chatMessage attendu, reçu ${message.type}`);
    }
    expect(message.message.text).toBe(text);
    return message.message.id;
  }

  function textsOf(reply: ServerMessage): string[] {
    if (reply.type !== "snapshot") throw new Error(`snapshot attendu, reçu ${reply.type}`);
    return reply.messages.map((message) => (message.kind === "text" ? message.text : `[${message.kind}]`));
  }

  it("un message envoyé est diffusé à tous, auteur compris, avec son auteur et son rôle", async () => {
    const created = await harness.launch(lea);
    const host = await harness.join(created.id, lea);
    const viewer = await harness.join(created.id, noa);

    viewer.socket.send({ type: "sendMessage", ref: "m1", text: "  Elles existent en 42 ?  " });

    expect(await viewer.socket.next()).toEqual({ type: "ack", ref: "m1" });
    const message = {
      type: "chatMessage",
      message: {
        id: expect.stringMatching(/^msg_/),
        kind: "text",
        author: noaOnWire,
        role: "viewer",
        text: "Elles existent en 42 ?",
        at: now.toISOString(),
      },
    };
    expect(await viewer.socket.next()).toEqual(message);
    expect(await host.socket.next()).toEqual(message);
  });

  it.each([
    ["vide", ""],
    ["fait d'espaces", "  \n\t "],
    ["fait de caractères invisibles", "\u200B\u2060\uFEFF"],
    ["de 301 caractères visibles", "a".repeat(301)],
    ["de 301 emojis composés", "👍🏽".repeat(301)],
  ])("refuse un message %s : `invalid_message`, rien n'est diffusé", async (_label, text) => {
    const created = await harness.launch(lea);
    const host = await harness.join(created.id, lea);
    const viewer = await harness.join(created.id, noa);

    viewer.socket.send({ type: "sendMessage", ref: "m1", text });

    expect(await viewer.socket.next()).toMatchObject({ type: "error", ref: "m1", code: "invalid_message" });
    await harness.sync(host.socket);
  });

  it("accepte 300 caractères visibles, même faits d'emojis composés", async () => {
    const created = await harness.launch(lea);
    const viewer = await harness.join(created.id, noa);
    const text = "👨‍👩‍👧".repeat(150) + "é".repeat(150);

    await say(viewer.socket, text);
  });

  describe("suppression d'un message", () => {
    it("un Animateur supprime un message : `messageDeleted` à tous, retiré du snapshot, même après redémarrage", async () => {
      const created = await harness.launch(lea);
      const host = await harness.join(created.id, lea);
      const viewer = await harness.join(created.id, noa);
      const kept = await say(viewer.socket, "Bonjour !");
      const spam = await say(viewer.socket, "Achetez mes followers");
      for (let i = 0; i < 2; i++) await host.socket.next(); // les deux diffusions, reçues aussi par l'Hôte

      host.socket.send({ type: "deleteMessage", ref: "d1", messageId: spam });

      expect(await host.socket.next()).toEqual({ type: "ack", ref: "d1" });
      expect(await host.socket.next()).toEqual({ type: "messageDeleted", messageId: spam });
      expect(await viewer.socket.next()).toEqual({ type: "messageDeleted", messageId: spam });
      expect(textsOf((await harness.join(created.id, { sub: "nouveau" })).reply)).toEqual(["Bonjour !"]);

      await harness.restart();
      const { reply } = await harness.join(created.id, noa);
      expect(reply).toMatchObject({ messages: [{ id: kept }] });
      expect(textsOf(reply)).toEqual(["Bonjour !"]);
    });

    it("après une suppression, le snapshot sert toujours les 50 derniers messages", async () => {
      const created = await harness.launch(lea);
      const host = await harness.join(created.id, lea);
      const ids: string[] = [];
      for (let i = 1; i <= 51; i++) {
        ids.push(await say(host.socket, `m${i}`));
        if (i % 20 === 0) {
          harness.live.clock.advance(10_000);
          await harness.sync(host.socket);
        }
      }

      host.socket.send({ type: "deleteMessage", ref: "d1", messageId: ids[50]! });
      expect(await host.socket.next()).toEqual({ type: "ack", ref: "d1" });
      await host.socket.next();
      const { reply } = await harness.join(created.id, noa);

      expect(textsOf(reply)).toEqual(Array.from({ length: 50 }, (_, i) => `m${i + 1}`));
    });

    it("un Spectateur ne peut pas supprimer : `not_animator`, rien n'est diffusé", async () => {
      const created = await harness.launch(lea);
      const host = await harness.join(created.id, lea);
      const viewer = await harness.join(created.id, noa);
      const id = await say(viewer.socket, "Bonjour !");
      await host.socket.next(); // la diffusion, reçue aussi par l'Hôte

      viewer.socket.send({ type: "deleteMessage", ref: "d1", messageId: id });

      expect(await viewer.socket.next()).toMatchObject({ type: "error", ref: "d1", code: "not_animator" });
      await harness.sync(host.socket);
    });

    it("un message inconnu, d'un autre Live ou déjà supprimé : `not_found`", async () => {
      const other = await harness.launch(noa);
      const otherHost = await harness.join(other.id, noa);
      const elsewhere = await say(otherHost.socket, "Ailleurs");
      const created = await harness.launch(lea);
      const host = await harness.join(created.id, lea);
      const mine = await say(host.socket, "Ici");
      host.socket.send({ type: "deleteMessage", ref: "d0", messageId: mine });
      expect(await host.socket.next()).toEqual({ type: "ack", ref: "d0" });
      await host.socket.next();

      for (const messageId of ["msg_inconnu", elsewhere, mine]) {
        host.socket.send({ type: "deleteMessage", ref: "d1", messageId });
        expect(await host.socket.next()).toMatchObject({ type: "error", ref: "d1", code: "not_found" });
      }
    });
  });

  describe("limite anti-spam", () => {
    it("un Spectateur : 5 messages par 10 s glissantes, puis `rate_limited` avec le délai à attendre", async () => {
      const created = await harness.launch(lea);
      const viewer = await harness.join(created.id, noa);
      for (let i = 1; i <= 5; i++) {
        await say(viewer.socket, `m${i}`);
        if (i < 5) harness.live.clock.advance(1_000);
      }

      viewer.socket.send({ type: "sendMessage", ref: "m6", text: "m6" });
      expect(await nextChat(viewer.socket)).toEqual({
        type: "error",
        ref: "m6",
        code: "rate_limited",
        message: expect.any(String),
        retryAfterMs: 6_000,
      });

      harness.live.clock.advance(5_999);
      viewer.socket.send({ type: "sendMessage", ref: "m6", text: "m6" });
      expect(await nextChat(viewer.socket)).toMatchObject({ code: "rate_limited", retryAfterMs: 1 });
      harness.live.clock.advance(1);
      await say(viewer.socket, "m6");
    });

    it("la limite suit le Participant, même s'il rouvre un socket", async () => {
      const created = await harness.launch(lea);
      const first = await harness.join(created.id, noa);
      for (let i = 1; i <= 5; i++) await say(first.socket, `m${i}`);

      const second = await harness.join(created.id, noa);
      second.socket.send({ type: "sendMessage", ref: "m6", text: "m6" });

      expect(await second.socket.next()).toMatchObject({ code: "rate_limited", retryAfterMs: 10_000 });
    });

    it("un Animateur : 20 messages par 10 s", async () => {
      const created = await harness.launch(lea);
      const host = await harness.join(created.id, lea);
      for (let i = 1; i <= 20; i++) await say(host.socket, `m${i}`);

      host.socket.send({ type: "sendMessage", ref: "m21", text: "m21" });

      expect(await host.socket.next()).toMatchObject({ code: "rate_limited", retryAfterMs: 10_000 });
    });

    it("un message dont l'écriture échoue ne compte pas dans la limite", async () => {
      const created = await harness.launch(lea);
      const first = await harness.join(created.id, noa);
      // Postgres refuse le caractère nul : l'écriture échoue et le socket est fermé.
      first.socket.send({ type: "sendMessage", ref: "nul", text: "a\u0000" });
      await first.socket.closed;

      const again = await harness.join(created.id, noa);
      for (let i = 1; i <= 5; i++) await say(again.socket, `m${i}`);
    });

    it("un message refusé ne compte pas dans la limite", async () => {
      const created = await harness.launch(lea);
      const viewer = await harness.join(created.id, noa);
      for (let i = 1; i <= 5; i++) {
        viewer.socket.send({ type: "sendMessage", ref: "vide", text: " " });
        expect(await viewer.socket.next()).toMatchObject({ code: "invalid_message" });
      }

      for (let i = 1; i <= 5; i++) await say(viewer.socket, `m${i}`);
    });
  });

  it("le snapshot sert les 50 derniers messages, du plus ancien au plus récent", async () => {
    const created = await harness.launch(lea);
    const host = await harness.join(created.id, lea);
    for (let i = 1; i <= 52; i++) {
      await say(host.socket, `m${i}`);
      // Reste sous la limite anti-spam des Animateurs (20 messages / 10 s).
      if (i % 20 === 0) {
        harness.live.clock.advance(10_000);
        await harness.sync(host.socket);
      }
    }

    const { reply } = await harness.join(created.id, noa);

    expect(textsOf(reply)).toEqual(Array.from({ length: 50 }, (_, i) => `m${i + 3}`));
  });

  it("l'historique est conservé : il survit au redémarrage du serveur", async () => {
    const created = await harness.launch(lea);
    const viewer = await harness.join(created.id, noa);
    await say(viewer.socket, "Bonjour !");

    await harness.restart();
    const { reply } = await harness.join(created.id, noa);

    expect(reply).toMatchObject({
      messages: [{ kind: "text", author: noaOnWire, role: "viewer", text: "Bonjour !", at: now.toISOString() }],
    });
  });
});

describe("journal du serveur", () => {
  const lines: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const harness = useLiveServer({ logStream });

  it("aucun texte du chat dans les logs, même quand l'écriture d'un message échoue", async () => {
    const created = await harness.launch(lea);
    const viewer = await harness.join(created.id, noa);
    lines.length = 0;

    // Postgres refuse le caractère nul : l'écriture échoue et l'erreur est journalisée.
    viewer.socket.send({ type: "sendMessage", ref: "m1", text: "secret du chat \u0000" });

    expect(await viewer.socket.closed).toEqual({ code: 1011 });
    expect(lines.join("")).toContain("erreur inattendue");
    expect(lines.join("")).not.toContain("secret du chat");
  });
});

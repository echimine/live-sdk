import { describe, expect, it } from "vitest";
import type { TestSocket } from "./fakes.js";
import { type Claims, useLiveServer } from "./live-harness.js";

const lea: Claims = { sub: "u_1042", name: "Léa" };
const noa: Claims = { iss: "demo-android", sub: "u_88", name: "Noa" };
const sam: Claims = { sub: "u_310", name: "Sam" };

const noaOnWire = { id: "demo-android:u_88", app: "demo-android", name: "Noa" };

const baskets = {
  name: "Baskets Runner X",
  price: 8999,
  currency: "EUR",
  imageUrl: "https://live.echimine.fr/v1/images/img_5d1c9a.webp",
};

describe("Produit épinglé et Achat", () => {
  const harness = useLiveServer();

  /** Envoie une commande et attend sa réponse (`ack` ou `error`). */
  async function command(socket: TestSocket, message: Record<string, unknown>) {
    socket.send({ ref: "c", ...message });
    return harness.nextNotAudience(socket);
  }

  /** Live de Léa, avec Noa en Spectateur. */
  async function liveWithViewer() {
    const created = await harness.launch(lea);
    const host = await harness.join(created.id, lea);
    const viewer = await harness.join(created.id, noa);
    return { created, host, viewer };
  }

  /** Épingle un produit depuis l'Hôte et rend le produit diffusé (avec son identifiant). */
  async function pin(host: TestSocket, viewer: TestSocket, product: Record<string, unknown> = baskets) {
    expect(await command(host, { type: "pinProduct", ...product })).toEqual({ type: "ack", ref: "c" });
    const pinned = await harness.nextNotAudience(host);
    expect(await harness.nextNotAudience(viewer)).toEqual(pinned);
    return pinned.product as { id: string };
  }

  describe("épingler", () => {
    it("l'Hôte épingle un produit : `productPinned` à tous, et il figure dans le snapshot", async () => {
      const { created, host, viewer } = await liveWithViewer();

      expect(await command(host.socket, { type: "pinProduct", ...baskets })).toEqual({ type: "ack", ref: "c" });

      const pinned = await harness.nextNotAudience(host.socket);
      expect(pinned).toEqual({ type: "productPinned", product: { id: expect.stringMatching(/^prd_/), ...baskets } });
      expect(await harness.nextNotAudience(viewer.socket)).toEqual(pinned);
      const { product } = pinned;
      expect((await harness.join(created.id, sam)).reply).toMatchObject({ pinnedProduct: product });
    });

    it("un produit sans image est accepté, et l'image reste absente du fil", async () => {
      const { host, viewer } = await liveWithViewer();

      const product = await pin(host.socket, viewer.socket, { name: "Gourde isotherme", price: 0, currency: "USD" });

      expect(product).toEqual({ id: expect.any(String), name: "Gourde isotherme", price: 0, currency: "USD" });
    });

    it("épingler un autre produit le remplace, avec un nouvel identifiant", async () => {
      const { created, host, viewer } = await liveWithViewer();
      const first = await pin(host.socket, viewer.socket);

      const second = await pin(host.socket, viewer.socket, { name: "Gourde", price: 1500, currency: "EUR" });

      expect(second.id).not.toBe(first.id);
      expect((await harness.join(created.id, sam)).reply).toMatchObject({ pinnedProduct: second });
    });

    it("un Co-hôte peut épingler", async () => {
      const { created, host, viewer } = await liveWithViewer();
      await command(viewer.socket, { type: "requestToJoin" });
      await harness.nextNotAudience(host.socket);
      await command(host.socket, { type: "acceptJoin", participantId: noaOnWire.id });
      await harness.nextNotAudience(host.socket);
      await harness.nextNotAudience(viewer.socket);

      expect(await command(viewer.socket, { type: "pinProduct", ...baskets })).toEqual({ type: "ack", ref: "c" });
      expect(await harness.nextNotAudience(host.socket)).toMatchObject({ type: "productPinned" });
      expect((await harness.join(created.id, sam)).reply).toHaveProperty("pinnedProduct");
    });

    it("un Spectateur ne peut ni épingler ni retirer : `not_animator`", async () => {
      const { viewer } = await liveWithViewer();

      expect(await command(viewer.socket, { type: "pinProduct", ...baskets })).toMatchObject({ code: "not_animator" });
      expect(await command(viewer.socket, { type: "unpinProduct" })).toMatchObject({ code: "not_animator" });
    });

    it.each([
      ["nom vide", { name: "" }],
      ["nom de plus de 80 caractères", { name: "x".repeat(81) }],
      ["prix négatif", { price: -1 }],
      ["prix au-delà de 1 000 000 centimes", { price: 1_000_001 }],
      ["prix non entier", { price: 89.99 }],
      ["devise en minuscules", { currency: "eur" }],
      ["devise hors ISO 4217", { currency: "EURO" }],
      ["image en http", { imageUrl: "http://live.echimine.fr/v1/images/img_5d1c9a.webp" }],
      ["nom absent", { name: undefined }],
    ])("produit invalide (%s) : `invalid_product`, rien n'est épinglé", async (_case, override) => {
      const { created, host } = await liveWithViewer();

      expect(await command(host.socket, { type: "pinProduct", ...baskets, ...override })).toMatchObject({
        type: "error",
        ref: "c",
        code: "invalid_product",
      });
      expect((await harness.join(created.id, sam)).reply).not.toHaveProperty("pinnedProduct");
    });

    it("un nom de 80 caractères et un prix de 1 000 000 centimes sont acceptés", async () => {
      const { host, viewer } = await liveWithViewer();

      const product = await pin(host.socket, viewer.socket, { ...baskets, name: "x".repeat(80), price: 1_000_000 });

      expect(product).toMatchObject({ name: "x".repeat(80), price: 1_000_000 });
    });
  });

  describe("retirer", () => {
    it("l'Hôte retire le produit : `productUnpinned` à tous, et il sort du snapshot", async () => {
      const { created, host, viewer } = await liveWithViewer();
      await pin(host.socket, viewer.socket);

      expect(await command(host.socket, { type: "unpinProduct" })).toEqual({ type: "ack", ref: "c" });

      expect(await harness.nextNotAudience(host.socket)).toEqual({ type: "productUnpinned" });
      expect(await harness.nextNotAudience(viewer.socket)).toEqual({ type: "productUnpinned" });
      expect((await harness.join(created.id, sam)).reply).not.toHaveProperty("pinnedProduct");
    });

    it("retirer alors que rien n'est épinglé : `ack`, sans diffusion", async () => {
      const { host, viewer } = await liveWithViewer();

      expect(await command(host.socket, { type: "unpinProduct" })).toEqual({ type: "ack", ref: "c" });

      await harness.sync(viewer.socket, { skipAudience: true });
    });
  });

  describe("Achat", () => {
    it("un Spectateur achète le Produit épinglé : `ack`, puis Annonce d'achat dans le chat de tous", async () => {
      const { created, host, viewer } = await liveWithViewer();
      const product = await pin(host.socket, viewer.socket);

      expect(await command(viewer.socket, { type: "purchase", productId: product.id })).toEqual({ type: "ack", ref: "c" });

      const announcement = {
        type: "chatMessage",
        message: {
          id: expect.stringMatching(/^msg_/),
          kind: "purchase",
          author: noaOnWire,
          role: "viewer",
          product: { id: product.id, name: baskets.name, price: baskets.price, currency: baskets.currency },
          at: "2026-11-06T18:00:00.000Z",
        },
      };
      const received = await harness.nextNotAudience(viewer.socket);
      expect(received).toEqual(announcement);
      expect(await harness.nextNotAudience(host.socket)).toEqual(received);
      // L'Annonce d'achat fait partie des derniers messages du snapshot.
      const { message } = received;
      expect((await harness.join(created.id, sam)).reply).toMatchObject({ messages: [message] });
    });

    it("le produit a changé (ou a été retiré) pendant l'achat : `product_changed`, aucune annonce", async () => {
      const { host, viewer } = await liveWithViewer();
      const first = await pin(host.socket, viewer.socket);
      await pin(host.socket, viewer.socket, { name: "Gourde", price: 1500, currency: "EUR" });

      expect(await command(viewer.socket, { type: "purchase", productId: first.id })).toMatchObject({
        code: "product_changed",
      });

      await command(host.socket, { type: "unpinProduct" });
      await harness.nextNotAudience(host.socket);
      await harness.nextNotAudience(viewer.socket);
      expect(await command(viewer.socket, { type: "purchase", productId: first.id })).toMatchObject({
        code: "product_changed",
      });
      await harness.sync(host.socket, { skipAudience: true });
    });

    it("1 Achat par seconde par Participant : `rate_limited` avec `retryAfterMs`, puis de nouveau possible", async () => {
      const { created, host, viewer } = await liveWithViewer();
      const other = await harness.join(created.id, sam);
      const product = await pin(host.socket, viewer.socket);
      await harness.nextNotAudience(other.socket);

      expect(await command(viewer.socket, { type: "purchase", productId: product.id })).toMatchObject({ type: "ack" });
      await harness.nextNotAudience(viewer.socket);
      await harness.nextNotAudience(other.socket);

      expect(await command(viewer.socket, { type: "purchase", productId: product.id })).toEqual({
        type: "error",
        ref: "c",
        code: "rate_limited",
        message: expect.any(String),
        retryAfterMs: 1000,
      });
      // Un autre Participant n'est pas concerné.
      expect(await command(other.socket, { type: "purchase", productId: product.id })).toMatchObject({ type: "ack" });

      expect(await harness.nextNotAudience(viewer.socket)).toMatchObject({ message: { author: { name: "Sam" } } });

      harness.live.clock.advance(1000);
      expect(await command(viewer.socket, { type: "purchase", productId: product.id })).toMatchObject({ type: "ack" });
    });
  });

  describe("persistance et récapitulatif", () => {
    it("après un redémarrage, le Produit épinglé et les Annonces d'achat sont toujours là", async () => {
      const { created, host, viewer } = await liveWithViewer();
      const product = await pin(host.socket, viewer.socket);
      await command(viewer.socket, { type: "purchase", productId: product.id });
      const { message } = await harness.nextNotAudience(viewer.socket);

      await harness.restart();

      const again = await harness.join(created.id, sam);
      expect(again.reply).toMatchObject({ pinnedProduct: product, messages: [message] });
    });

    it("après un redémarrage, le produit retiré reste retiré", async () => {
      const { created, host, viewer } = await liveWithViewer();
      await pin(host.socket, viewer.socket);
      await command(host.socket, { type: "unpinProduct" });

      await harness.restart();

      expect((await harness.join(created.id, sam)).reply).not.toHaveProperty("pinnedProduct");
    });

    it("le récapitulatif de fin de l'Hôte compte les Achats, même d'avant un redémarrage", async () => {
      const { created, host, viewer } = await liveWithViewer();
      const product = await pin(host.socket, viewer.socket);
      await command(viewer.socket, { type: "purchase", productId: product.id });
      await harness.nextNotAudience(viewer.socket);

      await harness.restart();
      const back = await harness.join(created.id, lea);
      const buyer = await harness.join(created.id, noa);
      expect(await command(buyer.socket, { type: "purchase", productId: product.id })).toMatchObject({ type: "ack" });
      expect(await harness.nextNotAudience(back.socket)).toMatchObject({ type: "chatMessage" });

      expect(await command(back.socket, { type: "endLive" })).toEqual({ type: "ack", ref: "c" });
      expect(await harness.nextNotAudience(back.socket)).toEqual({
        type: "liveEnded",
        reason: "endedByHost",
        summary: { purchases: 2, reactions: 0, peakAudience: 1 },
      });
    });
  });
});

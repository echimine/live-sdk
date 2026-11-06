import { describe, expect, it } from "vitest";
import type { TestSocket } from "./fakes.js";
import { type Claims, useLiveServer } from "./live-harness.js";

const lea: Claims = { sub: "u_1042", name: "Léa" };
const noa: Claims = { iss: "demo-android", sub: "u_88", name: "Noa" };
const sam: Claims = { sub: "u_310", name: "Sam" };

const noaOnWire = { id: "demo-android:u_88", app: "demo-android", name: "Noa" };

describe("Demandes de montée et Co-hôtes", () => {
  const harness = useLiveServer();

  /** Envoie une commande et attend sa réponse (`ack` ou `error`). */
  async function command(socket: TestSocket, message: Record<string, unknown>) {
    socket.send({ ref: "c", ...message });
    return socket.next();
  }

  describe("Demande de montée", () => {
    it("un Spectateur demande à monter : l'Hôte reçoit `joinRequested`, et la retrouve dans son snapshot", async () => {
      const created = await harness.launch(lea);
      const host = await harness.join(created.id, lea);
      const viewer = await harness.join(created.id, noa);

      expect(await command(viewer.socket, { type: "requestToJoin" })).toEqual({ type: "ack", ref: "c" });
      expect(await host.socket.next()).toEqual({ type: "joinRequested", participant: noaOnWire });

      // Une seule demande en attente : la redemander ne prévient pas l'Hôte une seconde fois.
      expect(await command(viewer.socket, { type: "requestToJoin" })).toEqual({ type: "ack", ref: "c" });
      await harness.sync(host.socket);

      expect((await harness.join(created.id, lea)).reply).toMatchObject({ joinRequests: [noaOnWire] });
      expect((await harness.join(created.id, sam)).reply).not.toHaveProperty("joinRequests");
    });

    it("le Spectateur annule sa demande : l'Hôte reçoit `joinRequestCancelled`", async () => {
      const created = await harness.launch(lea);
      const host = await harness.join(created.id, lea);
      const viewer = await harness.join(created.id, noa);
      await command(viewer.socket, { type: "requestToJoin" });
      await host.socket.next();

      expect(await command(viewer.socket, { type: "cancelJoinRequest" })).toEqual({ type: "ack", ref: "c" });

      expect(await host.socket.next()).toEqual({ type: "joinRequestCancelled", participantId: noaOnWire.id });
      expect((await harness.join(created.id, lea)).reply).toMatchObject({ joinRequests: [] });
    });

    it("un Spectateur qui quitte le Live retire sa demande", async () => {
      const created = await harness.launch(lea);
      const host = await harness.join(created.id, lea);
      const viewer = await harness.join(created.id, noa);
      await command(viewer.socket, { type: "requestToJoin" });
      await host.socket.next();

      viewer.socket.close();

      expect(await host.socket.next()).toEqual({ type: "joinRequestCancelled", participantId: noaOnWire.id });
    });

    it("l'Hôte ne demande pas à monter : `invalid_command`", async () => {
      const created = await harness.launch(lea);
      const host = await harness.join(created.id, lea);

      expect(await command(host.socket, { type: "requestToJoin" })).toMatchObject({ code: "invalid_command" });
    });
  });

  /** Lance un Live avec l'Hôte et Noa connectés, Noa ayant demandé à monter. */
  async function liveWithRequest() {
    const created = await harness.launch(lea);
    const host = await harness.join(created.id, lea);
    const viewer = await harness.join(created.id, noa);
    await command(viewer.socket, { type: "requestToJoin" });
    expect(await host.socket.next()).toMatchObject({ type: "joinRequested" });
    return { created, host, viewer };
  }

  describe("accepter ou refuser", () => {
    it("l'Hôte accepte : `roleChanged` à tous, publication ouverte via LiveKit sans nouveau jeton", async () => {
      const { created, host, viewer } = await liveWithRequest();
      const other = await harness.join(created.id, sam);
      const tokensBefore = harness.live.livekit.calls.filter((call) => call.op === "issueToken").length;

      expect(await command(host.socket, { type: "acceptJoin", participantId: noaOnWire.id })).toEqual({
        type: "ack",
        ref: "c",
      });

      const promoted = { type: "roleChanged", participant: noaOnWire, role: "cohost" };
      for (const socket of [host.socket, viewer.socket, other.socket]) expect(await socket.next()).toEqual(promoted);
      expect(harness.live.livekit.calls).toContainEqual({
        op: "setCanPublish",
        room: created.id,
        identity: noaOnWire.id,
        canPublish: true,
      });
      expect(harness.live.livekit.calls.filter((call) => call.op === "issueToken")).toHaveLength(tokensBefore);
    });

    it("le Co-hôte figure dans le snapshot, hors de l'Audience, et garde son rôle s'il rouvre un socket", async () => {
      const { created, host } = await liveWithRequest();
      await command(host.socket, { type: "acceptJoin", participantId: noaOnWire.id });

      const newcomer = await harness.join(created.id, sam);
      expect(newcomer.reply).toMatchObject({ cohosts: [noaOnWire], audience: { total: 1 } });

      const again = await harness.join(created.id, noa);
      expect(again.reply).toMatchObject({ role: "cohost", moderation: { shadowbanned: [], banned: [] } });
      expect(again.reply).not.toHaveProperty("joinRequests");
      expect(harness.live.livekit.calls.at(-1)).toMatchObject({ op: "issueToken", identity: noaOnWire.id, canPublish: true });
      expect((await harness.join(created.id, lea)).reply).toMatchObject({ joinRequests: [], cohosts: [noaOnWire] });
    });

    it("l'Hôte refuse : le Spectateur reçoit `joinDeclined`, la demande disparaît, personne ne monte", async () => {
      const { created, host, viewer } = await liveWithRequest();

      expect(await command(host.socket, { type: "declineJoin", participantId: noaOnWire.id })).toEqual({
        type: "ack",
        ref: "c",
      });

      expect(await viewer.socket.next()).toEqual({ type: "joinDeclined" });
      expect((await harness.join(created.id, lea)).reply).toMatchObject({ joinRequests: [], cohosts: [] });
    });

    it("6e acceptation : `cohost_limit`, la demande reste en attente", async () => {
      const created = await harness.launch(lea);
      const host = await harness.join(created.id, lea);
      const ids: string[] = [];
      for (let i = 1; i <= 6; i++) {
        const viewer = await harness.join(created.id, { sub: `v${i}`, name: `V${i}` });
        await command(viewer.socket, { type: "requestToJoin" });
        expect(await host.socket.next()).toMatchObject({ type: "joinRequested" });
        ids.push(`demo-ios:v${i}`);
      }

      for (const id of ids.slice(0, 5)) {
        expect(await command(host.socket, { type: "acceptJoin", participantId: id })).toEqual({ type: "ack", ref: "c" });
        expect(await host.socket.next()).toMatchObject({ type: "roleChanged", role: "cohost" });
      }
      expect(await command(host.socket, { type: "acceptJoin", participantId: ids[5] })).toMatchObject({
        type: "error",
        code: "cohost_limit",
      });

      const { reply } = await harness.join(created.id, lea);
      expect(reply).toMatchObject({ joinRequests: [{ id: ids[5] }] });
      expect(reply.type === "snapshot" && reply.cohosts.map((c) => c.id)).toEqual(ids.slice(0, 5));
    });

    it("seul l'Hôte accepte ou refuse : `not_host` ; sans demande en attente : `not_found`", async () => {
      const { created, host, viewer } = await liveWithRequest();
      const other = await harness.join(created.id, sam);

      for (const type of ["acceptJoin", "declineJoin"]) {
        expect(await command(other.socket, { type, participantId: noaOnWire.id })).toMatchObject({ code: "not_host" });
        expect(await command(host.socket, { type, participantId: "demo-ios:u_310" })).toMatchObject({ code: "not_found" });
      }
      await harness.sync(viewer.socket);
    });
  });

  /** Lance un Live où Noa est Co-hôte ; Sam regarde. */
  async function liveWithCohost() {
    const { created, host, viewer } = await liveWithRequest();
    const other = await harness.join(created.id, sam);
    await command(host.socket, { type: "acceptJoin", participantId: noaOnWire.id });
    for (const socket of [host.socket, viewer.socket, other.socket]) {
      expect(await socket.next()).toMatchObject({ type: "roleChanged", role: "cohost" });
    }
    return { created, host, cohost: viewer, other };
  }

  describe("redescendre", () => {
    it("le Co-hôte redescend de lui-même : `roleChanged` vers Spectateur, publication fermée", async () => {
      const { created, host, cohost, other } = await liveWithCohost();

      expect(await command(cohost.socket, { type: "leaveStage" })).toEqual({ type: "ack", ref: "c" });

      const demoted = { type: "roleChanged", participant: noaOnWire, role: "viewer" };
      for (const socket of [host.socket, cohost.socket, other.socket]) expect(await socket.next()).toEqual(demoted);
      expect(harness.live.livekit.calls).toContainEqual({
        op: "setCanPublish",
        room: created.id,
        identity: noaOnWire.id,
        canPublish: false,
      });
      expect((await harness.join(created.id, noa)).reply).toMatchObject({ role: "viewer", cohosts: [] });
    });

    it("l'Hôte retire un Co-hôte : `roleChanged` vers Spectateur, publication fermée", async () => {
      const { created, host, cohost } = await liveWithCohost();

      expect(await command(host.socket, { type: "removeCohost", participantId: noaOnWire.id })).toEqual({
        type: "ack",
        ref: "c",
      });

      expect(await cohost.socket.next()).toEqual({ type: "roleChanged", participant: noaOnWire, role: "viewer" });
      expect(harness.live.livekit.calls.at(-1)).toEqual({
        op: "setCanPublish",
        room: created.id,
        identity: noaOnWire.id,
        canPublish: false,
      });
    });

    it("refus : un Spectateur ne redescend pas, seul l'Hôte retire, et seulement un Co-hôte", async () => {
      const { host, cohost, other } = await liveWithCohost();

      expect(await command(other.socket, { type: "leaveStage" })).toMatchObject({ code: "invalid_command" });
      expect(await command(cohost.socket, { type: "removeCohost", participantId: noaOnWire.id })).toMatchObject({
        code: "not_host",
      });
      expect(await command(host.socket, { type: "removeCohost", participantId: "demo-ios:u_310" })).toMatchObject({
        code: "not_found",
      });
    });
  });

  describe("Délai de grâce du Co-hôte", () => {
    it("absent plus de 60 s, il redevient Spectateur : `roleChanged` aux autres", async () => {
      const { created, host, cohost, other } = await liveWithCohost();

      cohost.socket.close();
      await cohost.socket.closed;
      await harness.sync(host.socket);
      await harness.elapse(59_999, [host.socket, other.socket]);
      await harness.sync(host.socket, { skipAudience: true });
      harness.live.clock.advance(1);

      const demoted = { type: "roleChanged", participant: noaOnWire, role: "viewer" };
      expect(await harness.nextNotAudience(host.socket)).toEqual(demoted);
      expect(await harness.nextNotAudience(other.socket)).toEqual(demoted);
      expect((await harness.join(created.id, noa)).reply).toMatchObject({ role: "viewer", cohosts: [] });
    });

    it("revenu dans les 60 s, il reste Co-hôte", async () => {
      const { created, host, cohost } = await liveWithCohost();
      cohost.socket.close();
      await cohost.socket.closed;
      await harness.sync(host.socket);
      await harness.elapse(59_000, [host.socket]);

      const back = await harness.join(created.id, noa);
      await harness.elapse(60_000, [host.socket, back.socket]);

      expect(back.reply).toMatchObject({ role: "cohost" });
      await harness.sync(host.socket, { skipAudience: true });
      expect((await harness.join(created.id, sam)).reply).toMatchObject({ cohosts: [noaOnWire] });
    });
  });

  describe("redémarrage du serveur", () => {
    it("les Co-hôtes sont conservés, par ordre de montée ; les demandes en attente sont perdues", async () => {
      const { created, host } = await liveWithCohost();
      const viewer = await harness.join(created.id, { sub: "v1", name: "V1" });
      await command(viewer.socket, { type: "requestToJoin" });
      expect(await host.socket.next()).toMatchObject({ type: "joinRequested" });
      await command(host.socket, { type: "acceptJoin", participantId: "demo-ios:v1" });
      const other = await harness.join(created.id, { sub: "v2", name: "V2" });
      await command(other.socket, { type: "requestToJoin" });

      await harness.restart();
      const back = await harness.join(created.id, noa);
      const hostBack = await harness.join(created.id, lea);

      expect(back.reply).toMatchObject({ role: "cohost" });
      expect(hostBack.reply).toMatchObject({ joinRequests: [] });
      expect(hostBack.reply.type === "snapshot" && hostBack.reply.cohosts.map((c) => c.id)).toEqual([
        noaOnWire.id,
        "demo-ios:v1",
      ]);
    });

    it("un Co-hôte qui ne revient pas dans le Délai de grâce redevient Spectateur", async () => {
      const { created } = await liveWithCohost();

      await harness.restart();
      const host = await harness.join(created.id, lea);
      await harness.elapse(60_000, [host.socket]);

      expect(await harness.nextNotAudience(host.socket)).toEqual({ type: "roleChanged", participant: noaOnWire, role: "viewer" });
      expect((await harness.join(created.id, sam)).reply).toMatchObject({ cohosts: [] });
    });

    it("un Co-hôte redescendu le reste après le redémarrage", async () => {
      const { created, cohost } = await liveWithCohost();
      await command(cohost.socket, { type: "leaveStage" });

      await harness.restart();

      expect((await harness.join(created.id, noa)).reply).toMatchObject({ role: "viewer", cohosts: [] });
    });
  });
});

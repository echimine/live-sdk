import { describe, expect, it } from "vitest";
import { HttpError, LivesSummaryResponse } from "../src/protocol/index.js";
import type { TestSocket } from "./fakes.js";
import { type Claims, useLiveServer } from "./live-harness.js";
import { bearer, participantToken } from "./support.js";

const lea: Claims = { sub: "u_1042", name: "Léa" };
const noa: Claims = { iss: "demo-android", sub: "u_88", name: "Noa" };
const sam: Claims = { sub: "u_310", name: "Sam" };

describe("récapitulatif de fin : GET /v1/lives/{id}/summary", () => {
  const harness = useLiveServer();

  async function getSummary(liveId: string, claims: Claims) {
    return harness.live.server.inject({
      method: "GET",
      url: `/v1/lives/${liveId}/summary`,
      headers: bearer(await participantToken(claims)),
    });
  }

  function expectNotFound(response: { statusCode: number; json(): unknown }) {
    expect(response.statusCode, JSON.stringify(response.json())).toBe(404);
    expect(HttpError.parse(response.json()).error.code).toBe("not_found");
  }

  /** Envoie une commande et attend sa réponse (`ack` ou `error`). */
  async function command(socket: TestSocket, message: Record<string, unknown>) {
    socket.send({ ref: "c", ...message });
    return harness.nextNotAudience(socket);
  }

  /** L'Hôte termine son Live et reçoit `liveEnded`. */
  async function endLive(host: TestSocket) {
    expect(await command(host, { type: "endLive" })).toEqual({ type: "ack", ref: "c" });
    return harness.nextNotAudience(host);
  }

  it("un Live terminé par `endLive` : 200 pour l'Hôte, le même récapitulatif que `liveEnded`", async () => {
    const created = await harness.launch(lea);
    const host = await harness.join(created.id, lea);
    await harness.join(created.id, noa);
    await harness.join(created.id, sam);
    host.socket.send({ type: "react", emoji: "❤️" });
    await harness.sync(host.socket, { skipAudience: true });
    const ended = await endLive(host.socket);
    expect(ended).toMatchObject({ type: "liveEnded", summary: { purchases: 0, reactions: 1, peakAudience: 2 } });

    const response = await getSummary(created.id, lea);

    expect(response.statusCode).toBe(200);
    expect(LivesSummaryResponse.parse(response.json())).toEqual({ purchases: 0, reactions: 1, peakAudience: 2 });
  });

  it("404 pour un autre Participant, un Live en cours ou un Live inconnu", async () => {
    const created = await harness.launch(lea);
    const host = await harness.join(created.id, lea);
    expectNotFound(await getSummary(created.id, lea));
    await endLive(host.socket);

    expectNotFound(await getSummary(created.id, noa));
    expectNotFound(await getSummary("lv_inconnu", lea));
  });

  it("un Live terminé par Délai de grâce, Hôte absent : 200 avec l'Audience maximale atteinte", async () => {
    const created = await harness.launch(lea);
    const host = await harness.join(created.id, lea);
    const viewer = await harness.join(created.id, noa);
    const other = await harness.join(created.id, sam);
    other.socket.close();
    await harness.sync(viewer.socket, { skipAudience: true });
    host.socket.close();
    expect(await viewer.socket.next()).toEqual({ type: "hostDisconnected" });

    await harness.elapse(60_000, [viewer.socket]);
    expect(await viewer.socket.next()).toEqual({ type: "liveEnded", reason: "hostTimeout" });

    const response = await getSummary(created.id, lea);
    expect(response.statusCode).toBe(200);
    expect(LivesSummaryResponse.parse(response.json())).toEqual({ purchases: 0, reactions: 0, peakAudience: 2 });
  });

  it("l'Audience maximale survit à un redémarrage, et compte un Co-hôte qui redescend", async () => {
    const created = await harness.launch(lea);
    const host = await harness.join(created.id, lea);
    const viewer = await harness.join(created.id, noa);
    await command(viewer.socket, { type: "requestToJoin" });
    await harness.nextNotAudience(host.socket);
    await command(host.socket, { type: "acceptJoin", participantId: "demo-android:u_88" });
    await harness.nextNotAudience(host.socket);
    await harness.nextNotAudience(viewer.socket);
    // Noa à l'écran : l'Audience est à 0 ; Sam arrive : 1 ; Noa redescend : 2.
    const other = await harness.join(created.id, sam);
    expect(await command(viewer.socket, { type: "leaveStage" })).toEqual({ type: "ack", ref: "c" });
    for (const socket of [host.socket, viewer.socket, other.socket]) await harness.nextNotAudience(socket);

    await harness.restart();
    const back = await harness.join(created.id, lea);
    const ended = await endLive(back.socket);

    expect(ended).toMatchObject({ type: "liveEnded", summary: { peakAudience: 2 } });
    expect(LivesSummaryResponse.parse((await getSummary(created.id, lea)).json())).toMatchObject({ peakAudience: 2 });
  });
});

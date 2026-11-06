import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { LivesCreateResponse } from "../src/protocol/index.js";
import { bearer, participantToken, resetDatabase, startLiveServer, type LiveServer } from "./support.js";

/** Collecte les lignes de log écrites par le serveur. */
class LogSink extends Writable {
  readonly lines: string[] = [];
  override _write(chunk: Buffer, _encoding: string, done: () => void) {
    this.lines.push(...chunk.toString().split("\n").filter((line) => line !== ""));
    done();
  }
}

describe("logs du serveur commun", () => {
  let live: LiveServer | undefined;

  afterEach(async () => {
    await live?.server.close();
  });

  it("sont en JSON, sans aucun jeton ni texte du chat", async () => {
    await resetDatabase();
    const sink = new LogSink();
    live = await startLiveServer({ env: { ADMIN_TOKEN: "jeton-admin-de-test-assez-long" }, logStream: sink });
    const hostToken = await participantToken({ sub: "hote" });
    const viewerToken = await participantToken({ sub: "spectateur" });
    const forged = await participantToken({ sub: "pirate" }, "un-secret-qui-n-est-pas-celui-de-l-app");
    const chatText = "mon code de carte est 4242";

    const created = await live.server.inject({ method: "POST", url: "/v1/lives", headers: bearer(hostToken) });
    const liveId = LivesCreateResponse.parse(created.json()).live.id;
    await live.server.inject({ method: "GET", url: "/admin/state", headers: bearer("jeton-admin-de-test-assez-long") });
    const refused = await live.openSocket(liveId);
    refused.send({ type: "join", token: forged });
    await refused.closed;
    const socket = await live.openSocket(liveId);
    socket.send({ type: "join", token: viewerToken });
    await socket.next();
    socket.send({ type: "sendMessage", ref: "m1", text: chatText });
    await socket.next();
    socket.send("x".repeat(17 * 1024));
    await socket.closed;
    await live.server.close();
    live = undefined;

    expect(sink.lines.length).toBeGreaterThan(0);
    for (const line of sink.lines) expect(() => JSON.parse(line)).not.toThrow();
    const output = sink.lines.join("\n");
    for (const secret of [hostToken, viewerToken, forged, "jeton-admin-de-test-assez-long", chatText]) {
      expect(output).not.toContain(secret);
    }
    // L'abus reste diagnosticable : qui, d'où, pourquoi.
    expect(sink.lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({ participantId: "demo-ios:spectateur", reason: "trame trop grosse" }),
    );
  });
});

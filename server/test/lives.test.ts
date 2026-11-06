import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpError, LivesCreateResponse } from "../src/protocol/index.js";
import { bearer, now, participantToken, resetDatabase, startLiveServer, type LiveServer } from "./support.js";

describe("lancer un Live", () => {
  let live: LiveServer;

  beforeEach(async () => {
    await resetDatabase();
    live = await startLiveServer();
  });

  afterEach(async () => {
    await live.server.close();
  });

  async function launch(token: string, body?: object) {
    return live.server.inject({
      method: "POST",
      url: "/v1/lives",
      headers: bearer(token),
      ...(body !== undefined && { payload: body }),
    });
  }

  it("un Hôte lance un Live : la room LiveKit est créée", async () => {
    const token = await participantToken({ sub: "u_1042", name: "Léa", picture: "https://cdn.example/lea.jpg" });

    const response = await launch(token, { title: "  Unboxing des nouvelles baskets  " });

    expect(response.statusCode).toBe(201);
    const { live: created } = LivesCreateResponse.parse(response.json());
    expect(created).toMatchObject({
      title: "Unboxing des nouvelles baskets",
      host: { id: "demo-ios:u_1042", app: "demo-ios", name: "Léa", picture: "https://cdn.example/lea.jpg" },
      audience: 0,
      startedAt: now.toISOString(),
    });
    expect(live.livekit.openRooms).toEqual([created.id]);
  });

  it("relancer alors qu'un Live est en cours rend ce Live, sans créer de room", async () => {
    const token = await participantToken({ sub: "u_1042" });
    const first = LivesCreateResponse.parse((await launch(token, { title: "Premier" })).json()).live;

    const again = await launch(token, { title: "Autre titre" });

    expect(again.statusCode).toBe(200);
    expect(LivesCreateResponse.parse(again.json()).live).toEqual(first);
    expect(live.livekit.openRooms).toEqual([first.id]);
  });

  it("refuse un titre de plus de 80 caractères visibles, sans créer de room", async () => {
    const response = await launch(await participantToken(), { title: "a".repeat(81) });

    expect(response.statusCode).toBe(400);
    expect(HttpError.parse(response.json()).error.code).toBe("invalid_request");
    expect(live.livekit.calls).toEqual([]);
  });
});

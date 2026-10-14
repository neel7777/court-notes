import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "./api.mjs";
import { emptyState } from "./model.js";

test("accounts isolate journals, persist across restarts, and reject stale writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "court-notes-test-"));
  const databasePath = join(directory, "journal.sqlite");
  let api, server, base;
  async function start() {
    api = createApi(databasePath);
    server = http.createServer((req, res) =>
      api.handle(req, res, new URL(req.url, "http://localhost").pathname),
    );
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    api.close();
  }
  async function request(
    path,
    { method = "GET", body, cookie, origin = base } = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  }
  const credentials = (username) => ({
    username,
    password: username === "alice" ? "a" : "b".repeat(129),
  });
  try {
    await start();
    assert.equal(
      (
        await request("/api/register", {
          method: "POST",
          body: { username: "empty-password", password: "" },
        })
      ).status,
      400,
    );
    assert.equal((await request("/api/journal")).status, 401);
    assert.equal(
      (
        await request("/api/register", {
          method: "POST",
          origin: "https://other.example",
          body: credentials("alice"),
        })
      ).status,
      403,
    );
    const alice = await request("/api/register", {
      method: "POST",
      body: credentials("alice"),
    });
    assert.equal(alice.status, 200);
    assert.match(alice.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    assert.equal(
      (
        await request("/api/register", {
          method: "POST",
          body: credentials("alice"),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/api/login", {
          method: "POST",
          body: { ...credentials("alice"), password: "incorrect password 123" },
        })
      ).status,
      401,
    );
    const bob = await request("/api/register", {
      method: "POST",
      body: credentials("bob"),
    });
    const journal = emptyState();
    journal.myDupr = "3.75";
    journal.sessions.push({
      id: "session-1",
      name: "Open play",
      location: "Park",
      date: "2026-10-13",
      games: [],
    });
    journal.players.push({ id: "player-1", name: "Jamie", dupr: "3.5" });
    journal.sessions[0].games.push({
      id: "game-1",
      mode: "singles",
      ours: 11,
      theirs: 8,
      players: [{ name: "Jamie", dupr: "3.5" }],
      good: "Deep returns",
      improve: "Reset more often",
      notes: "Windy court",
    });
    const write = {
      method: "PUT",
      cookie: alice.cookie,
      body: { username: "alice", state: journal, revision: 0 },
    };
    assert.equal((await request("/api/journal", write)).body.revision, 1);
    assert.equal((await request("/api/journal", write)).status, 409);
    assert.equal(
      (await request("/api/journal", { ...write, cookie: bob.cookie })).status,
      409,
    );
    assert.equal(
      (await request("/api/journal", { cookie: bob.cookie })).body.state
        .sessions.length,
      0,
    );
    assert.equal(
      (
        await request("/api/journal", {
          ...write,
          body: {
            username: "alice",
            state: { version: 1, players: [null], sessions: [] },
            revision: 1,
          },
        })
      ).status,
      400,
    );
    await stop();
    await start();
    const login = await request("/api/login", {
      method: "POST",
      body: credentials("alice"),
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.state.sessions[0].name, "Open play");
    assert.deepEqual(login.body.state, journal);
    assert.equal(
      (await request("/api/journal", { cookie: alice.cookie })).body.revision,
      1,
    );
    assert.equal(
      (
        await request("/api/logout", {
          method: "POST",
          cookie: login.cookie,
          body: {},
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("/api/journal", { cookie: login.cookie })).status,
      401,
    );
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});

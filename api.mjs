import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { emptyState, validState } from "./model.js";

const deriveKey = promisify(scrypt);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const lifetime = 30 * 24 * 60 * 60;
const passwordOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

export function createApi(databasePath, { secure = false, origin } = {}) {
  if (databasePath !== ":memory:")
    mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
      salt TEXT NOT NULL, password_hash TEXT NOT NULL,
      journal TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      expires INTEGER NOT NULL
    );
  `);
  const attempts = new Map();
  let activeHashes = 0;
  const cookieName = secure ? "__Host-court_session" : "court_session";
  const cookie = (token, age = lifetime) =>
    `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? "; Secure" : ""}`;

  function reply(res, status, data, headers = {}) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    res.end(JSON.stringify(data));
  }

  async function readJson(req) {
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      throw Object.assign(new Error("Expected JSON."), { status: 415 });
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 5_000_000)
        throw Object.assign(new Error("Journal is too large."), {
          status: 413,
        });
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw Object.assign(new Error("Invalid JSON."), { status: 400 });
    }
  }

  function session(req) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!token) return null;
    return db
      .prepare(
        `SELECT users.id, users.username, users.journal, users.revision
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires > ?`,
      )
      .get(hash(token), Date.now());
  }

  async function handle(req, res, pathname) {
    try {
      if (!["GET", "POST", "PUT"].includes(req.method))
        return reply(res, 405, { error: "Method not allowed." });
      if (req.method !== "GET") {
        const expectedOrigin = origin || `http://${req.headers.host}`;
        if (
          req.headers.origin !== expectedOrigin ||
          req.headers["sec-fetch-site"] === "cross-site"
        ) {
          return reply(res, 403, { error: "Request origin is not allowed." });
        }
      }
      if (
        req.method === "POST" &&
        ["/api/register", "/api/login"].includes(pathname)
      ) {
        const address = req.socket.remoteAddress;
        const now = Date.now();
        for (const [key, value] of attempts)
          if (value.until < now) attempts.delete(key);
        const attempt = attempts.get(address) || {
          count: 0,
          until: now + 15 * 60_000,
        };
        if (++attempt.count > 20 || activeHashes >= 2)
          return reply(res, 429, {
            error: "Too many login attempts. Please try again later.",
          });
        attempts.set(address, attempt);
        const data = await readJson(req);
        const username =
          typeof data?.username === "string"
            ? data.username.trim().toLowerCase()
            : "";
        const password = data?.password;
        if (
          !/^[a-z0-9_-]{3,32}$/.test(username) ||
          typeof password !== "string" ||
          password.length === 0
        ) {
          return reply(res, 400, {
            error:
              "Use a 3–32 character username (letters, numbers, _ or -) and enter a password.",
          });
        }
        let user = db
          .prepare("SELECT * FROM users WHERE username = ?")
          .get(username);
        const salt =
          pathname === "/api/register"
            ? randomBytes(16).toString("hex")
            : user?.salt || "00000000000000000000000000000000";
        activeHashes++;
        let derived;
        try {
          derived = await deriveKey(password, salt, 64, passwordOptions);
        } finally {
          activeHashes--;
        }
        if (pathname === "/api/register") {
          try {
            db.prepare(
              "INSERT INTO users (username, salt, password_hash, journal) VALUES (?, ?, ?, ?)",
            ).run(
              username,
              salt,
              derived.toString("hex"),
              JSON.stringify(emptyState()),
            );
          } catch (error) {
            if (
              error.code?.startsWith("ERR_SQLITE") &&
              db
                .prepare("SELECT id FROM users WHERE username = ?")
                .get(username)
            ) {
              return reply(res, 409, {
                error: "That username is already taken.",
              });
            }
            throw error;
          }
          user = db
            .prepare("SELECT * FROM users WHERE username = ?")
            .get(username);
        } else if (
          !user ||
          !timingSafeEqual(derived, Buffer.from(user.password_hash, "hex"))
        ) {
          return reply(res, 401, {
            error: "Username or password is incorrect.",
          });
        }
        const token = randomBytes(32).toString("hex");
        db.prepare("DELETE FROM sessions WHERE expires <= ?").run(now);
        db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
          hash(token),
          user.id,
          now + lifetime * 1000,
        );
        return reply(
          res,
          200,
          {
            user: { username: user.username },
            state: JSON.parse(user.journal),
            revision: user.revision,
          },
          { "Set-Cookie": cookie(token) },
        );
      }
      const user = session(req);
      if (!user)
        return reply(res, 401, {
          error: "Please log in to access your journal.",
        });
      if (pathname === "/api/logout" && req.method === "POST") {
        const token = (req.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1);
        if (token)
          db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(
            hash(token),
          );
        return reply(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0) });
      }
      if (pathname === "/api/journal" && req.method === "GET") {
        return reply(res, 200, {
          user: { username: user.username },
          state: JSON.parse(user.journal),
          revision: user.revision,
        });
      }
      if (pathname === "/api/journal" && req.method === "PUT") {
        const data = await readJson(req);
        if (data?.username !== user.username)
          return reply(res, 409, {
            error:
              "The signed-in account changed in another tab. Reload before editing.",
          });
        if (!Number.isInteger(data?.revision) || !validState(data?.state))
          return reply(res, 400, { error: "Invalid journal data." });
        const result = db
          .prepare(
            "UPDATE users SET journal = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
          )
          .run(JSON.stringify(data.state), user.id, data.revision);
        if (!result.changes)
          return reply(res, 409, {
            error:
              "Your journal changed on another device. Export your changes, then reload before editing again.",
          });
        return reply(res, 200, { revision: data.revision + 1 });
      }
      return reply(res, 404, { error: "Not found." });
    } catch (error) {
      if (!error.status) console.error("API request failed:", error.message);
      if (!res.headersSent)
        reply(res, error.status || 500, {
          error: error.status
            ? error.message
            : "Server error. Please try again.",
        });
    }
  }
  return {
    handle,
    checkHealth: () => db.prepare("SELECT 1").get(),
    close: () => db.close(),
  };
}

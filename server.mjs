import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createApi } from "./api.mjs";
const root = process.cwd();
const port = Number(process.env.PORT || 5173);
const appOrigin = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL;

function openChrome(url) {
  if (process.env.OPEN_BROWSER === "0" || process.env.NODE_ENV === "production")
    return;

  let command;
  let args;

  if (process.platform === "win32") {
    const locations = [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.LOCALAPPDATA,
    ]
      .filter(Boolean)
      .map((directory) =>
        resolve(directory, "Google/Chrome/Application/chrome.exe"),
      );
    command = locations.find(existsSync) || "chrome.exe";
    args = [url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = ["-a", "Google Chrome", url];
  } else {
    command = "google-chrome";
    args = [url];
  }

  const browser = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  const reportFailure = () =>
    console.warn(`Could not open Chrome automatically. Open ${url} in Chrome.`);
  browser.on("error", reportFailure);
  browser.on("exit", (code) => {
    if (code !== null && code !== 0) reportFailure();
  });
  browser.unref();
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer between 1 and 65535.");
  process.exit(1);
}
const publicFiles = new Set([
  "/index.html",
  "/app.js",
  "/model.js",
  "/style.css",
  "/sw.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
]);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
if (
  process.env.NODE_ENV === "production" &&
  !appOrigin?.startsWith("https://")
) {
  console.error("Set APP_ORIGIN to your public HTTPS address in production.");
  process.exit(1);
}
const api = createApi(
  resolve(process.env.DATA_DIR || root, "data", "court-notes.sqlite"),
  {
    secure: process.env.NODE_ENV === "production",
    origin: appOrigin,
  },
);
const server = http
  .createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (pathname === "/healthz" && req.method === "GET") {
        api.checkHealth();
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (pathname.startsWith("/api/"))
        return await api.handle(req, res, pathname);
      if (pathname === "/") pathname = "/index.html";
      if (!publicFiles.has(pathname)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const file = resolve(root, "." + pathname);
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
        "X-Frame-Options": "DENY",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the existing server or choose another port.\n` +
          `PowerShell: $env:PORT = "5174"; npm start`,
      );
    } else {
      console.error(`Could not start Court Notes: ${error.message}`);
    }
    process.exit(1);
  })
  .listen(port, "0.0.0.0", () => {
    const url = `http://localhost:${port}`;
    console.log(`Court Notes: ${url}`);
    openChrome(url);
  });

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    server.close(() => {
      api.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}

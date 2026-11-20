import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// MAT_PORT: another port, so two checkouts can run their tests at the same time.
const PORT = Number(process.env.MAT_PORT) || 4173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

async function serve(req, res) {
  try {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = normalize(join(ROOT, pathname));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) return send(res, 403, "Forbidden");
    const info = await stat(file);
    if (!info.isFile()) return send(res, 404, "Not found");
    const body = await readFile(file);
    send(res, 200, body, TYPES[extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
}

export function startServer(port) {
  const server = createServer(serve);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "localhost", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer(PORT);
  console.log(`Serving ${ROOT} at http://localhost:${server.address().port}`);
}

#!/usr/bin/env node
/**
 * Local stand-in for the disk image CDN. Serves image/out/ with everything
 * HttpBytesDevice and a cross-origin-isolated page need:
 *   - HTTP range requests (206 + Content-Range, Accept-Ranges: bytes)
 *   - CORS (Access-Control-Allow-Origin, exposed range headers)
 *   - Cross-Origin-Resource-Policy: cross-origin (required under COEP)
 *   - long-lived immutable caching
 *
 *   npm run serve:image [-- --port 8081 --dir image/out]
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const port = Number(opt("port", 8081));
const dir = resolve(opt("dir", "image/out"));

const baseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Accept-Ranges": "bytes",
};

createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, baseHeaders).end();
    return;
  }
  const name = basename(decodeURIComponent(new URL(req.url, "http://x").pathname));
  let size;
  try {
    const st = statSync(join(dir, name));
    if (!st.isFile()) throw new Error("not a file");
    size = st.size;
  } catch {
    res.writeHead(404, baseHeaders).end("not found");
    return;
  }
  const headers = {
    ...baseHeaders,
    "Content-Type": "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range) {
    if (range[1] === "") {
      start = Math.max(0, size - Number(range[2]));
    } else {
      start = Number(range[1]);
      if (range[2] !== "") end = Math.min(end, Number(range[2]));
    }
    if (start > end || start >= size) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` }).end();
      return;
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  res.writeHead(status, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(join(dir, name), { start, end }).pipe(res);
}).listen(port, () => {
  console.log(`Serving ${dir} on http://localhost:${port}/ (range requests, CORS, CORP)`);
});

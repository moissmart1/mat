// Serve the app's Google Fonts request from the locked Fontsource packages.
// Keep the original origins and CORS so the real CSP and offline cache apply.
const fs = require("node:fs");
const path = require("node:path");

const files = new Map();
const styles = new Map();
for (const [id, weights] of [
  ["dotgothic16", [400]], ["zen-antique", [400]], ["zen-kaku-gothic-new", [500, 700, 900]],
]) {
  const { family } = require("@fontsource/" + id + "/metadata.json");
  for (const weight of weights) {
    const sheet = require.resolve("@fontsource/" + id + "/" + weight + ".css");
    const css = fs.readFileSync(sheet, "utf8").replace(/url\(\.\/files\/([\w.-]+)\)/g, (_, name) => {
      const url = "https://fonts.gstatic.com/" + name;
      files.set(url, path.join(path.dirname(sheet), "files", name));
      return "url(" + url + ")";
    });
    styles.set(family + ":" + weight, css);
  }
}

const headers = { "Access-Control-Allow-Origin": "*" };

function serveFont(route, url) {
  if (url.origin === "https://fonts.googleapis.com" && url.pathname === "/css2") {
    const sheets = url.searchParams.getAll("family").flatMap(spec => {
      const [family, weights = "400"] = spec.split(":wght@");
      return weights.split(";").map(weight => styles.get(family + ":" + weight));
    });
    if (sheets.length && sheets.every(Boolean)) {
      return route.fulfill({ contentType: "text/css", headers, body: sheets.join("\n") });
    }
  }
  const file = files.get(url.href);
  if (!file) return route.fulfill({ status: 404, headers, body: "" });
  return route.fulfill({ contentType: "font/" + path.extname(file).slice(1), headers, path: file });
}

module.exports = { serveFont };

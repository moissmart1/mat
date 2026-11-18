// Runs the click-through tests: every tests/e2e/*.e2e.cjs, or only those
// whose file name contains one of the words given (npm run e2e -- receipt).
//
// An e2e file exports an array of cases, { name, run(ctx), timezoneId?, serviceWorkers?, viewport? }
// (viewport: { width, height } in place of 390x844, for a Safari tab or a
// smaller phone; mobile: false for a computer, a mouse and no touch; timezoneId: open the case's pages in that zone instead of Asia/Tokyo;
// serviceWorkers: "allow" lets the app's service worker register, which every
// other case blocks), or one async
// function (a single case named after the file). ctx = { page, context,
// browser, newPhone() }; newPhone() opens a second page in a context of its
// own (another phone: its own storage), watched the same way.
//
// Each case gets a fresh browser context: 390x844, mobile, touch, Japan time,
// clipboard allowed, service workers blocked unless the case allows them. Every request to a host other than localhost is answered
// here (Google Fonts get a small stand-in stylesheet), so nothing needs the network.
// That holds for a case that allows the service worker too: this Playwright
// routes a service worker's own requests through context.route as well.
// A case fails on a thrown error, a console error or an uncaught page error;
// a failure prints its message and saves a screenshot.

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright-core");
const { PORT, ORIGIN } = require("./helpers.cjs");
const { takeTurn } = require("./queue.cjs");
const { parseShard, shardFiles } = require("./shard.cjs");

const ROOT = path.join(__dirname, "..", "..");
// Failure screenshots: MAT_SHOTS if set; on the owner's Mac where it has always
// been; anywhere else (a GitHub runner) under the system temp folder.
const MAC_TMP = "/private/tmp/claude-501";
const SHOTS =
  process.env.MAT_SHOTS ||
  (fs.existsSync(MAC_TMP) ? path.join(MAC_TMP, "mat-shots", "failures") : path.join(require("os").tmpdir(), "mat-shots", "failures"));
const CASE_TIMEOUT_MS = 30000;
const CLOSE_TIMEOUT_MS = 8000;

// What is on the test port: null (nothing), or the body of its front page.
function frontPage() {
  return new Promise((resolve) => {
    const req = http.get(ORIGIN + "/", (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(null);
    });
  });
}
const isThisApp = (body) => typeof body === "string" && body.includes("<title>MAT</title>");

async function startServer() {
  const already = await frontPage();
  if (already !== null) {
    // One is already running (npm run serve): use it only if it is this app.
    if (isThisApp(already)) return null;
    throw new Error("Port " + PORT + " is taken by something that is not this app. Stop it and run the tests again.");
  }
  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "serve.mjs")], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    if (isThisApp(await frontPage())) return child;
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill();
  throw new Error("The test server did not start on port " + PORT + ".");
}

const CONTEXT = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  timezoneId: "Asia/Tokyo",
  permissions: ["clipboard-read", "clipboard-write"],
  serviceWorkers: "block",
};

// What the runner answers for the Google Fonts stylesheet: a marker a test can read.
const FONT_CSS = ":root{--fonts-stand-in:1}";

async function hermetic(context) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost") return route.continue();
    // A small CORS stylesheet in place of Google's (the app asks for it with
    // crossorigin, so the service worker can keep it); no @font-face, so no
    // font files are asked for.
    if (url.hostname === "fonts.googleapis.com") {
      return route.fulfill({ status: 200, contentType: "text/css", headers: { "Access-Control-Allow-Origin": "*" }, body: FONT_CSS });
    }
    return route.fulfill({ status: 200, body: "" });
  });
}

function watch(page, problems) {
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push("console error: " + msg.text());
  });
  page.on("pageerror", (err) => problems.push("page error: " + err.message));
}

function casesOf(file) {
  const mod = require(file);
  const base = path.basename(file, ".e2e.cjs");
  if (typeof mod === "function") return [{ name: base, run: mod }];
  if (Array.isArray(mod)) return mod;
  throw new Error(base + ": export an array of { name, run } or one async function");
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error("timed out after " + ms + " ms")), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

async function runCase(browser, fileBase, c) {
  const problems = [];
  const contexts = [];
  const pages = [];
  const newPage = async () => {
    const context = await browser.newContext({
      ...CONTEXT,
      viewport: c.viewport || CONTEXT.viewport,
      // mobile: false is a computer: a mouse and a keyboard, no touch.
      ...(c.mobile === false ? { isMobile: false, hasTouch: false } : {}),
      ...(c.screen ? { screen: c.screen } : {}),
      timezoneId: c.timezoneId || CONTEXT.timezoneId,
      serviceWorkers: c.serviceWorkers || CONTEXT.serviceWorkers,
    });
    contexts.push(context);
    await hermetic(context);
    const page = await context.newPage();
    watch(page, problems);
    pages.push(page);
    return { context, page };
  };
  const first = await newPage();
  const ctx = {
    browser,
    context: first.context,
    page: first.page,
    newPhone: async () => (await newPage()).page,
  };
  let error = null;
  try {
    await withTimeout(c.run(ctx), CASE_TIMEOUT_MS);
    if (problems.length) error = new Error(problems.join("\n      "));
  } catch (e) {
    error = e;
    if (problems.length) error.message += "\n      " + problems.join("\n      ");
  }
  let shot = null;
  if (error) {
    try {
      fs.mkdirSync(SHOTS, { recursive: true });
      shot = path.join(SHOTS, (fileBase + "-" + c.name).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) + ".png");
      await withTimeout(first.page.screenshot({ path: shot }), CLOSE_TIMEOUT_MS);
    } catch {
      shot = null;
    }
  }
  // A page left mid-reload or with its clock paused can refuse to close, and
  // waiting on it held a whole run for an hour (2026-11-17). Give each close a
  // few seconds; if one will not go, say so and the run starts a fresh browser.
  let stuck = false;
  for (const context of contexts) {
    try {
      await withTimeout(context.close(), CLOSE_TIMEOUT_MS);
    } catch {
      stuck = true;
    }
  }
  return { error, shot, stuck };
}

async function main() {
  // Arguments: words (file-name filters), --shard N/M (or --shard=N/M, or MAT_SHARD=N/M), --list.
  const words = [];
  let shardText = process.env.MAT_SHARD || "";
  let listOnly = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--list") listOnly = true;
    else if (args[i] === "--shard") shardText = args[++i] === undefined ? "missing" : args[i];
    else if (args[i].startsWith("--shard=")) shardText = args[i].slice(8);
    else words.push(args[i]);
  }
  let files = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith(".e2e.cjs"))
    .filter((f) => !words.length || words.some((w) => f.includes(w)))
    .sort();
  if (shardText) {
    let shard;
    try {
      shard = parseShard(shardText);
    } catch (e) {
      console.log(e.message);
      process.exitCode = 1;
      return;
    }
    files = shardFiles(files, shard.n, shard.m);
  }
  files = files.map((f) => path.join(__dirname, f));
  if (!files.length) {
    console.log("No e2e files match " + JSON.stringify(words.join(" ")) + (shardText ? " in shard " + shardText : ""));
    process.exitCode = 1;
    return;
  }
  if (listOnly) {
    for (const f of files) console.log(path.basename(f));
    return;
  }

  // One run at a time on this computer: wait in line (tests/e2e/queue.cjs).
  const leave = await takeTurn();
  const server = await startServer();
  const launch = () => chromium.launch({ channel: "chrome", headless: true });
  let browser = await launch();
  let passed = 0;
  let failed = 0;
  // A case that fails is tried once more, alone. Passing the second time counts
  // as passed, but it is named at the end: it is unreliable and wants fixing.
  const secondTry = [];
  try {
    for (const file of files) {
      const base = path.basename(file, ".e2e.cjs");
      for (const c of casesOf(file)) {
        let { error, shot, stuck } = await runCase(browser, base, c);
        if (error && !process.env.MAT_E2E_NO_RETRY) {
          console.log("      (failed once: " + error.message.split("\n")[0] + "; trying again)");
          if (stuck) {
            withTimeout(browser.close(), CLOSE_TIMEOUT_MS).catch(() => {});
            browser = await launch();
          }
          const again = await runCase(browser, base, c);
          if (!again.error) secondTry.push(base + " > " + c.name);
          ({ error, shot, stuck } = again);
        }
        if (error) {
          failed++;
          console.log("FAIL " + base + " > " + c.name);
          console.log("      " + error.message);
          if (shot) console.log("      screenshot: " + shot);
        } else {
          passed++;
          console.log("ok   " + base + " > " + c.name);
        }
        if (stuck) {
          console.log("      (a page would not close: starting a fresh browser)");
          withTimeout(browser.close(), CLOSE_TIMEOUT_MS).catch(() => {});
          browser = await launch();
        }
      }
    }
  } finally {
    await withTimeout(browser.close(), CLOSE_TIMEOUT_MS).catch(() => {});
    if (server) server.kill();
    leave();
  }
  for (const name of secondTry) console.log("second try: " + name);
  console.log(passed + " passed, " + failed + " failed");
  if (failed) process.exitCode = 1;
}

// Leave even if a browser that would not close is still holding the process open.
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 300));

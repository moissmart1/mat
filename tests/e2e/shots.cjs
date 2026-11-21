// Keep the existing Mac screenshot folders. On Linux a normal account
// can write to the system temp directory without creating /private.
const path = require("node:path");
const { tmpdir } = require("node:os");
const root = process.platform === "darwin" ? "/private/tmp/claude-501/mat-shots" : path.join(tmpdir(), "mat-shots");
module.exports = (relative) => path.join(root, relative);

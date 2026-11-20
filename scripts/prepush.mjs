// Local pre-push hook. Feature and CI branches need a clean, scanned tree.
// Release branches require a gate receipt and matching live backend.

import { config, git, isReleaseRef, judgePush, liveStampUntil, readReceipt, stampIn } from "./release-lib.mjs";
import { scanTree, scanOutgoing } from "./scan.mjs";

const here = process.cwd();
let input = "";
for await (const chunk of process.stdin) input += chunk;

const show = (sha, path) => {
  try {
    return git(["show", sha + ":" + path], here);
  } catch {
    return "";
  }
};

for (const line of input.split("\n").filter(Boolean)) {
  const [, localSha, remoteRef, remoteSha] = line.split(" ");
  const zero = /^0+$/.test(localSha);
  if (!isReleaseRef(remoteRef)) {
    // The scan reads the files of this checkout, so they must be the commit.
    let scan = null;
    if (!zero && remoteRef.startsWith("refs/heads/")) {
      const atHead = git(["rev-parse", "HEAD"], here) === localSha;
      const clean = git(["status", "--porcelain"], here) === "";
      let found = null;
      if (atHead && clean) {
        try {
          found = scanTree(here).length || scanOutgoing(here, localSha, remoteSha);
        } catch {
          console.error("Push refused: could not scan the complete outgoing history. Check the private list and fetch the remote history.");
          process.exit(1);
        }
      }
      scan = { atHead, clean, found };
    }
    const why = judgePush({ remoteRef, localSha, scan });
    if (why) {
      console.error("\npush refused: " + why + "\n");
      process.exit(1);
    }
    continue;
  }
  const commitStamp = zero ? "" : stampIn(show(localSha, "backend/Stamp.js"));
  const why = judgePush({
    remoteRef,
    localSha,
    receipt: zero ? null : readReceipt(git(["rev-parse", localSha + "^{tree}"], here), here),
    commitStamp,
    live: commitStamp ? await liveStampUntil(config(show(localSha, "js/config.js")).apiUrl, commitStamp) : "",
  });
  if (why) {
    console.error("\npush refused: " + why + "\n");
    process.exit(1);
  }
}

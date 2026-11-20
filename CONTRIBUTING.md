# Working on MAT

The app is live and people use it. Two branches matter:

- **`main` is production.** The site is served from it. Nobody pushes to it or
  merges into it on GitHub; it changes only when the owner runs a release.
- **`dev` is where finished work waits.** Everything gets there by pull
  request, and a pull request needs the owner's approval before it can merge.

## Tickets

Work is tracked in this repository's Issues. `ready` means it is written
clearly enough to pick up; `needs-owner` waits on a decision or a step only
the owner can take; `in-progress` means someone is on it (say so in the issue
when you start); `real-phone` can only be checked on a real iPhone. Issues
are public, like the code: nothing private in them, and the details of a
security hole go to the owner directly, not into an issue. Coding agents:
read `AGENTS.md` as well.

## How a change gets to the phones

1. Branch from `dev`. Name the branch for what it does.
2. Use Node 25, the version the release runs on (on Node 22 one test file's
   timer cases are cancelled). Make the change with its tests. `npm test` runs the unit tests;
   `node tests/e2e/run.cjs <words>` runs the browser tests whose file names
   match the words (they need Google Chrome).
3. Open a pull request into `dev`. The `check` run must be green. It runs the
   unit tests, the privacy scan and the whole browser suite on GitHub, in four
   slices on a Mac runner; a browser test that fails once and passes on the
   second try fails the run too. To run one slice on your own computer, use
   `node tests/e2e/run.cjs --shard 2/4` (`--list` only prints which files it
   would run).
4. The owner reviews it. Anything that touches `backend/`, money, the planner
   sync or `js/store.js` also gets a second, independent review.
5. Once approved it merges into `dev`. That does not change the live app.
6. At the next release the owner takes `dev` into `main`: the full unit and
   browser suites run, the backend is deployed first, then the site, and the
   live app is checked. Only then is it out.

## The release gate (owner only)

`npm run gate` checks the release candidate on the owner's Mac (clean tree,
stamps, version number, the privacy scan, the unit tests), then pushes exactly
that commit to a branch of its own, `ci/release-<commit>`, and waits for the
`check` run on GitHub for that commit (about 15 minutes; it asks once a
minute, for up to 40). Every job must pass: the unit tests, the four browser
slices and `browser-all`. A slice GitHub cancelled or timed out is run once
more; a test that failed, or one that passed only on a second try, fails the
gate. The receipt it writes names the GitHub run, and `npm run ship` shows it
on its first line. The branch is removed afterwards (left on GitHub after a
failure, to look at; the next gate replaces it).

`npm run gate -- --local` runs the browser tests on the Mac instead, as the
gate did before (about 15 minutes, in the local test queue). If `gh` is not
signed in or GitHub cannot be reached, the gate stops and says so; it never
switches to the Mac by itself. The backend deploy and the live checks stay on
the Mac in `npm run ship`.

## Rules that are not negotiable

- This repository is public. No keys, tokens, spreadsheet ids, addresses,
  booking references, real tickets or anything copied from the trip's Sheet,
  in code, tests, fixtures, commit messages or pull request text. Tests use
  made-up data.
- A key never goes in a query string or a log.
- Text a person typed is shown with `textContent`, never as markup.
- The backend is ES5 in one global scope. `backend/Money.js` is generated:
  change `js/money.js` and run `npm run stamp`.
- No new Google permission (OAuth scope) in `backend/appsscript.json` without
  talking to the owner first: it can stop the live app until he re-authorises.
- Do not change `APP_VERSION`; the release sets it.

## What you cannot do, by design

Collaborators cannot push to `main` or `dev`, force-push or delete either, or
deploy the backend (it runs under the owner's Google account). A pull request
cannot be approved by its own author.

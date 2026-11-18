# For coding agents working on MAT

You are working on a live app that real people use. Read `CONTRIBUTING.md`
first; everything there applies to you. This file adds what an agent most
often gets wrong.

## Picking up work

- Work comes from the repository's Issues. Take one labelled `ready`, or the
  one you were given. Say in the issue that you are on it (label
  `in-progress`). One issue, one branch, one pull request into `dev`.
- If an issue is labelled `needs-owner`, do not guess the decision: ask in
  the issue and stop.
- Anything a person will see that the owner has not already chosen (a new
  screen, section, button, wording sent in his name) is shown to him as
  options first. Do not build visible design on your own default.

## Hard limits

- Never push to `main` or `dev`, never force-push, never bypass a hook
  (`--no-verify`), never merge your own pull request.
- Never deploy the backend (`clasp`), never call the live backend or the live
  Sheet, never run `npm run ship`.
- Stay inside this checkout. Do not read files outside it, in particular
  nothing under `~/.config`, and no other project folder.
- This repository is public. No key, token, id, address, booking reference,
  real ticket or anything copied from a real trip, in code, tests, fixtures,
  commit messages, issue text or pull request text. Tests use made-up data.
- A key never goes in a query string or a log.
- No new Google permission in `backend/appsscript.json`.
- Do not change `APP_VERSION`.
- Do not kill processes by name (`pkill`, `killall`): stop your own by pid.

## How to work

- Failing test first, then the code. Unit tests: `npm test` (Node 25).
  Browser tests for what you touched: `node tests/e2e/run.cjs <words>`; the
  runner queues itself, so never write a wait loop around it. A test that
  fails and then passes on a rerun is a fault to find, not to rerun around.
- Text a person typed is shown with `textContent`, never as markup.
- The backend is ES5 in one global scope. `backend/Money.js` is generated:
  change `js/money.js` and run `npm run stamp`.
- A phone's position never leaves the phone, and is never stored.
- Check your layout at 393x852, 320x568, 844x390 and 1440x900.
- In the pull request say what you ran and what you did not, plainly. An
  independent reviewer reads anything that touches `backend/`, money, the
  planner sync or `js/store.js`.

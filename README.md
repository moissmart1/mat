# MAT

**Copyright (c) 2026 moissmart1. All rights reserved.** This is a private application; the source is public only because the host that serves it requires that. No licence is granted to copy, adapt or reuse it, or to use it as AI training data. See [LICENSE](LICENSE).

A phone web app for three friends splitting the costs of one trip. You ring up what you paid, it prints on a shared receipt, and a slip at the bottom says who owes whom. Every change goes into History and can be undone; nothing is ever erased.

- **Front end:** plain HTML, CSS and ES modules. No build step. Served by GitHub Pages from the root of `main`.
- **Backend:** one Google Apps Script web app bound to a Google Sheet (`backend/`). The Sheet is the database.
- **Access:** each person has their own link, carrying their own key after `#k=`. The backend keeps only each key's SHA-256 (Script Property `PERSON_KEYS`), so it knows who is calling; no key is ever in this repo. See [Personal links](#personal-links) for how they are made, replaced and cancelled, and for retiring the old shared link.

The trip side: **Days** shows one ticket per trip day (its stops, the hotel for the night, a hotel card to show a taxi driver) and a stop sheet to add, change or remove stops. Settings has **Try another day**, a demo clock that shows Days as it will look on a chosen day; a reload or Stop ends it.

## Run it

```bash
npm install
npm run serve     # http://localhost:4173
npm test          # unit tests
npm run e2e       # click-through tests in a headless browser (about four minutes)
```

The click-through tests use a fake backend and never call the real one. They use port 4173, so run one at a time.

## Changing the front end

`sw.js` keeps the app's files on the phone so it opens with no signal. Its version is a hash of those files, so after changing anything under `css/`, `js/`, `index.html`, the manifest or the icons:

```bash
npm run stamp
```

`npm test` fails if you forget. Phones pick up the new version the next time the app is opened.

## Changing the backend

`backend/` is pushed with [clasp](https://github.com/google/clasp). `.clasp.json` (which names the script) is not in this repo.

```bash
clasp push -f
clasp create-deployment -i <deployment id> -d "what changed"
```

Deploy to the same deployment id every time, or the address in `js/config.js` stops matching.

First-time setup on a new Sheet: run `setup` once from the script editor (it creates the tabs and the people and the days), then `issueLinks` to make each person's link (below).

`backend/Money.js` is generated from `js/money.js` by `npm run stamp`. Do not edit it by hand; `npm test` fails if it has drifted.

### migrate

`migrate` brings an older Sheet up to date: it adds any column the code expects that a tab's header row lacks (at the end, bold, formatted as setup formats it) and creates the Claude connector's token if there is none. It never changes what is in a data row and does not move `rev`. It is safe to run twice: the second run adds nothing and answers `[]`.

`npm run ship -- --migrate` runs it with the release check's read-only key (`MAT_CHECK_KEY`). By hand, from a terminal, with a key in an environment variable (never typed into a file or a script, never in the address):

```bash
read -rs MAT_CHECK_KEY && export MAT_CHECK_KEY   # paste the check key, then Enter
curl -sL -H 'Content-Type: text/plain;charset=utf-8' \
  --data "{\"key\":\"$MAT_CHECK_KEY\",\"action\":\"migrate\"}" \
  "https://script.google.com/macros/s/<deployment id>/exec"
unset MAT_CHECK_KEY
```

It answers `{"ok":true,...,"data":{"added":[...]}}` with the columns it added, for example `["Stays.deleted_at"]`.

### locate (where things are)

`Stops`, `Stays` and `Days` each have `lat` and `lng` (numbers kept as text, empty when not known); `migrate` adds the columns. `locate` fills them in with Apps Script's own geocoder (the Maps service: no key, no Cloud project), for every stop, stay and day that has none: a stop by its `place` (a Maps link with a position in it is read without asking), else its `title` with its day's `city`; a stay by its `address_jp`, else its `name` with its `place`; a day by its `city`. At most 40 lookups a call; it answers `{"found":n,"missing":n,"more":true|false}`. Run it after `migrate`, the same way but with your own key (the check key only reads), with `"action":"locate"`, and again while `more` is true. A lookup that finds nothing leaves the cells empty and is tried again on the next call. It writes no History; phones pick the positions up on their next check. A stop's position is cleared when its place changes, and can be set in the app (the stop's Edit sheet: paste a Google Maps link); the Claude connector shows positions but cannot set them. These are places' positions only: the phone's own position never leaves the phone. (A stamp pressed in the day's place does carry a small mark, `here`, that the others can see: whether it was pressed there, never where the phone was.)

## The Claude connector

The backend is also an MCP server, so someone's Claude can read the trip and make changes in it.

- **It acts as the owner.** The one token belongs to the trip's first person (the lowest `order`): every change it makes is written as them, whatever `as=` says.
- **It can:** read the trip (`get_trip`), explain who owes whom and why (`explain_debt`), add an expense, add, change or remove stops, save or remove a stay, change a day's ticket (`set_day`), read History and undo an entry, and bring in payments from the planner sheet (`sync_payments`, below). Every change goes through the same checks as the app, is logged in History marked "(through Claude)", and can be undone.
- **It cannot:** add, read or remove ticket pictures (it sees a stop's ticket facts), stamp payments, see or change e-Transfer addresses or emails, see or set anyone's picture (`get_trip` only says `has_picture` for each person), see the trip key or its own token, copy invite links, or change who is on the trip. (Its undo works on any History entry, as Undo in the app does, except a change to someone else's picture.) Replies never contain the key, the token, an e-Transfer address or an email.
- **The link:** Settings → Claude link → Copy, shown only to the owner on their own link. The backend gives the token to no one else (not to the others' links, not to the old shared link). One token for the whole trip.
- **The token sits in the connector's address** (`?t=…`). Treat the Claude link like the invite link: whoever has it can change the plan and add expenses.
- **`as=`** in an older link no longer changes who writes are logged as (always the owner). A name that matches no one on the trip still blocks every write; with no `as=`, nothing changes.
- **Changing the token:** in the script editor, Project Settings → Script Properties, either edit `CLAUDE_TOKEN` to a new long random value, or delete it and run `migrate` (above) to make a new one. Every Claude link copied before stops working; the owner copies it again from Settings.

## Payments from a planner sheet

The app can bring in payments kept in a separate Google Sheet (the "planner"), on request: Settings → Planner payments → Fetch, or Claude's `sync_payments`. Nothing runs on a timer. The backend reads the planner; the only thing it ever writes there is a "Before we go" tick (below).

**The tab.** The planner needs a tab named `Payments`, with column names in row 1 (any order): `payment_id, date_paid, payer, description, category, vendor, booking_ref, amount, currency, amount_cad, cad_is_exact, split_between, split_type, status, include_in_split, source, added_by, notes`. `split_between` is a comma list of names; `split_type` is `equal` or `personal`.

**The rule.** Only rows whose `include_in_split` is `yes` come in, and only equal splits between people on the trip. A new payment becomes an expense (in Canadian dollars when `amount_cad` is filled, otherwise in its own yen or dollars) whose note starts with the payment's id. The two are tied by the Expenses tab's `planner_id` column, which only a pull writes and the app never shows; editing the line's note does not untie it. A line rung up by hand whose note starts with a payment id that is in the planner (for example `X7 · North Rail · ref AB12`) is tied the first time a pull sees it. A payment id has at least one letter and one digit. The planner owns a payment's title, amount, currency, payer, split and note: a later pull brings those back in line with it. The app owns the day and kind. An expense deleted in the app is never brought back, a payment taken out of the split leaves its expense alone, and nothing is ever deleted by a pull. Every change is logged in History marked "(from the planner)" and can be undone. Undoing a change the planner made (not an add) only lasts until the next pull, which sets it back: to keep a different value, change it in the planner. Undoing an add removes the line, and the planner does not bring it back. A payment that can't be brought in (or is no longer in the planner, or is carried by two lines) is skipped and counted ("1 payment needs a look in the planner."). One pull adds or changes at most 10 expenses; when more remain it says so, and the next tap brings the next 10. Only the first 300 payment rows are read.

**Setting it up,** in this order:

1. Push this backend (`clasp push -f`).
2. In the script editor, run `checkPlanner` once. Google asks for the Sheets permission (`spreadsheets`, below) for the account the web app runs as, which must be able to open the planner; the log then says no planner is linked yet.
3. Update the deployment (`clasp create-deployment -i <deployment id> ...`, above).
4. Run `migrate` (above): it adds the `planner_id` column to the Expenses tab. Until then a pull is refused with "The trip sheet needs updating first."
5. In the script editor, Project Settings → Script Properties → Add script property: name `PLANNER_ID`, value the planner's spreadsheet id (the long part of its address between `/d/` and `/edit`). The id is kept only there: never in a reply, the Log or History. (There is no action that sets it from outside: the old `linkPlanner` is gone.)
6. Run `checkPlanner` again: the log says how many payment rows and Book Now items it found, or which column is missing, and whether the Change Log is there.

**Changing or unlinking it.** In the script editor, Project Settings → Script Properties, change or delete `PLANNER_ID`. With none linked, the Settings row goes away on the next load; expenses already brought in stay.

## Before we go (bookings and prep from the planner)

The app's "Before we go" list is the planner's `Book Now` tab: bookings and prep to finish before the trip. Items are added and edited only in the planner. In the app someone can say "I'll do it" and tick an item off; a tick also marks it `Booked` in the planner.

**The planner's tabs.** `Book Now`: the header is the first row with cells named `#`, `Item`, `Book by` and `Status` (any case); `Notes` and `Booking link` are used when there. Rows above the header, rows with no `Item`, and rows whose `#` is not a whole number (a footnote line) are skipped; a `#` that appears twice keeps its first row. `Book by` is read as `2026-12-05`, `Dec 5`, `Dec 5, 2026`, `5 Dec` or a date cell (no year means the trip's year); anything else is no date. A link is kept only when it is a plain `https://` address. `Change Log`: the header is the first row with `#`, `Tab`, `Old value` and `New value`; a tick appends one row there and fills `#`, `Date / time` (Toronto time), `Agent / session`, `Tab`, `Cell(s)`, `Item`, `Old value`, `New value`, `Why`, `Proof / source` and `Verified?` where those columns exist. Every planner tab (Payments, Book Now, Change Log) is read whole, to its last column, but only its first 52 columns (A to AZ) are used: keep the columns the app needs within those. A table is as wide as its header row's last named column: anything further right (a note, a filled-down checkbox) is ignored, also when telling a blank row.

**The Todos tab** in this Sheet holds the list: `id` (the planner's `#`), `item`, `book_by`, `status` (the planner's word as last read), `note`, `link`, `claimed_by`, `ticked_by`, `ticked_at`, `planner_written` (below), `gone` (`yes` when the planner no longer lists it), plus `ticked_item` (the item's text when ticked: the tick is bound to it) and `planner_was` (the planner's status when the app wrote Booked, put back by an undo). All text. `planner_written` is one of four values: empty (nothing written: an untouched item, or a tick the planner has not taken yet, which a pull retries); `yes` (the planner took the tick: the app wrote `Booked` there); `formula` (the planner computes that Status, by a formula in the cell or one spilled into it from another cell, as a read of the cell showed; a cell that can't be read is planner trouble like any other, so the tick stays pending and is retried; the tick stays in the app only and the planner is never written for it); `undo` (the tick was undone in the app but putting the old status back in the planner has not gone through yet: the planner still holds the app's `Booked`, the row shows `planner_was` and is not done, and each pull tries the put-back again). An item is done when its status starts with "booked" or someone ticked it. Rows are never deleted. Do not edit it by hand: a pull rewrites the planner's columns.

**The three actions.**

- `syncTodos` (`{ force }`): pulls the Book Now tab, at most once in 10 minutes unless `force` is true; updates changed items, adds new ones and marks missing ones gone, at most 15 rows per pull (it answers `more: true` when rows remain, and the next pull carries on). It writes no History, except one line when it takes a tick or claim off (below). It then retries up to two ticks the planner has not taken yet or undone ticks whose old status it has not taken back yet (`planner_written` `undo`), the oldest tick first and the owed put-backs after the ticks, taking turns. It answers the list, when it last pulled, and any problems (a `#` used twice, a tick or claim taken off), each with the sheet's own `row` and `what` (a few words of the item); a planner it can't read is refused as for payments, with the stored list still in the reply. What a tick's `Booked` replaced is kept in the Script Property `TODO_WAS_<#>` from the moment it is written (under the planner lock) until the row records it, and stays there when the app can't record it (its lock busy twice): an undo and a put-back use it before the row's own, and the next pull copies it onto a row still ticked or owed its put-back and deletes it (the pull reads all of them in one `getProperties()`). The last pull's problems are kept in the Script Property `TODO_PROBLEMS` (at most 20, each message cut to 160 characters, and how many more there were); a stored answer (`stored: true`) or a refusal leaves them as they were.
- `tickTodo` (`{ id }`): saves the tick in this Sheet first (one History entry, "Mo ticked off: …", undoable). Then, best effort, it re-reads the planner and, only if that row still has the same `#` and `Item` and is not already booked, writes `Booked` into its Status cell and appends one Change Log row (if the Change Log can't be found, nothing is written; if the log row fails, the old Status is put back). It answers `planner: "written"` or `"pending"`; a pending tick stands in the app and the next pull tries again. Once written it is never written again. Undoing a written tick puts the old status back in the planner (and logs it there) when the row still says exactly `Booked` (else `planner: "kept"`); if the planner can't be written then, the app's undo still happens, the put-back is owed (`planner_written` `undo`), History says once "The planner still says Booked for this one; the app will put it back at the next fetch.", and each pull tries it again (the item meanwhile shows its old status, not done). Ticking it again while that is owed takes back the planner's `Booked` as it is, with nothing written there, once a read shows the planner still says booked; if the put-back did go through without the app recording it, `Booked` is written again as for any tick (and if the planner can't be read then, the tick takes the `Booked` on trust, as it was saved). If the planner gives an owed item's `#` to another item while that row still says `Booked`, the put-back is dropped and History says once "The planner changed “…”: the Booked the app wrote there was left as it is" (not undoable).
- `claimTodo` (`{ id, on }`): `on: true` puts the person on it (taking it from whoever had it); `on: false` hands it back, only if it is theirs. Each is a History entry ("Mo is on: …", "Mo took over: …, from Ajen", "Mo handed back: …") and can be undone. A done item can't be claimed.

`load` returns the list (`todos`, without gone items), `todosPulledAt` and the last pull's problems (`todoProblems`: `{ at, list, more }`, the empty shape before any pull); it never reads the planner. Claude's `get_trip` lists the open items and counts the done ones.

**On the phone** (the Before tab, js/views/todos.js). The list has its own tab, `Before` (出発前), a key in the bottom bar (a row of machine keys: with it, Days, Before, Ring up, Money, You, Ring up in the middle; without it, Days, Money, You, Ring up, four even keys; a lamp on the current key), with a small count of open items on it (its accessible name reads `Before we go, 18 open`). Its top bar says 出発前 Before we go and `18 open`. Under it: open items first, earliest book-by date first (undated last), each with the seal of whoever is on it, and a due line counted on the Toronto calendar (`by Sat Dec 5 · in 19 days`, `tomorrow`, `today`, or in red `was due … · 2 days late`). Tapping a row opens it: the note, `Open the booking ↗` (when there is a link), `I’ll do it` / `Take it over` / `Hand it back`, and `Tick it off`, which lands the settle slip's 済 stamp with its thud and moves the item to the folded `済 Done (n)` group, which is folded again the next time the tab is shown. The tab is in the bar always before the trip's first day, even with nothing open; from the first day on only while at least one item is open (if it goes while you are on it, you land on Days); with no planner linked, or no items, there is no tab. Days shows nothing of the list. The phone fetches the list by itself when it starts and when the Before tab is shown, if the last fetch is an hour old or more (quietly; it speaks up only when that fails twice in a row); `Fetch` at the foot of the list fetches it at once. A tick or claim is shown at once and rolled back with the usual notice when the backend refuses it or there is no signal; History lists each one with Undo.

**The permission, and why.** A tick writes to the planner, which is a different spreadsheet from this one. Google has no permission for writing one other spreadsheet: the script needs the full Sheets permission (`https://www.googleapis.com/auth/spreadsheets`, in place of `spreadsheets.readonly`). That permission lets this script read and edit **any** spreadsheet the owner's account can open, not only the planner. Only the owner can grant it, by running `checkPlanner` in the script editor. The code itself only ever writes, to the planner and nowhere else, one Status cell and one Change Log row per tick or undone tick.

**Keeping the planner safe.** A tick is bound to the item's text when it was ticked: it is written only to the row whose `#` is the item's and whose `Item` is still that text, found on a read made just before the write. If the planner puts another item under that `#`, the next pull takes the tick (and anyone's "I'll do it") off that row, never writes for it, and History says so once ("The planner changed “…”: the tick was taken off"; this line can't be undone). An undo puts back the status the planner had when the app wrote Booked, and only while the planner still says exactly `Booked`; anything else (for example `Booked - conf JR123`) is someone's later edit and is left alone (`planner: "kept"`). Nothing done through the Claude connector writes to the planner: it cannot tick an item ("Tick this one in the app.") or undo its way back to a tick ("Undo this one in the app."), though it can undo a tick: the tick comes off in the app and the put-back is left to the next pull (`planner: "pending"`). If the app cannot record a Booked it has just written, it takes it back out of the planner; if even that fails, History says the item was left marked Booked in the planner, for someone to check by hand. Planner reads and writes run under their own lock, never while the app's own lock is held; a pull retries at most two pending ticks or owed put-backs, the oldest tick first and the put-backs after the ticks, taking turns, and is complete whatever those retries do; a forced pull within 30 seconds of the last one answers the stored list without reading the planner (marked `stored: true`).

**Deploying it,** in this order (a deployment that needs a permission nobody has granted stops working for everyone):

1. Push this backend (`clasp push -f`).
2. The owner runs `checkPlanner` in the script editor and approves the Sheets permission; running it again logs the Book Now count, how many Status cells are formulas (a formula in the cell, or a value spilled into it by an array formula in another cell; if a cell can't be checked it says so instead of a count), and whether the Change Log was found. Pre-flight, before going on: the Book Now count equals the real tab; `checkPlanner` reports 0 formula Status cells (or the owner accepts that those items stay untouched: the app never writes over a formula, it records the tick in the app only, answers `planner: "kept"` and History says "The planner worked out this one’s Status itself when it was ticked, so the app left it alone." (nothing writes that row later, even if the formula is replaced by text)); and the Change Log has no blank rows (the row is added with Sheets' own append, which never overwrites a row, but a blank row inside the Change Log can take the new row: keep the log free of blank rows).
3. Update the deployment on the same deployment id (`clasp create-deployment -i <deployment id> ...`).
4. Run `migrate` (above): it adds the `Todos` tab (or its `ticked_item` and `planner_was` columns). Until then `syncTodos`, `tickTodo` and `claimTodo` are refused with "The trip sheet needs updating first."
5. Pull once: `syncTodos` with `{"force":true}` (the app's Fetch, or curl as for `migrate` with your own key).
6. Check a real write: add a test row to the planner's Book Now tab, fetch, tick it in the app, then undo the tick. Look at the planner: the row's Status should read `Booked` after the tick and its old value after the undo, and the Change Log should have exactly two new rows, directly under the last one. Then delete the test row from the planner by hand.
7. Last: publish the front end (merge to `main` / push to Pages, `APP_VERSION` 6) only after the backend's new version is live, `migrate` has run and one forced `syncTodos` has answered.

## The stamp book

A book of twelve stamps that each person presses by hand: one per trip day, and an issue stamp for the book itself. It opens from the stamp button on the Days bar (a small ring and how many stamps you have) or from the line on today's ticket ("Today's stamp is open"), as a panel like History. Nothing here is money: a press is a History line ("Mo stamped Dec 12", or "Mo stamped the book") and can be undone from History, which lifts the stamp.

**The definitions are data, not code.** The `StampDefs` tab (made by `migrate`) has one row per stamp: `id`, `date` (`YYYY-MM-DD`, or empty for the issue stamp), `name_ja`, `name_en`, `place`, `motif` (one of `lantern, books, onsen, temple, mountain, snow, lamp, tower, record, sake, plane, crest`; any other word draws the ring with no drawing), `ink` (`shu`, `matsu` or `ai`; any other is `shu`) and `shape` (`round` or `square`). Which day gets which name and drawing is typed there, never into this repo. The app draws only the stamps a person has pressed; every phone receives all twelve definitions, so the surprise is on the honour system.

**When a stamp is open** is decided in Japan time (fixed UTC+9), by the backend's `stampWindow` and the app's copy of it (`js/stampbook.js`): a day stamp from 00:00 on its date until 03:00 the next day (27 hours); the issue stamp from the start until the last day stamp closes. A press made offline is accepted when the phone's own time for it falls inside the window and it arrives within 48 hours; it is stored with the time it was pressed. The app drops a press still waiting on the phone after 48 hours. Lifting a stamp lets it be pressed again while its window is open; after that it cannot be. There is no location check.

**The `Stamps` tab** holds the presses: `id` (`<stamp id>|<name>`), `def`, `who`, `at`, `seed` (how the ink wore: the same on every phone), `gone` (`yes` when lifted). Rows are never deleted. `pressStamp` (`{ def, at, seed? }`) is not one of the Claude connector's tools and is refused through it ("Press this one in the app."). On a Sheet where `migrate` has not been run the book is simply absent: `load` answers empty lists, and the Days bar shows no stamp button.

## The ticket on a stop

A stop can carry its real ticket: pictures of the codes (a screenshot, a photo, or a PDF turned into pictures of its pages) and four facts staff ask for. Anyone of the three attaches it from the stop's Edit sheet; every phone fetches every picture whenever the app is open with signal and keeps it, so it opens with none.

**On the day ticket.** A stop with a ticket has the 券 box under its name (solid when every picture is on this phone, dashed when one still needs signal once) and, when open, 切符 Show ticket above its links (the booking link stays, quieter). Show ticket tears the stop off and holds it up on paper-white stock: the code about 300 px wide on white, seals to move between per-person codes (it opens on your own first), a PDF's pages one under another (tap to enlarge), or for a stop with facts and no picture the booking ref, large, with a sentence for staff. Put it back, Escape or a tap on the dark closes it. While it is up the screen is asked to stay on (Wake Lock; a web app cannot raise the brightness), and a new release waits to reload.

**Attaching.** The Edit sheet's Ticket part: Add pictures or a PDF (the phone's own picker), each picked picture as a thumbnail with who it is for (one file: all three; three files: the three people in order; one tap changes it) and a seat for a person, Remove for pictures already on the stop, and the four facts. The phone checks each file by its first bytes (JPEG, PNG or PDF; an SVG is refused), shrinks a picture to at most 1,500 px on its longer side and 450,000 base64 characters, and turns a PDF into pictures of at most 8 pages (saying so before Save when it has more). Save sends the stop, then each picture in turn with its progress; one refused leaves the others saved.

**Limits** (checked on the phone and again by the backend): JPEG or PNG, at most 1,500 px and 450,000 characters a picture; 8 pictures a stop; 120 in the trip; each fact at most 60 letters.

**The Sheet.** `Stops` gains `tk_ref`, `tk_name`, `tk_people`, `tk_seat` (booking ref, name on booking, people, seat or time), saved through `addStop` / `updateStop` with History and undo ("changed … : ticket"). The `Tickets` tab has one row per picture: `id`, `stop`, `who` (empty for everyone, or a person's name), `seat`, `page`, `mime`, `w`, `h`, `size` (base64 characters), `chunks`, `by`, `at`, `gone` (`yes` when removed), `planner_id` (the planner line it came from, set only by an add from the list: see Tickets from the planner's list). The `TicketData` tab holds each picture's base64 in pieces: `ticket` (the picture's id), `n` (0, 1, 2 …) and `data` (at most 45,000 characters a cell). No Drive and no new Google permission. Do not type into either tab. `migrate` adds the columns and both tabs; until it has run, `load` sends no `tickets` and the app shows nothing of this, and the ticket actions answer "The trip sheet needs updating first."

**The actions** (trip key; writes under the lock): `addTicket { ticket: { id, stop, who, seat, page, mime, w, h, data } }` checks everything (the stop is there and not removed, `who` is a person or empty, the first bytes are the type's, sizes and counts), writes the chunks, then the row (a failure in between leaves chunks no row names; the next add deletes them), and answers `{ ticket, logId }`; a resend with the same id answers the first. `ticket { id }` answers `{ id, mime, data }` (a read: no lock, no History). `removeTicket { id }` marks it gone (History, undoable; its data rows stay). `load` lists the pictures without their data and never reads `TicketData`. The Claude connector sees the four facts with each stop; it cannot add, read or remove pictures, or undo a change to one. A picture on a removed stop is left out of `load` and does not count toward the limits. A release that brings these tabs needs `npm run ship -- --migrate`; then run `npm run private` once facts are entered, so the scan knows the booking refs and names.

**Who may.** Under a person's own link a picture is that person's, whatever the phone says; the release check's read-only key may not add, remove, undo or read a picture, and its `load` leaves out booking refs and names on bookings. A refused link or Forget this phone deletes every ticket picture on the phone, unsent ones too.

**You → Ticket pictures.** `On Wi‑Fi and mobile` (the default): every phone fetches every picture in the background whenever the app is open with signal (up to about 50 MB in all). `Only when I open one`: nothing in the background; Show ticket fetches that stop's pictures when there is signal (else "Needs signal once."). Kept on the phone as `mat.tixFetch`; the row is there only once the trip has the ticket tabs.

**On the phone.** Pictures are kept in IndexedDB (`mat-tickets`). Pictures the trip no longer has (removed, on a removed stop) are deleted from it after each load. A picture waiting for signal stays there, never in `mat.queue`. In a private window (no IndexedDB) they are kept for that visit only and fetched when a stub is opened. pdf.js (`vendor/pdfjs/`: `pdfjs-dist` 4.10.38, the legacy build, Apache-2.0, its `LICENSE` beside it) is loaded only when a PDF is picked and is not in the offline shell.

## Tickets from the planner's list (auto-add)

On the owner's own phone (the trip's first person, on their own link) MAT looks at the planner's `Tickets` tab and the ticket folder by itself: when it starts and at most every 10 minutes while it is open (no timer anywhere). When the list has tickets the trip does not, You shows the notice `検札 4 new tickets from the list · Check ›`; Check opens the same review as 一括 Add tickets (sure ones in the bundle, odd ones as cards) and nothing goes in until 入鋏. Add tickets also has `Check the list now` on that phone. Nobody else's phone looks, and the backend refuses them.

- **The files** come from the newsletter desk (another script of the owner's, which can already read Drive; see its README, "The ticket shelf"). This backend never reads Drive and gains no permission: it calls the desk with `UrlFetchApp` (`script.external_request`, which it has), with a key of its own in the body. The phone gets each file's handle, name, kind, size and print, never a Drive id; a file is fetched only after the notice is opened, only for a line that needs something, one per request (at most 4,000,000 bytes, so desk and relay fit the phone's 30 seconds; a bigger one is said: add it by hand). PDFs are made into pictures on the phone, every page, as in bulk add.
- **The tie.** Each picture added from the list carries `from`, kept in the `Tickets` tab's `planner_id` column (`T007:<print>`, the line's ticket id and the file's print). `addTicket` refuses a second live picture with the same `planner_id`, page and person, under the lock ("That ticket from the list is already on this stop."), so the owner's phone and computer, or a run repeated after a lost reply, never add one twice. A picture added by hand has no tie.
- **What it asks.** A line whose file changed (same ticket id, another print) is a card: replace its pictures (the new ones in, then the old ones off; when that would pass 8 on the stop, the old ones off first), or keep the old ones. A line cancelled in the list, gone from it, or with no file any more, whose pictures are still on, is a card: take them off, or leave them. Taking off is the usual soft remove (History puts it back). A stop that already has a picture added by hand, for the same person or for everyone, gets nothing from the list (said in one 手 line). A line left out, or kept as it was, is remembered on that phone (`mat.listSkip`: ties only) and not asked about again; `Bring them back` forgets that. Per person, the limits and the stop's facts work as in bulk add.
- **The actions** (the owner's own key only; never the check key, the shared key or the Claude connector): `listTickets { force }` answers `{ rows, files, at, stored }`: the list's lines with only the columns matching needs (`ticket_id, start_date, start_time, end_date, end_time, type, title, provider, confirmation, traveler, ticket_ref, seat, holder, status`; dates as `YYYY-MM-DD` and times as `HH:MM` whatever the planner's cell format; the first of a ticket id twice; at most 300) and the desk's files. The desk is asked at most once in 10 minutes unless forced, never twice in 30 seconds (`LIST_TICKETS_AT`); in between, its last answer comes from the script cache (`stored: true`). `listTicketFile { handle }` answers `{ handle, name, mime, data }`. Neither writes to the Sheet or History. `load` has `ticketList: true` only for the owner, once the planner, the desk and the `planner_id` column are there.
- **On the phone** what the list brings (its lines, the files' names and handles, the fetched files) is held in memory only. Forget this phone and a refused key clear it, the notice and `mat.listSkip` with the rest.

**Setting it up,** in this order:

1. In this script's editor run `ticketDeskKey` once. It makes the key (64 hex characters), keeps it only in Script Properties (`TICKET_DESK_KEY`) and logs only its SHA-256. Copy the hash.
2. In the desk: Script Property `MAT_KEY_HASH` = that hash; Setting `ticket_folder_id` = the ticket folder's id; push and move its deployment to the new version (its README). Its `status` then says `ticket_folder_id: set` and `mat_key: set`.
3. Here: Script Property `TICKET_DESK_URL` = the desk's web app address (`https://script.google.com/macros/s/…/exec`). Never in this repo.
4. Release as usual with `npm run ship -- --migrate` (it adds `Tickets.planner_id`).

**Turning it off:** delete `TICKET_DESK_URL` (or `TICKET_DESK_KEY`) here, or `MAT_KEY_HASH` in the desk. The notice goes at the next load; pictures already added stay.

## You 設定

**Your picture.** In You, "Your picture" opens the phone's own picker. The phone crops the picture to a centred square, shrinks it to 128 × 128 and sends it as a small JPEG (at most 12,000 characters; one that will not fit is refused before anything is sent). It then shows inside your round seal, in place of your initials, on every seal on every phone; Change and Remove are on the same row. Each person sets only their own. Setting, changing or removing it is one History entry, which its owner can undo.

## The Sheet

- **Todos:** the "Before we go" list (above). A pull keeps it in step with the planner; do not type into it.
- **StampDefs** and **Stamps:** the stamp book (above). Type the definitions into `StampDefs`; do not type into `Stamps`.
- **People:** `name`, `initials`, `order`, `etransfer`, `simplify`, `email`, `photo`. `photo` is the person's picture as a JPEG data address, or empty for none (then the seal shows `initials`). Set it from the app, not by hand; `migrate` adds the column to an older Sheet.

- Once the trip is live, do not delete rows by hand. Deleted expenses, stops and stays and removed payments stay as rows with a date in `deleted_at` / `removed_at`; clear that cell, or use History in the app, to bring one back. To take a row out by hand, put any date in its `deleted_at` instead of deleting it.
- Text columns are stored as plain text, so a title like `=SUM(1)` or `1/2 price ramen` stays exactly as typed.
- To change someone's link: run `newLinkForPerson1` (2, 3, …) in the script editor (see [Personal links](#personal-links)).

### Typing into the Stops, Stays and Days tabs by hand

The plan can be built in the app, through Claude, or by typing into the Sheet. The app reads what it can and leaves the rest out, so type carefully:

- **Easiest:** add stops and stays through the app or Claude, and only edit them by hand.
- **A new row needs an `id`** of 8 or more letters and digits, different from every other row's (for example `stopmo0001`, `stopmo0002`, …). A row with no id is not shown at all; one with a shorter id shows but cannot be changed from the app.
- **Dates** are `YYYY-MM-DD` (`2026-12-12`), and must be one of the trip's days. A date typed any other way matches no ticket, so the stop is never shown.
- **Times** are `HH:MM`, 24-hour (`09:30`, `18:05`). `9:30` is read as `09:30`; anything else (`9.30`, `6pm`) counts as no time and the stop sorts last.
- **`travel_min`** is whole minutes, from 0 to 600.
- **Stops:** the columns that matter are `id`, `date`, `time`, `title` (required), `detail`, `getting_there`, `travel_min`, `fixed` (TRUE or FALSE), `place` (a name or a Maps link), `sign_jp`, `link` (must start with `https://`), `note`.
- **Stays:** `id`, `name` (required), `name_jp`, `address_jp`, `first_night`, `last_night` (dates), `note`, `place`, `link`.
- **Days:** one row per trip day, keyed by `date`; `city`, `title`, `line_jp`, `line_en`, `line_colour` (`#RRGGBB`), `from_jp`, `from_en`, `to_jp`, `to_en`. Do not add or delete day rows.
- **Do not change the Trip tab's `tz`** (`Asia/Tokyo`): every "today", "next" and "leave by" depends on it.
- Typing, pasting, or clearing cell values in a data row in Stops, Stays or Days advances the revision. An open phone picks it up on its next successful check. Inserting, deleting, or sorting rows does not fire the On edit trigger. Covering row deletions later would require an On change handler and a matching trigger installed by hand in the Apps Script editor. You → Last updated also refreshes the itinerary.
- **Never delete rows:** put a date in `deleted_at` instead (see above).

## Personal links

Each person opens the app from their own link, `https://<site>/#k=<their key>`. The key is 64 random hex characters; the backend keeps only its SHA-256 in the Script Property `PERSON_KEYS` (`{ "<name>": { "hash", "at" } }`, read afresh on every request, so a change takes effect on the next one) and so knows who is calling: the phone's own claim to be someone is ignored. On your own link you can change only your own e-Transfer address, Simplify and picture, and only you can take back your claim on a Before item; everything people do for each other (ringing up what someone else paid, splits, settling, ticking off) works as before. The Claude link is the owner's only (the trip's first person).

**The owner's functions,** run from the script editor (pick the function, Run, then View → Executions or the run log). No menu or dialog, no new permission.

- `issueLinks`: makes a link for everyone who has none and writes each new link **once** to that run's log (which only the script's owner can open): copy it from there and send it to that person. With the Script Property `SITE_URL` set to the app's address (`https://…/`) the log shows the whole link; otherwise it shows `#k=<key>` and says to put the address in front. Anyone who already has a link is listed as "already has a link (issued <date>)", without a key.
- `newLinkForPerson1`, `newLinkForPerson2`, … (up to 6, in the People tab's `order`): replaces that person's link; the old one stops working at once. The new one is logged once.
- `cancelLinkForPerson1`, … : that person's link stops working. Only their name is logged.
- `linksStatus`: who has a link and since when, and whether the old shared link still works. Never a key.
- `retireSharedLink`: deletes the old shared key (`TRIP_KEY`), only once everyone has a personal link; it refuses otherwise. After it only the personal links, the release check's key and the Claude link work.
- `showInvite`: prints the old shared key while it exists (and says personal links replace it); after `retireSharedLink` it says there is none.

**The shared link, until it is retired,** still opens the trip as before (the phone says who it is), except that no e-Transfer address can be changed through it ("Open your own link to change an e-Transfer address."), the Claude link is not given out, and `linkPlanner` is gone. `setup` never makes a new shared key once anyone has a personal link.

**The release check's key** (`MAT_CHECK_KEY` in the owner's private env file, never in this repo; `backend/CheckKey.js` holds only its hash) can `load`, `rev`, `history` and `migrate`, nothing else, and its `load` leaves out the e-Transfer addresses.

**On the phone.** A phone on a personal link is that person: You shows who you are, with no choice. A key the backend refuses (a cancelled or replaced link) clears the trip off the phone (the saved trip, the key, the pictures in it, every small setting) and shows the no-key screen; only that person's own unsent lines are kept, and they go out once their new link is opened (they survive any number of refusals until then). A key that comes in the address while the phone already holds another (an old Home Screen icon, an old invite link, any link someone sends) is tried for that visit only: it is kept only if the trip takes it and it is a personal key (or the phone's own key is the old shared one); refused, it is dropped and the phone stays on its own key, saying "That link didn’t work. This phone stays on the link it already had." It never clears the phone. You → Forget this phone clears everything by hand (it says first how many entries not sent yet would be lost), and also removes the app's offline copy.

**People's names.** A link belongs to a name in the People tab. Renaming, blanking or removing a person there makes their link refused at once, and their phone clears itself; run `issueLinks` to make a link for the new name (it also removes the old name's link, and `linksStatus` lists such leftovers). Emptying the People tab (not only renaming someone) makes every personal link refused and each phone clear itself; putting the rows back makes the links work again.

**If `PERSON_KEYS` is broken** (edited by hand into something that is not what `issueLinks` writes): every request answers "Something went wrong on our side. Try again.", so nobody gets in but no phone clears itself, and `linksStatus` says so. If only its punctuation is broken (a quote, brace or comma), mend the text in Script Properties: every link keeps working. Deleting or emptying it cancels every personal link: each phone then clears itself and needs a new link (`issueLinks`, then send everyone theirs). One entry that is unusable (a hash cut short) is listed by `linksStatus` as "unreadable entry"; `newLinkForPersonN` gives that person a new link. `issueLinks` changes nothing while the People tab lists nobody.

**Never roll the backend back past this version once `issueLinks` has run.** An older backend knows only the shared key: it refuses every personal key, and every phone on a personal link would clear itself. Fix forward. (`npm run ship` asks the live trip again for about 30 seconds after a deploy, since a request can still land on the old version for a moment.)

**Errors.** A request that fails on the backend answers only "Something went wrong on our side. Try again."; the detail goes to the script's executions log (`console.error`), with every key, token and id blanked.

**Cut-over, in order.**

0. Check who can edit the Sheet (Share). Anyone who can edit it can open the script editor, read Script Properties and run these functions, so personal links only keep apart people who cannot edit it.
1. Release as usual (`npm run gate`, then `npm run ship`): the backend goes first. From this moment the shared link still works for everyone, but nobody can change an e-Transfer address through it, and the Claude link row is gone for everyone (it comes back for the owner on his own link).
2. In the script editor: set the Script Property `SITE_URL` to the app's address (optional), then run `issueLinks`. Copy each link from the run log and send each person theirs, privately. Open your own on your phone.
3. After opening your own link: remove the old Home Screen icon and add it again from the app's You screen (Add to Home Screen); force-quit the app and open it again, and check You still says "This phone is". Ask the others to do the same. When each person has done that, run `linksStatus`, then `retireSharedLink`. From then on the old shared link is refused: a phone still on it clears the trip and asks for a link.
4. Copy the Claude link again from You on your own link, if you use it (the token is the same; the old link keeps working).
5. From step 2 on, never roll the backend back past this version (above): fix forward.

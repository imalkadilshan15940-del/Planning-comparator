# Weekly Apparel Production Planning Comparator

Star Garments · Central Planning

Detects when a style's Production Start Date (ST) has been pushed later while
the Delivery Date stays fixed — the schedule-compression signal that gets
missed when factories compare weekly FastReact PDFs by eye.

## ⚠️ Important: this must be run from a local web server, not opened as a file

Two browser security rules make `file://` unusable here:

1. JavaScript ES modules (`<script type="module">`) are blocked by CORS when
   loaded from `file://`.
2. The File System Access API (folder watching) only works in a "secure
   context" — `https://` or `http://localhost` — never `file://`.

**Pick one of these (all free, no build step required):**

**Option A — Python** (most Windows/Mac machines already have this)
- Windows: double-click **`run-option-a-python.bat`**
- Mac/Linux: run **`./run-option-a-python.sh`** (first time: `chmod +x run-option-a-python.sh`)
- Opens automatically at **http://localhost:8080**

**Option B — Node** (if you have Node.js installed, or don't mind installing it)
- Windows: double-click **`run-option-b-node.bat`**
- Mac/Linux: run **`./run-option-b-node.sh`** (first time: `chmod +x run-option-b-node.sh`)
- Opens automatically at **http://localhost:3000**

Either script checks whether Python/Node is installed, tells you where to get
it if not, starts the server, and opens the app in your default browser. Keep
the terminal/command window open while you use the app — closing it stops the
server.

**Option C — VS Code** (if you prefer an editor-based workflow)
Install the "Live Server" extension, right-click `index.html`, choose
"Open with Live Server".

## Deploying to GitHub Pages (hosted, not local)

Everything above is for running the app on your own computer. If you'd
rather host it as a real website instead, GitHub Pages works — it serves
over HTTPS, which is a "secure context," the same requirement `http://localhost`
satisfies for the local-server options above. No code changes are needed:
every path in this project is already relative (`css/styles.css`,
`js/app.js`, and so on, all through the JS files too), so it works
correctly regardless of which subpath GitHub Pages serves from.

**Setup:**
1. In your GitHub repo, make sure `css/`, `js/`, and `assets/` all exist
   as direct siblings of `index.html` — not nested deeper, not flattened.
   The most reliable way to get this right: delete everything in the repo
   and re-upload the entire project folder in one single commit, rather
   than adding files one at a time.
2. Repo → **Settings → Pages** → set **Source** to the branch and folder
   containing `index.html` (usually `main` / `/ (root)`).
3. GitHub gives you a URL like `https://yourusername.github.io/repo-name/`
   — that's the live app.

**Two real differences from running locally, worth knowing:**
- **Folder watching still works** — the File System Access API operates
  on your own computer regardless of where the webpage itself is hosted,
  so picking a local Planning Reports folder works the same way it does
  running locally.
- **Caching is out of your control.** The local server scripts above
  exist specifically to disable browser caching, because stale cached
  JavaScript caused real bugs earlier in this project. GitHub Pages'
  own CDN caching isn't something this app can override — after pushing
  an update, a hard refresh (Ctrl+Shift+R / Cmd+Shift+R) may be needed to
  see it, more often than with the local no-cache servers.

## Browser requirement

Chrome or Edge (any recent version). The File System Access API — the piece
that lets the app watch your Planning Reports folder — is Chromium-only.
Firefox/Safari will load the app but folder watching will not be available;
you'll see a banner in Settings if this is the case.

## First-time setup

1. Open the app (see above).
2. Go to **Settings → Connect / Re-select Folder** and pick your
   `Planning Reports/` folder.
3. Grant "View files" permission when Chrome prompts you.
4. Drop your factories' weekly FastReact PDFs into that folder. The app polls
   every few seconds (configurable in Settings) and ingests each new PDF
   automatically — no manual import step.
5. Check the **Reports** page first — it shows every ingested PDF with a
   status badge (Critical / Changed / Unchanged / Baseline), so with a batch
   of several factories' files you can see at a glance which ones need
   attention before opening any of them. A **Factory filter** narrows the
   list to one factory at a time.
6. **Changed Styles** is the main working screen. Matching happens at
   **Style No + Tracking No + Line**. Every one is compared against a
   baseline in its own prior history for its factory — the **same
   lookback setting configured on the Reports page** (immediate previous
   by default, N reports back, or All), so the counts here always match
   what Reports shows for the same document. The **Source PDF** bar at the
   top shows exactly which document(s) the current results are based on.
   Arriving via a **Reports → Open →** link locks the view to that one
   specific report; otherwise it shows the latest per factory, filterable
   and re-groupable (**Line / Style / Factory**). Columns show ST / FI /
   Delivery / Plan Qty / **CHE. DAYS-PSD** *(Movement Days-PSD)* /
   **MOVEMENT** *(Style Movement)* / **STATUS-PSD** / **Wash Type** /
   **GAP OF FI & DEL** / **STATUS-DEL** directly, plus every print date the
   style has appeared in — all columns (including Acc, Tracking No,
   Similar Body, Garment Type, PRD DYS, Avg Effi, TGT CUT, **TRG/H**) can
   be shown or hidden via **Columns ▾**. Every column can also be
   **reordered by dragging its header**; both the visibility and the order
   you choose are remembered across reloads. A **Comments** column lets you
   click the 💬 icon to see or add a comment — one shared history per
   style, visible from anywhere (see **Comments** below). Click any row to
   expand a **Production Timeline (Gantt-style) chart**: one row per FR
   printed date, plotted on a real calendar — a green bar for the
   Production period (ST → FI), and Delivery Date shown as a short
   vertical line at its own calendar position rather than a bar connecting
   to FI, since Delivery sometimes lands before Finish (an advanced
   Delivery meeting a pushed-back FI) — a plain marker represents that
   correctly with no special handling needed. Hover any row for the full
   breakdown; the Y-axis (printed dates) and calendar header both stay
   fixed while scrolling. When viewing
   exactly one report (narrowed by factory, or opened directly from Reports), a **Save to
   History** button freezes the current comparison as a permanent record —
   see **Changed Style History** below.
7. Watch the **Qty Shift** badge on a changed style: **Full Shift** means
   the whole order's date moved before any production happened (Plan Qty
   stayed about the same); **Balance Shift** means only the leftover
   quantity was rescheduled — some units were already completed under the
   old date and the factory fell short of target on the rest.
8. Use the **⟳ Fetch Documents** button (top of the sidebar) any time you
   want to check the folder right now instead of waiting for the automatic
   poll — it shows a loading screen while it works.
9. Use **All Styles** to browse every detail record from every ingested PDF
   in one continuous list (no pagination) — not just what changed. Sort by
   clicking any column header, filter by factory or a specific report,
   search, show/hide columns, drag a column's edge to resize it, and export
   the filtered set to CSV. Both All Styles and Changed Styles have a
   **Columns ▾** toggle for fields hidden by default: Acc, Similar Body,
   Garment Type, PRD DYS, Avg Effi, TGT CUT, and TGT — all extracted from
   the PDF but kept out of the default view to avoid clutter.
10. Use the **zoom bar** at the bottom of the screen to scale the whole
    interface up or down if you want to see more rows at once, or make text
    larger — it remembers your preference.

## Each new browser session

Folder access must be re-granted once per session (a Chrome security
requirement, not a bug) — click **Settings → Re-grant Permission**, one
click, no need to re-pick the folder.

## Dates sort oldest → newest everywhere

Trend charts, Report History, and the Reports list all read left-to-right /
top-to-bottom as **oldest first**. An earlier version had a real bug here —
printed dates were being sorted as plain text ("12/1/2026" sorted before
"7/2/2026" because "1" < "7" alphabetically), which also silently broke
which report counted as "latest" on the Dashboard. All date ordering now
goes through `js/shared/dateUtils.js` instead of comparing raw strings.

## Reset old data after updating the parser

**Current mechanism:** the PDF-to-JSON cache stores which version of the
parsing logic produced each cached file. If that logic is later updated —
a bug fix, for example — a cache written by the older version is
automatically detected as stale on its next read and silently re-parsed,
even though the source PDF itself hasn't changed. This should mean you
don't need to manually intervene after most fixes.

If you want certainty rather than relying on that automatic check, or want
to force a full re-parse without touching your ingested report history,
**Reports → Clear PDF Cache** deletes every cached file on disk directly.
**Settings → Reset all stored data** also clears this cache automatically
as part of a full reset, alongside the database — a reset is meant to mean
a genuinely clean slate, not leave stale cache files sitting on disk that
the version check might not have anticipated every possible case for.

**Important for older updates specifically:** the matching level changed
from Style+Line to **Style+Tracking+Line**, and STATUS-PSD replaced the
old Critical/Changed/Unchanged system entirely. Records ingested before
this change were aggregated and compared under the old rules — go to
**Settings → Reset all stored data** and re-ingest fresh, or Changed
Styles / All Styles may show inconsistent or stale results until you do.

If you ingested PDFs before the grand-total-row fix, those old records are
still sitting in your browser's storage. All Styles now filters out
tracking-number-less rows defensively at display time regardless of when
they were ingested, so the grand-total row itself won't show up anymore —
but Plan Qty totals and Qty Shift classification were computed and stored
once, at ingestion time, for those older reports, so they may still be
inflated from double-counting. A full reset (above) resolves this too.

## Search modes, column filters, and table improvements

- **Search** (Style/Tracking on All Styles &amp; Changed Styles; filename on
  Reports &amp; Changed Style History) supports two modes: plain text is a
  **partial** match (`ABC123` finds `ABC123`, `ABC123-A`, `ABC123-R1`, …); a
  trailing **`%`** makes it an **exact** match (`ABC123%` finds only
  `ABC123` — not `ABC123-A`, `ABC123-B`, or `ABC12345`).
- Search text and dropdown filters reset to empty every time you open a
  page — they never silently keep filtering from a previous visit while
  the search box looks empty (a real bug in an earlier version, now fixed).
  Column widths, column order, sort, and group-by are the opposite: those
  **do** persist, since they're display preferences, not filters.
- **Per-column filters**: every table has a filter row under its header —
  text (partial/exact, same `%` rule as search), number range, or date
  range depending on the column — all combinable with each other and with
  the main search box. **Clear Filters** resets them all at once.
- **Grid lines** are visible on every table cell. **Column resizing** has
  no meaningful ceiling — the table itself grows past its frame when a
  column is widened (an earlier version's `width:100%` silently capped the
  whole table regardless of resize, squeezing other columns instead of
  actually growing — fixed to `min-width:100%`). **Column reordering**
  (drag a header, not its resize handle) and both width and order persist
  across reloads on All Styles and Changed Styles.
- A **loading indicator** appears during page navigation, file uploads,
  and other slower operations — with a short built-in delay so instant
  operations don't cause an annoying flash.
- **Reports** are grouped into Factory sections, in addition to the
  existing Factory filter dropdown.
- **Settings → Reset Delivery Date** removes every uploaded correction and
  restores every style's original PDF-extracted Delivery Date in one click.

## Comments

One unified comment history per style, matched by **Style No + Tracking No
+ Line** (case/spacing-insensitive) — not by report, and not by which
screen it was added from. **All Styles**, **Changed Styles**, and an
opened **Changed Style History** record all read and write the exact same
history: a comment added on any one of them automatically shows up on the
other two, and on every future report for that same style, regardless of
whether the PDF itself changes. Nothing is ever overwritten or lost —
every comment is permanently appended.

Shown as a 💬 icon in the Comments column — a blue **💬 N** pill means N
comments already exist, a faded 💬 means there are none yet, so the
presence of comments is visible without opening anything. Click it to see
the complete dated history and add a new one.

**Storage**: the browser's own database is the primary, authoritative
store the UI actually reads from — fast, always available, no setup.
Additionally, every style's comment list is written out as its own JSON
file into a **`Comments`** subfolder inside your connected project
folder, so the data durably exists on disk, not only inside the browser's
storage. If that folder lives inside OneDrive, SharePoint Sync, Dropbox,
Google Drive Desktop, or a shared network path, those files travel along
wherever your OS or sync client already sends that folder — this app
never talks to any cloud API directly. On startup, anything found in that
folder but missing from the browser's own copy (e.g. added on another
machine) is imported automatically, matched by each individual comment's
own identifier so nothing is ever duplicated.

## Delivery Date corrections

If another department maintains a separate report with the correct Delivery
Date (the PDF's own value is sometimes wrong), you can correct it without
touching anything else the PDF extracted.

**File structure** (matches a "Style Common Information"-style export):
document date in cell **B3**, header labels at **row 5**, data from **row 6**
onward. Which column letter holds which field is configured in
**Settings → Delivery Date Corrections** (defaults: Style Number `B`,
Tracking Number `C`, Factory `G`, Line No `H`, Delivery Date `L`) — reading
is purely positional by letter, so a re-ordered export of the same report
is a Settings change, not a code change.

1. **Settings → Delivery Date Corrections** — set the column letters to
   match your file (or leave the defaults), download the template (Excel or
   CSV) to see the expected layout, fill it in from the other department's
   report, and upload it.
2. Choose **Merge** (updates matching rows, keeps everything else you've
   already uploaded) or **Replace all** (wipes the table and loads only this
   file) each time you upload.
3. **Factory and Line are combined** into a single value in the same format
   the planning PDF itself uses (e.g. `KGG` + `2` → `KGG 02` — space
   separator, 2-digit zero-padded line number), since that's the value
   compared directly against the PDF's own factory/line field.
4. Matching is always keyed on **Style Number**, plus whichever of
   **Tracking Number** / **Factory+Line** you enable — since Delivery Date
   is confirmed uniform across every record under one Style+Tracking+Line,
   a match applies the corrected date to all of them.
5. **Matching ignores case and extra whitespace** on both sides — leading/
   trailing spaces are trimmed, runs of internal spaces collapse to one,
   and comparison is case-insensitive — so `" abc123 "`, `"ABC123"`, and
   `"Abc123"` all match as the same value. **Dates are compared by actual
   value**, not by how they were formatted in the source file — `7/2/2026`,
   `2-Jul-2026`, and `2026-07-02` are all recognized as the same date.
   *(One caveat worth knowing: a bare `M/D/YYYY`-style date is inherently
   ambiguous between month-first and day-first — this parser assumes
   month-first, matching every other date in this app; if your source
   files use day-first dates in that exact slash format specifically, say
   so and it's a one-line fix.)*
6. This re-applies automatically on every **Fetch Documents** click and
   every time you open the app — so uploading a new corrections file (or
   changing which fields are used to match) takes effect immediately across
   every report already ingested, not just new ones.
7. **Delivery Date from the PDF is never replaced or altered** — it always
   shows exactly what the report itself said. A correction that matches
   instead appears in its own separate column, **2nd Del**, shown on All
   Styles, Changed Styles, and Changed Style History alike. 2nd Del never
   shows blank — a style with no correction of its own shows its original
   PDF date there too, in orange (not revised); a style with a genuine
   correction shows it in green. This keeps both values visible side by
   side rather than one silently overwriting the other.
8. Any style that fails to match shows up in a popup after the run, with a
   button to export the full failed list as CSV. Nothing is ever blocked —
   an unmatched style just falls back to its original date and gets flagged.

## Loading DEL / 2nd DEL — which delivery date drives the calculations

A single switch, shown identically on both All Styles and Changed Styles
(changing it on one changes the other too — it's one shared setting, not
two independent ones), controls which delivery date **STATUS-PSD**,
**STATUS-DEL**, **GAP OF FI & DEL**, and **Movement** are actually
calculated against:

- **Loading DEL** (default) — calculations use the original PDF delivery
  date, exactly as before this feature existed.
- **2nd DEL** — calculations use the uploaded correction instead. A style
  with no correction of its own falls back to its original delivery date
  for its own calculation, rather than having nothing to calculate
  against.

Whichever mode is active, an indicator reads **"Calculation Based On:
Loading DEL"** or **"Calculation Based On: 2nd DEL"** right next to the
switch, and every affected column refreshes immediately.

Switching to 2nd DEL when no delivery correction file has ever been
uploaded shows a warning and the switch stays on Loading DEL — there's
nothing to calculate against otherwise.

**The Production Timeline chart is unaffected by this switch** — it
always shows both delivery dates at once, as two separate colored
vertical lines (blue for the original, green for 2nd DEL), specifically
so the two can be visually compared regardless of which one the tables
are currently calculating against.

## Typography, zoom, and wide tables

- **Settings → Typography** lets you set the font family and size
  separately for page titles, table headers, sidebar names, and row data.
- The **zoom bar** at the bottom scales the sidebar and content together as
  one consistent unit (like a browser's own zoom), which avoids the layout
  overflow issues that scaling just the content area can cause. Defaults to
  85%; adjustable any time, and remembers your preference.
- Wide tables (many columns) scroll horizontally, but **the scrollbar itself
  lives in the fixed bottom bar next to the zoom slider**, not inside each
  table — drag it (or click anywhere on its track) to scroll every visible
  table in sync, and it stays reachable regardless of how tall the table is
  or how far down the page you've scrolled. Trackpad/shift-wheel scrolling
  directly on a table still works exactly as before; only the native
  scrollbar is hidden, since the relocated control is the intended way to
  see and control position. The control automatically appears only when a
  table is actually wider than its frame, and re-binds itself on every
  filter/sort/reorder without any page needing to remember to ask it to.
- **Column widths are freely resizable** by dragging a column's edge, with
  no artificial minimum or maximum beyond what's needed to keep the drag
  handle grabbable — and the width you set is remembered even as you search,
  filter, or sort (an earlier version lost this on every re-render).
- **Columns can be reordered** by dragging a header (not its resize handle)
  and dropping it on another column — on All Styles and Changed Styles both.
  The order you choose is remembered across reloads; a hidden column stays
  in its existing relative position and simply reappears there if you show
  it again later, rather than jumping to the end.
- Every printed date, everywhere in the system, displays as **M/D/YY**
  (e.g. `7/2/26`) — this is a display-only format; the underlying stored
  date (which needs a 4-digit year to sort correctly across year
  boundaries) is untouched.
- The Star Garments logo sits at the bottom-left of the sidebar. The
  **Guide & Features** link above it explains every page and exactly what
  the Status and Qty Shift badges mean.

## If the app ever seems stuck loading, or a page looks like an old version

The launcher scripts serve the app with caching disabled, so this shouldn't
happen going forward — but if it ever does (e.g. you served the folder a
different way): stop the server, hard-refresh the browser (Ctrl+Shift+R /
Cmd+Shift+R), and make sure you're running the latest extracted copy of this
folder rather than an old one sitting alongside it. If you see a "does not
provide an export" error in the console specifically, an old server process
is almost always still running on the same port in the background — close
it (Task Manager on Windows, `lsof -i :8080` + `kill` on Mac/Linux) before
starting the new one.

## Split production runs

If the same Style+Tracking+Line appears more than once in a report with a
real gap between them — one block finishes, and the next one's Start date
isn't the same day or the very next day — each is now kept as its own
separate record. Start/Finish reflect that one run's actual dates, never a
min/max span stretched across the gap in between. A same-day or next-day
changeover is still treated as one continuous run, not split.

Detection is based purely on date continuity, **not** on Cont/MRP number
or where records happen to sit in the PDF — Cont/MRP can repeat across
genuinely separate runs, so it's never consulted for this at all. All
records for a given Style+Tracking+Line are collected regardless of
position, sorted by Start date, and only then checked for gaps.

This applies at **both** stages of the pipeline: when the PDF's raw rows
are first grouped into Cont/MRP-level records, and again when those are
rolled up to Style+Tracking+Line level. The first stage matters just as
much as the second — two rows sharing the same Cont/MRP number, but with
a real date gap between them, are kept separate there too, rather than
being merged before the run-splitting logic downstream ever gets a chance
to see them as distinct.

**Settings → Split Production Runs** controls how each run gets
identified: the default **system number** (1st run, 2nd run, ...) needs
no changes to your source file and works today, using the date-gap rule
above. **Lot Number** is a future-ready option for once your report
format includes that column — once it does, matching lot numbers become
a direct, unambiguous grouping key (overriding the date-gap rule
entirely, so records with the same lot stay together even across a real
gap); until the column exists there's nothing there to read, so it
silently falls back to the date-gap rule rather than breaking anything.

**On screen**, this only ever shows up as a visible marker when a style
genuinely has more than one run — a style with just one run always
displays its plain Style Number, no marker at all. Its first run also
stays plain; only the 2nd run onward gets a suffix: `LN1234`, then
`LN1234(J)`, then `LN1234(J1)`, `LN1234(J2)`, and so on. This is purely a
display marker — Comments and Delivery Date corrections still match on
the plain Style Number underneath, so they apply the same way to every
run of a style regardless of which one you're looking at.

Both the search box and the Style No column filter (on All Styles,
Changed Styles, and Changed Style History) understand this suffix —
searching `LN1234` still finds every run of that style as before, while
searching `LN1234(J)` finds only that specific jump run.

Week-to-week comparison matches runs by position — a report's 1st run
compares against the prior report's 1st run, its 2nd against the prior
2nd, and so on. If the number of runs for a style changes between weeks,
runs beyond what existed previously show as new/baseline rather than
being compared against an unrelated prior run — there's no universally
"correct" way to match runs across weeks when the count itself changes,
so this is a deliberate, predictable rule rather than a guess.

**Comments and Delivery Date corrections are unaffected** — both still
match at the style level (Style+Tracking+Line), not per-run, since a
comment or a delivery correction for a style applies the same way
regardless of which of its production runs you're looking at.

## How matching works

- Matching and calculation happen at **Style No + Tracking No + Line**
  level — not the raw Cont/MRP detail rows the PDF prints, and not just
  Style No alone. A style with three different Tracking Numbers appears as
  three separate, independently-tracked rows.
- Every Style+Tracking+Line is compared against its own **most recent
  prior appearance across the full ingested history** for its factory —
  not just the single immediately-previous report. A change from a few
  weeks back that's still in effect is caught even if last week happened
  to look unchanged, and one that skips a week is still compared correctly
  against its true last-known values.
- The **Reports** page controls how far back that comparison baseline
  goes: N previous reports, or **every** previous report ("All" — uses the
  very first one ever ingested). This is a **global** setting — Dashboard,
  Changed Styles, and All Styles all use it, so their numbers always agree
  for the same report. Ordering is always by **Printed Date**.
- Factories are never cross-compared — a report only ever compares against
  earlier reports from the same factory.
- **STATUS-PSD** (PSD = Production Start Date) is decided in this order:
  **NOT PRE DATA** (no prior report exists for the factory) → **NEW**
  (first appearance of this exact Style+Tracking+Line) →
  **TIGH PRO-PSD** *("Tight to Production")* (ST moved later by more than
  the *ST Threshold*, and Delivery hasn't extended by more than the
  *Delivery Threshold* to compensate — this also covers Delivery moving
  *earlier* while ST slips, the worst version of this pattern) →
  **CHANGED-FI/DEL** (Finish Date or Delivery Date changed; ST is
  deliberately excluded from this check, since it's handled entirely by
  the rule above) → **UNCHANGED-PSD** (nothing that matters moved,
  including an ST move that stayed within the ST Threshold). Both
  thresholds are set in **Settings → Matching & Thresholds** (default 3
  days each).
- **MOVEMENT** *(Style Movement)* is independent of STATUS-PSD — purely the
  sign of how far ST moved: **Push Back** (later), **Advance** (earlier),
  or **NO MOVEMENT** (unchanged or no baseline).
- When ST changes at all, the **Qty Shift** badge tells you *why* — this
  is unrelated to the threshold system above: **Full Shift** (Plan Qty
  roughly unchanged — the whole order was re-dated before any production
  happened) vs **Balance Shift** (Plan Qty dropped — some units were
  already completed under the old date and the remainder was rescheduled,
  usually meaning the factory missed its target) vs **Qty Increased** (the
  order itself was amended). Hover the badge to see the previous week's
  quantity. Colors for all of these are adjustable in Settings.

## STATUS-DEL — a second, independent status system

Everything in **How matching works** above (STATUS-PSD, STYLE MOVEMENT, ST
Threshold, Delivery Threshold) is about Production **Start** Date. STATUS-DEL
asks a completely separate question — once production actually **finishes**,
is there still enough time before Delivery? — with its own calculation, its
own thresholds, and its own colors. Critically, **STATUS-DEL, not
STATUS-PSD, drives the row highlighting** on All Styles and Changed Styles.

- **GAP OF FI & DEL** = Delivery Date − FI, in days, calculated at the same
  Style+Tracking+Line level as everything else. Uses the *current* Delivery
  Date — after any Delivery Date Correction has been applied, not the
  original PDF value.
- **Wash Type** (`Wash` / `Non Wash`) is never entered manually — upload a
  mapping file in **Settings → Wash Type Mapping**, matched by **Style
  Number alone** (a physical garment property, so one row covers every
  Tracking Number and Line for that style). A style with no mapping entry
  **defaults to Non Wash**. The mapping supports the same Merge/Replace
  upload modes as Delivery Date Corrections, plus a template download and
  an export of every style that has no mapping entry.
- **STATUS-DEL**: `Gap >= threshold` → **SAFE**; `Gap < threshold` →
  **CRITICAL-DEL** (a negative gap satisfies this automatically — no
  special-casing needed). The threshold used depends on the style's Wash
  Type: **Wash Threshold** (default 7 days) or **Non Wash Threshold**
  (default 5 days), both editable in **Settings → STATUS-DEL Thresholds &
  Colors**, along with the SAFE/CRITICAL-DEL colors themselves (default
  green/red — nothing is hardcoded).
- Both are computed **fresh on every read**, not cached or written back to
  storage — so uploading a new Wash Type mapping, changing a threshold, or
  a Delivery Date Correction taking effect all show up immediately on the
  next render, with nothing to manually "reapply."

## Changed Style History

A permanent record of past comparisons, separate from the live Changed
Styles view — useful for keeping an audit trail that survives new PDFs
coming in and changing what "latest" means.

- **Save to History** (on Changed Styles) is only enabled when exactly one
  report is in view — narrow to a specific factory, or open a report
  directly from Reports. It's disabled otherwise, since a saved record
  represents one specific (current report, baseline report) comparison.
- Saving **never overwrites or modifies any existing record** — every save
  creates a brand new, fully independent entry, including everything
  displayed at that moment: every style's ST/FI/Delivery, STATUS-PSD,
  STATUS-DEL, Wash Type, Qty Shift, comments, and enough metadata to
  reproduce exactly what was shown.
- The **Changed Style History** page (below Changed Styles in the sidebar)
  lists every saved record, grouped by **Factory → compared file name**,
  showing the Source Style PDF Name, the previous file's printed date, and
  the exact comparison timestamp. Search, sort, **rename** (the display
  label only — the original PDF on disk is never touched), and **delete**
  are all available from this list.
- Opening a record shows the complete table **exactly as it looked when
  saved** — read-only by default. An explicit **Edit comments** toggle
  lets you update just the Comments column; editing a comment here updates
  only that one frozen record and nothing else — not the live Changed
  Styles data, not any other history entry.

### Storage: IndexedDB first, folder export as a portable backup

Every record is saved to the browser's own database first — that's the
authoritative copy the app actually reads from, works fully offline, and
needs no configuration. Additionally, each record is automatically written
out as its own JSON file into a **`History`** subfolder inside your
connected project folder (the same folder configured for watching PDFs,
upgraded to read-write permission the first time you save — you'll see one
extra permission prompt for this).

If that project folder happens to already live inside OneDrive, SharePoint
Sync, Dropbox, Google Drive Desktop, or a shared network path, those JSON
files travel along wherever your OS or sync client already sends that
folder — **this app never talks to any cloud API directly**, and can't
guarantee or manage that syncing; it only writes plain files to a plain
folder. On startup, the app checks the `History` subfolder against its own
database and pulls in anything newer or missing, so records stay
consistent across any machines sharing that same synced folder. Records
are matched across machines by an internal identifier generated at save
time — not by the database's own row number, which only means something
within one machine's browser and can't be relied on to match another
machine's copy of the same record.

If no project folder is configured, or write permission isn't granted, the
JSON export step is silently skipped — the IndexedDB save still succeeds
either way, since that's the primary store.

## About the PDF parser

This report format has real quirks that a naive parser will trip on — this
one was built and tuned against an actual production FastReact PDF (layout
version `5.1002.7700.4`), not just the format description:

- Some header cells print with reversed character order (a report-generator
  bug — `OPE` prints as `EPO`, `PRD` prints as `DRP`).
- A few narrow adjacent columns (Acc | Cont/MRP, Similar Body | STYLE-NO)
  sometimes print with no visible gap between them.
- S/P and GMT TYPE are free-text fields that can run together — recovered
  via pattern matching (the closed vocabulary: SOLID/MATCHING/PINNING + ONE
  WAY/TWO WAY) rather than by position.
- Merchant name previously overlapped Del Date/Takt Time in this report's
  layout. Since Merchant isn't needed for comparison, it's intentionally
  **not extracted** — this also sidesteps that overlap issue entirely and
  makes Del Date extraction more reliable.
- Every genuine production-ramp row carries its own Tracking Number; the
  **grand-total rollup row** at the end of each Cont/MRP group is the one
  row where it's blank. That blank is used to exclude it from extraction —
  otherwise its totals would double-count Plan Quantity when rows are
  summed into the Cont/MRP-level record.

### Optional columns: how they're rolled up

Acc, Similar Body, and TGT CUT are constant per Cont/MRP group, so the first
ramp row's value is used directly. **TRG/H** (labeled "TGT%" in earlier
versions) is sourced from the PDF's **TH** column (not its own "TGT"
column — that one turned out not to be the correct field), also taken
from the first ramp row since it's constant per group. Two fields need a
judgment call since they vary across a group's ramp rows, worth
understanding if the numbers ever look off:

- **Avg Effi** is rolled up as a **simple average** across the group's
  ramp rows.
- **PRD DYS** is rolled up as the **maximum** value seen across the group's
  ramp rows, on the assumption it accumulates as ramp segments progress.

Both are informational only — neither feeds the ST/Delivery comparison or
severity logic, so a rollup that isn't perfectly precise doesn't affect
Critical detection.

Column positions are fixed constants in `js/parser/layoutMap.js`, derived by
analyzing real character coordinates in a sample PDF, not by matching header
label text (which turned out to be unreliable given the quirks above). If a
future FastReact version changes the report layout, these constants are
where to start — re-derive them the same way (inspect real column x-ranges
in a sample PDF) rather than assuming header text will match cleanly.

If parsing looks wrong on a new PDF, check **Settings → Diagnostics** for
warnings, and compare the extracted row count against what you'd expect
from the source file.

## Project layout

```
index.html                  entry point — load this via a local server
run-option-a-python.bat/.sh  one-click launcher — Python server
run-option-b-node.bat/.sh    one-click launcher — Node server
css/styles.css               shared design tokens + component styles
js/
  app.js                     router + ingestion pipeline glue
  ingestion/                 folder picking, permission, polling watcher
  parser/                    PDF.js-based extraction, column layout map, rollup
  engine/                    key matching, field diff, severity classification
  storage/                   IndexedDB wrapper + repository functions
  export/                    CSV / Excel / PDF export
  settings/                  settings persistence
  ui/                        the five views (reports, dashboard, changed
                              styles, style detail, settings) + shared shell
assets/logo.png               Star Garments brand mark, used in the sidebar
```

## Wash Type — matched by SPL OPE code, not Style Number

Wash Type is derived from the **SPL OPE** code each planning PDF prints
per style, looked up against a Special Operations master data file
uploaded in Settings — not from Style Number at all. Column letters
(which column holds the code, which holds Wash Status) are user-editable,
same pattern as Delivery Date Corrections, since a differently-laid-out
export shouldn't require a code change.

Matching ignores case and **all** spaces — `ABC`, `abc`, and `A B C` are
all treated as the same code (spaces are stripped entirely, not just
collapsed, since the source data can print a code either way). A code
with no match defaults to **Non Wash** rather than stopping processing,
and is listed in Settings so missing master data entries can be spotted
and added.

The master file is stored permanently (survives a browser restart, and
isn't cleared by "Reset all stored data" — it's configuration you build
up over time, same as Delivery Corrections). Applies automatically to
both All Styles and Changed Styles whenever a PDF is processed or the
master file changes — nothing to manually recalculate.

## Required setup, sidebar indicators, and per-page controls

**Special Operations master data is now required before the comparator
runs at all.** All Styles, Changed Styles, Changed Style History,
Dashboard, and individual style detail pages are blocked with a clear
setup screen until it's been uploaded at least once in Settings — Reports,
Settings, and this Guide stay reachable regardless, since Settings is
where the upload happens. It's also stored as a JSON file in your watched
folder (not just the browser's own storage), and read back automatically
if the browser's storage is ever cleared — every new upload replaces this
same file, it never accumulates multiple versions.

Two small sidebar indicators, right below the folder connection status,
show at a glance whether Delivery Corrections and Wash Master Data have
ever been uploaded — the same green/red dot style as the folder status
above them.

**"2nd Del" only ever appears once Delivery Corrections has been
uploaded** — until then, the column is hidden entirely on All Styles and
Changed Styles, rather than showing with nothing in it.

**Save Layout** (both forms) explicitly persists your current column
order, widths, and show/hide choices, so they're remembered next time —
order and widths already auto-saved as you dragged/resized; this button
additionally saves which columns are currently hidden, which wasn't
persisted before.

**Refresh Data** (both forms) runs the full pipeline in one click: clears
the PDF cache, re-converts every PDF to JSON, then fetches documents —
equivalent to doing all three from Reports/Settings manually, without
leaving the page you're on.

## Not yet built (flagged in the architecture review as future work)



- Electron packaging (true filesystem push-events instead of polling) — the
  code is structured so only `ingestion/` and `storage/` would need to
  change if you want this later.
- Multi-week trend view, line-reallocation tracking, proactive
  email/Slack/desktop alerts, direct FastReact API integration.

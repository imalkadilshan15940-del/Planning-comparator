// ui/help.js
// Built-in guide explaining what the system does and what each screen and
// badge means — in particular STATUS-PSD and STYLE MOVEMENT, which are the
// two things worth being unambiguous about since they drive what a planner
// acts on.

export async function renderHelp(container) {
  container.innerHTML = `
    <div class="topbar"><h1>Guide &amp; Features</h1></div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">What this system does</h3>
      <p style="color:var(--slate); font-size:13.5px;">
        Every week, factories receive a FastReact "Line Loading" PDF. The
        biggest risk hiding in that report is a style whose <b>Production
        Start Date (ST)</b> has been pushed later while the <b>Delivery
        Date</b> stays the same — which quietly shrinks the time available
        to actually make the order. This system reads every PDF you drop
        into your watched folder, compares each style against its own full
        history (not just the last report), and surfaces exactly that
        signal automatically.
      </p>
      <p style="color:var(--slate); font-size:13.5px;">
        Matching and calculation happen at <b>Style No + Tracking No +
        Line</b> level — not the raw Cont/MRP detail rows the PDF itself
        prints. A style with three different Tracking Numbers on the same
        line shows as three separate rows, since each is tracked and
        compared independently.
      </p>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">Pages in this system</h3>
      <ul style="font-size:13.5px; color:var(--ink); padding-left:20px; line-height:1.9;">
        <li><b>Reports</b> — every ingested PDF, with a status badge, so you can see at a glance which documents need attention before opening any of them. Set how many prior reports to compare against here (or "All"). <b>PDF to JSON</b> parses every PDF in your connected folder into a cached JSON file — genuinely parsing each one (the expensive step), not just backing up what's already loaded. Clicking this before Fetch Documents means Fetch can load from that cache instead of re-parsing each PDF directly, so it's noticeably faster, and re-running PDF to JSON skips any file whose cache is already up to date rather than re-parsing everything each time. A file that was never pre-converted still works correctly with Fetch Documents on its own — it's parsed directly the first time, and cached automatically afterward. This cache also doubles as a durability backup: if a PDF is later deleted from the folder, or the browser's storage is cleared, this is what gets restored from automatically on startup. Each cached file also remembers which version of the parsing logic produced it — if that logic is later updated (a bug fix, for example), a cache written by the older version is automatically treated as stale and silently re-parsed, rather than continuing to serve pre-fix results indefinitely just because the source PDF itself hasn't changed.</li>
        <li><b>Dashboard</b> — a factory-by-factory summary of the latest report from each.</li>
        <li><b>Changed Styles</b> — the main working screen. Every Style+Tracking+Line compared against its own most recent prior appearance, grouped by Line (or Style, or Factory — your choice), with ST / FI / Delivery / Plan Qty / Movement Days-PSD shown directly. Click any row to expand a Production Timeline (Gantt-style) chart, plotting every FR revision's ST/FI/Delivery on a real calendar.</li>
        <li><b>All Styles</b> — every Style+Tracking+Line record from every PDF, in one browsable, sortable, exportable list — the same matching level and Status logic as Changed Styles, so the two always agree.</li>
        <li><b>Changed Style History</b> — click <b>Save to History</b> on Changed Styles (when viewing exactly one report) to freeze that comparison as a permanent, independent record — grouped by Factory, searchable, sortable, renameable, and deletable. Opening one shows the exact table as it looked when saved, read-only by default, with an explicit toggle to edit just the Comments.</li>
        <li><b>Settings</b> — ST/Delivery thresholds, STATUS-DEL thresholds &amp; Wash Type mapping, colors, fonts, theme, folder connection, delivery date corrections, and diagnostics.</li>
      </ul>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">What STATUS-PSD means</h3>
      <p style="color:var(--slate); font-size:13px; margin-bottom:10px;">
        PSD = Production Start Date. ST movement is evaluated entirely
        through the two thresholds below (<b>Settings → Matching &amp;
        Thresholds</b>) — it does <i>not</i> factor into whether something
        counts as CHANGED-FI/DEL.
      </p>
      <table style="width:100%;">
        <tbody>
          <tr><td style="width:190px;"><span class="badge" style="background:#B03040;">TIGH PRO-PSD</span></td><td style="font-size:13px; color:var(--ink);">ST moved later by more than the <b>ST Threshold</b>, and Delivery hasn't extended by more than the <b>Delivery Threshold</b> to compensate. This is the core thing to act on — includes the case where Delivery actually moved <i>earlier</i> while ST slipped, which is the worst version of this.</td></tr>
          <tr><td><span class="badge" style="background:#B8791A;">CHANGED-FI/DEL</span></td><td style="font-size:13px; color:var(--ink);">Finish Date or Delivery Date changed (regardless of what ST did). If ST also slipped but Delivery was extended enough to compensate, it lands here instead of TIGHT.</td></tr>
          <tr><td><span class="badge" style="background:#8494A2;">UNCHANGED-PSD</span></td><td style="font-size:13px; color:var(--ink);">Nothing that matters has moved — including an ST move that stayed within the ST Threshold.</td></tr>
          <tr><td><span class="badge" style="background:#1E6690;">NOT PRE DATA</span></td><td style="font-size:13px; color:var(--ink);">No prior report exists yet for this factory at all — there's nothing to compare against.</td></tr>
          <tr><td><span class="badge" style="background:#2E7D5B;">NEW</span></td><td style="font-size:13px; color:var(--ink);">This exact Style+Tracking+Line is appearing for the first time — the factory has earlier reports, just not this one.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">What STYLE MOVEMENT means</h3>
      <p style="color:var(--slate); font-size:13px; margin-bottom:10px;">Independent of STATUS-PSD — purely the direction ST moved, regardless of threshold.</p>
      <table style="width:100%;">
        <tbody>
          <tr><td style="width:120px; color:var(--critical); font-weight:600;">Push Back</td><td style="font-size:13px; color:var(--ink);">ST moved to a later date than last time (Movement Days-PSD &gt; 0).</td></tr>
          <tr><td style="color:var(--success); font-weight:600;">Advance</td><td style="font-size:13px; color:var(--ink);">ST moved to an earlier date than last time (Movement Days-PSD &lt; 0).</td></tr>
          <tr><td style="color:var(--slate); font-weight:600;">NO MOVEMENT</td><td style="font-size:13px; color:var(--ink);">ST is exactly the same as last time, or there's no prior appearance to compare.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">STATUS-DEL — a second, independent system</h3>
      <p style="color:var(--slate); font-size:13.5px; margin-bottom:10px;">
        Everything above (STATUS-PSD, STYLE MOVEMENT, ST/Delivery Thresholds)
        is about Production <b>Start</b> Date. STATUS-DEL is a completely
        separate question: once production actually <b>finishes</b>, is
        there still enough time before Delivery? It has its own calculation,
        its own thresholds, and its own colors — and unlike STATUS-PSD, it's
        <b>STATUS-DEL that drives the row highlighting</b> on All Styles and
        Changed Styles, not STATUS-PSD.
      </p>
      <p style="color:var(--slate); font-size:13.5px; margin-bottom:10px;">
        <b>GAP OF FI &amp; DEL</b> = Delivery Date − FI, in days (using the
        current Delivery Date — after any correction from Settings →
        Delivery Date Corrections has been applied). Compared against a
        threshold that depends on the style's <b>Wash Type</b>:
      </p>
      <table style="width:100%; margin-bottom:10px;">
        <tbody>
          <tr><td style="width:150px;"><span class="badge" style="background:#2E7D5B;">SAFE</span></td><td style="font-size:13px; color:var(--ink);">Gap is at or above the threshold for this style's Wash Type.</td></tr>
          <tr><td><span class="badge" style="background:#B03040;">CRITICAL-DEL</span></td><td style="font-size:13px; color:var(--ink);">Gap is below the threshold — including any negative gap (Delivery earlier than FI).</td></tr>
        </tbody>
      </table>
      <p style="color:var(--slate); font-size:13px;">
        <b>Wash Type</b> (Wash / Non Wash) is never entered by hand — upload a
        mapping file in <b>Settings → Wash Type Mapping</b>, matched by Style
        Number alone (so it covers every Tracking Number and Line for that
        style automatically). A style with no mapping entry defaults to
        <b>Non Wash</b>. Both thresholds (Wash: 7 days, Non Wash: 5 days by
        default) and both colors are editable in
        <b>Settings → STATUS-DEL Thresholds &amp; Colors</b>.
      </p>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">ST &amp; Delivery Thresholds</h3>
      <p style="color:var(--slate); font-size:13.5px;">
        Set in <b>Settings → Matching &amp; Thresholds</b>. <b>ST Threshold</b>
        is how many days ST can slip before it's considered "tight" rather
        than normal fluctuation. <b>Delivery Threshold</b> is how many days
        Delivery can extend and still count as "not compensating" for that
        ST slip — if Delivery is pushed out further than this threshold, the
        style is no longer flagged TIGHT (it still shows as CHANGED-FI/DEL,
        since Delivery did move). Delivery moving <i>earlier</i> than
        before always keeps a style within the TIGHT rule, never removes it.
      </p>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">What the Qty Shift badge means</h3>
      <p style="color:var(--slate); font-size:13px; margin-bottom:10px;">Shown whenever a style's ST date has changed at all — it tells you <i>why</i> it likely moved, based on whether the Plan Qty moved with it. This is separate from STATUS-PSD/thresholds.</p>
      <table style="width:100%;">
        <tbody>
          <tr><td style="width:150px;"><span class="badge" style="background:var(--warning);">Full Shift</span></td><td style="font-size:13px; color:var(--ink);">Plan Qty is about the same as last time. Nothing has been produced yet — planning simply moved the whole order to a new date.</td></tr>
          <tr><td><span class="badge" style="background:var(--critical);">Balance Shift</span></td><td style="font-size:13px; color:var(--ink);">Plan Qty dropped from last time. Some units were already completed under the old schedule, and only the <b>leftover balance</b> was rescheduled — usually a sign the factory missed its target on the rest.</td></tr>
          <tr><td><span class="badge" style="background:var(--brand-blue);">Qty Increased</span></td><td style="font-size:13px; color:var(--ink);">Plan Qty went up from last time — the order itself was amended.</td></tr>
        </tbody>
      </table>
      <p style="color:var(--slate); font-size:12px; margin-top:10px;">Hover any Qty Shift badge on the Changed Styles page to see the exact previous-week quantity. Colors for all of these are adjustable in Settings.</p>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">Changed Style History &amp; storage</h3>
      <p style="color:var(--slate); font-size:13.5px;">
        Click <b>Save to History</b> on Changed Styles to freeze the current comparison
        as a new, independent record — saving never modifies or overwrites any
        previous record. Save is only available when exactly one report is in
        view (pick a specific factory, or open a report from Reports); it's
        disabled otherwise.
      </p>
      <p style="color:var(--slate); font-size:13.5px;">
        Every record is stored in the browser's own database first — that's what
        the app actually reads from, works offline, and needs no setup. Additionally,
        each record is automatically written as its own JSON file into a
        <b>History</b> subfolder inside your connected project folder. If that
        folder happens to live inside OneDrive, SharePoint Sync, Dropbox, Google
        Drive Desktop, or a shared network path, those files travel along
        wherever your OS/sync client already sends that folder — this app never
        talks to any cloud service directly. On startup, the app checks that
        History subfolder and pulls in anything newer or missing from its own
        database, so records stay consistent across machines sharing that folder.
      </p>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">Production Timeline chart</h3>
      <p style="color:var(--slate); font-size:13.5px;">
        Click any row on Changed Styles or an opened Changed Style History record to expand a
        Gantt-style timeline — one row per FR printed date, plotted on a real calendar so you can
        see at a glance how the schedule has actually moved between revisions, not just the raw
        numbers. <span style="color:var(--success); font-weight:600;">Green</span> is the
        Production bar (ST → FI), with the day count labeled directly on it. Delivery Date shows as
        a short vertical line at its own calendar position — deliberately not a bar connecting to
        FI, since Delivery sometimes lands before Finish (an advanced Delivery meeting a
        pushed-back FI), and a plain marker shows that correctly without needing any special
        handling — the label below it (e.g. <span class="mono">+5d</span> or
        <span class="mono">-3d</span>) is simply Delivery's day-gap relative to FI. Hovering any
        row shows the full breakdown (printed date, all three milestones, production days,
        delivery-vs-finish gap). The printed-date column and calendar header both stay fixed in
        place while you scroll.
      </p>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">Comments</h3>
      <p style="color:var(--slate); font-size:13.5px;">
        One unified comment history per style — matched by <b>Style No + Tracking No + Line</b>
        (case and spacing don't matter), not tied to any one week's PDF and not tied to which
        screen you add it from. Click the 💬 in the Comments column on <b>All Styles</b>,
        <b>Changed Styles</b>, or an opened <b>Changed Style History</b> record — all three read
        and write the exact same history, so a comment added anywhere shows up everywhere,
        including in reports generated later. A blue <b>💬 N</b> pill means N comments already
        exist; a faded 💬 means none yet — so you never need to click a row just to check. Nothing
        is ever overwritten; every comment is appended permanently.
      </p>
      <p style="color:var(--slate); font-size:13.5px;">
        Every comment is tagged with the report it was added under (filename + printed date) —
        shown next to each entry as <span class="mono">MM/DD/YY — filename</span>, alongside the
        comment's own date. <b>Changed Styles</b> always shows the complete thread, unfiltered —
        it's always showing the current comparison. <b>All Styles</b> and an opened
        <b>Changed Style History</b> record are different on purpose: each row/record only shows
        comments tagged with a report date on or before its own report — since a row in All Styles
        or a saved History record can represent an older point in time, not just "now," it only
        shows what existed by then, the same way its other values are point-in-time too. A comment
        with no extractable report date always shows regardless, rather than risk hiding it.
      </p>
      <p style="color:var(--slate); font-size:13.5px;">
        Stored in the browser's own database first (fast, always available), and additionally
        written to disk as a file per style inside a <b>Comments</b> subfolder of your connected
        project folder — not kept only in browser storage. If that folder lives inside OneDrive,
        SharePoint Sync, Dropbox, or a shared network path, those files travel along on their own;
        this app never talks to a cloud API directly. On startup, anything found in that folder
        but missing from the browser's own copy (e.g. added on another machine) is imported
        automatically.
      </p>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">Delivery Date corrections</h3>
      <p style="color:var(--slate); font-size:13.5px;">
        If another department's report has the correct Delivery Date, upload it in
        <b>Settings → Delivery Date Corrections</b> — matched by Style Number (always) plus
        Tracking Number and/or Factory+Line (your choice). Expects the document date in cell
        <b>B3</b>, headers at <b>row 5</b>, data from <b>row 6</b>, and reads whichever column
        letters are configured in Settings for Style Number, Tracking Number, Factory, Line, and
        Delivery Date — so a re-ordered export of the same report is a Settings change, not a code
        change. Factory and Line are combined the same way the planning PDF itself formats them
        (e.g. <span class="mono">KGG 02</span>) before matching.
      </p>
      <p style="color:var(--slate); font-size:13.5px;">
        Matching ignores case and extra spaces on both sides — <span class="mono">" abc123 "</span>,
        <span class="mono">"ABC123"</span>, and <span class="mono">"Abc123"</span> are all treated
        as the same value — and dates are compared by actual value regardless of how they were
        formatted in the source file. The PDF's own Delivery Date is <b>never overwritten</b> — a
        match instead fills in a separate <b>2nd Del</b> column, shown alongside Delivery on All
        Styles, Changed Styles, and Changed Style History, highlighted
        <span style="color:var(--success); font-weight:600;">green</span> when present and blank
        when no correction matches that row. Runs automatically on Fetch Documents and every time
        you open the app, and any style that fails to match is listed in a popup with an export
        option.
      </p>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">Search &amp; column filters</h3>
      <p style="color:var(--slate); font-size:13.5px;">
        Every search box (Style/Tracking on All Styles &amp; Changed Styles, filename on Reports &amp;
        Changed Style History) supports two modes: type normally for a <b>partial</b> match
        (<span class="mono">ABC123</span> finds <span class="mono">ABC123</span>,
        <span class="mono">ABC123-A</span>, <span class="mono">ABC123-R1</span>…), or end with
        <b>%</b> for an <b>exact</b> match (<span class="mono">ABC123%</span> finds only
        <span class="mono">ABC123</span>). Search text and dropdown filters always start fresh
        each time you open a page — they never silently carry over from a previous visit.
      </p>
      <p style="color:var(--slate); font-size:13.5px;">
        Below every column header on <b>All Styles</b>, <b>Changed Styles</b>, and an opened
        <b>Changed Style History</b> record is a per-column filter — a text box for text columns,
        or a compact <b>Filter…</b> button for number/date columns that opens a small range
        picker (avoids two inputs fighting for space in one column). Every filter combines with
        every other one, including the search box. <b>Clear Filters</b> resets them all. Reports
        intentionally has no column filters — just the Factory filter and its own search box.
      </p>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;">Tables: grid lines, resizing, reordering</h3>
      <p style="color:var(--slate); font-size:13.5px;">
        Every table shows visible grid lines on all cells. Drag a column's edge to resize it —
        there's no meaningful ceiling, and the table itself grows past its frame when needed
        (use the relocated scrollbar next to the zoom slider to see the rest). Drag a column
        <i>header</i> (not its edge) to reorder it. Both the width and the order you choose are
        remembered across reloads, on All Styles and Changed Styles.
      </p>
    </div>

    <div class="card">
      <h3 style="font-size:15px;">Tips</h3>
      <ul style="font-size:13.5px; color:var(--ink); padding-left:20px; line-height:1.9;">
        <li>Use the <b>⟳ Fetch Documents</b> button any time you don't want to wait for the automatic folder check.</li>
        <li>Drag a column's edge to resize it on any data table.</li>
        <li>Use the <b>zoom bar</b> at the bottom of the screen to fit more rows on screen, or make text larger.</li>
        <li>The Production Timeline chart's calendar reads left to right; its rows read oldest to newest bottom to top. Date lists elsewhere read oldest → newest, left to right.</li>
        <li>All Styles and Changed Styles use identical Style+Tracking+Line matching and STATUS-PSD logic — if the numbers ever disagree between the two, that's worth reporting as a bug.</li>
      </ul>
    </div>
  `;
}

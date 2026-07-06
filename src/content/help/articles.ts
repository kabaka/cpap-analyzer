/**
 * Help articles — structured content for the in-app help system.
 *
 * Each article has a slug (URL parameter), title, summary, icon category,
 * and content organized into sections with headings and paragraphs.
 */

export interface ArticleSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface HelpArticle {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly icon: ArticleIcon;
  readonly featured?: boolean;
  readonly sections: readonly ArticleSection[];
}

export type ArticleIcon =
  | 'getting-started'
  | 'import'
  | 'dashboard'
  | 'sessions'
  | 'statistics'
  | 'events'
  | 'pressure'
  | 'reports'
  | 'settings'
  | 'clinical'
  | 'integrations';

export const helpArticles: readonly HelpArticle[] = [
  // ─── GETTING STARTED ──────────────────────────────────────────────
  {
    slug: 'getting-started',
    title: 'Getting Started',
    summary: 'What CPAP Analyzer does, how your data stays private, and how to begin.',
    icon: 'getting-started',
    featured: true,
    sections: [
      {
        heading: 'What is CPAP Analyzer?',
        paragraphs: [
          "CPAP Analyzer is a client-side web application that helps you understand your CPAP therapy data at a scientific level. It reads the data files from your CPAP machine's SD card and provides detailed statistical analysis, interactive visualizations, event analysis, and clinical context — all within your browser.",
          'Unlike cloud-based apps like ResMed myAir, CPAP Analyzer never sends your data to any server. Everything runs locally on your device. There is no account to create, no data to upload, and no telemetry. Your health data stays yours.',
        ],
      },
      {
        heading: 'Who is it for?',
        paragraphs: [
          'CPAP Analyzer is designed for patients who want to go beyond the surface-level summaries provided by manufacturer apps. Whether you have a background in data science, mathematics, engineering, or are simply a motivated learner, this tool gives you the depth to truly understand your therapy.',
          'The help system includes layered explanations: quick summaries for those who just need the gist, and detailed breakdowns with formulas and clinical references for those who want to verify every calculation.',
        ],
      },
      {
        heading: 'Quick start',
        paragraphs: [
          '1. Remove the SD card from your CPAP machine (consult your machine manual for the SD card location).',
          '2. Insert the SD card into your computer using an SD card reader.',
          '3. Click "Import Data" from the sidebar or dashboard, and select the SD card directory.',
          '4. CPAP Analyzer will parse your data files and display a summary of the imported sessions.',
          '5. Explore the Dashboard for an overview, or dive into Sessions for night-by-night detail.',
        ],
      },
      {
        heading: 'Finding your way around',
        paragraphs: [
          'The left sidebar is the primary navigation. It groups the views into an "Analysis" section (Dashboard, Sessions, Trends, Explore, and Reports) and a "Data" section (Data, where you import and manage your records), with Help and Settings pinned to the footer.',
          'On a wide screen you can collapse the sidebar to a narrow, icon-only "rail" to reclaim horizontal space for charts and the signal viewer — useful when inspecting whole-night waveforms. Use the toggle button pinned in the sidebar footer (labelled "Collapse sidebar" when expanded, "Expand sidebar" when collapsed), or press the `[` key. In the collapsed rail, each item shows only its icon; hover or move keyboard focus to an icon to reveal a tooltip with its label, and the view you are currently on stays marked by an accent bar. Your choice is remembered the next time you open the app — like every preference, it is stored locally in your browser and never leaves your device. The `[` shortcut is desktop-only and is ignored while you are typing in a text field. On narrow (mobile) screens the sidebar instead appears as a slide-in drawer opened from the menu button.',
        ],
      },
      {
        heading: 'Privacy guarantee',
        paragraphs: [
          "CPAP Analyzer is architecturally incapable of transmitting your data. It runs entirely in your browser using client-side JavaScript. There are no server endpoints, no analytics services, no tracking pixels, and no external API calls. Your data is stored in your browser's local storage (IndexedDB and OPFS) and never leaves your device.",
          'You can verify this yourself: the application works fully offline after the initial page load. Open developer tools and monitor the Network tab — you will see zero data transmissions.',
        ],
      },
    ],
  },

  // ─── IMPORTING DATA ───────────────────────────────────────────────
  {
    slug: 'importing-data',
    title: 'Importing Data',
    summary:
      'How to import CPAP data from your SD card and wearable data from Google Health (Fitbit), and how the background import indicator works.',
    icon: 'import',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          "CPAP Analyzer reads data directly from your CPAP machine's SD card. ResMed devices store therapy data in a structured directory format with EDF (European Data Format) files containing detailed signal recordings and summary statistics. The app can also import wearable health data from a Google Health (Fitbit) export. Both kinds of import run client-side, in the background, with the same persistent progress indicator described below.",
        ],
      },
      {
        heading: 'How the import runs (background import and the progress indicator)',
        paragraphs: [
          'Imports run in the background. Once you start an import, you do not have to wait on the import screen — you can navigate anywhere in the app (Dashboard, Sessions, Trends, Settings) while it continues. A small progress pill appears at the bottom-left of every screen so you always know an import is in flight and how far along it is.',
          'Click (or keyboard-activate) the pill to expand a detail panel. The panel lists every stage of the current import with its own state — pending, running, done, or, if something goes wrong, failed or cancelled — and shows a Cancel button. When the import finishes, a completion toast tells you what changed (for example, how many new sessions or records were added and how many duplicates were skipped). The indicator is keyboard-accessible and announces progress to assistive technology through a polite live region, so screen-reader users are kept informed without a flood of chatter.',
          'Progress is multi-stage and every stage is shown from the start, each advancing independently — there is no longer a single bar whose meaning silently changes as the import moves through its phases. A CPAP SD-card import shows four stages: scanning files (discovering what is on the card), parsing (decoding the EDF signal and summary files), building sessions (assembling each night from its segments and summaries), and storing (writing the results to your local database). A Google Health import shows a scanning stage, then a determinate sub-progress row for each discovered data type (sleep, intraday heart rate, SpO\\u2082, HRV, snoring, and so on) that fills in as that type is imported. This makes it obvious, at a glance, exactly where a long import is and which data types are still to come.',
        ],
      },
      {
        heading: 'Preparing your SD card',
        paragraphs: [
          'Turn off your CPAP machine before removing the SD card. The SD card slot is typically located on the side or back of the device. For ResMed AirSense 10 and 11, gently press the card to release it.',
          "Insert the card into your computer's SD card reader. The card should appear as a removable drive. Do not modify or delete any files on the card.",
        ],
      },
      {
        heading: 'Importing with File Picker',
        paragraphs: [
          'Click "Import Data" and use the file picker dialog to select the root directory of your SD card (the folder containing the DATALOG, SETTINGS, and other directories). CPAP Analyzer will scan the directory structure and identify all available session data.',
          'The import process reads the following files: Identification.tgt (machine identification), STR.edf (session summary records), and individual EDF files in DATALOG subdirectories (detailed signal data). Settings files in the SETTINGS directory provide machine configuration context.',
        ],
      },
      {
        heading: 'What gets imported',
        paragraphs: [
          'Session summaries: date, duration, AHI, leak statistics, pressure statistics for each night.',
          'Detailed signals: high-resolution flow, pressure, and leak waveforms sampled at 25 Hz (25 readings per second). These enable breath-by-breath analysis and event visualization.',
          'Machine settings: therapy mode (CPAP/APAP/BiPAP), pressure settings, EPR configuration, ramp settings, and mask type.',
          'Multiple sessions on the same calendar day are fully supported — if you removed the mask and reapplied it (e.g. a nap, or getting up during the night), each session is stored separately rather than overwriting one another. Empty or header-only EDF files that contain no events (for example a CSL Cheyne-Stokes annotation file from a night with none) are skipped silently rather than reported as errors; the import summary reports how many such files were skipped so the count is transparent.',
        ],
      },
      {
        heading: 'Import duration',
        paragraphs: [
          'Import time depends on how many nights of data are on the SD card. Typical import times: 30 days takes 5–15 seconds; 6 months takes 30–60 seconds; 1+ year may take 1–3 minutes. Detailed signal data (EDF files) is the largest component. You can monitor progress on the persistent progress indicator (see "How the import runs," above) and continue using the app while a long import finishes in the background.',
        ],
      },
      {
        heading: 'Re-importing and updates',
        paragraphs: [
          'You can re-import at any time to add new nights. CPAP Analyzer will detect which sessions already exist and only import new data. Existing data is not duplicated. The same incremental, de-duplicated behaviour is what makes cancelling an import or closing the tab mid-import safe — see "De-duplication" and "Closing the tab during an import," below.',
        ],
      },
      {
        heading: 'Google Health (Fitbit) import',
        paragraphs: [
          'CPAP Analyzer can import wearable health data exported from Google Takeout under the "Google Health" category (formerly Fitbit). This enables cross-source analysis — correlating your CPAP therapy metrics with sleep, activity, and physiological data from your wearable device.',
          'To export your data from Google: (1) Visit takeout.google.com. (2) Click "Deselect all," then select only "Google Health" (this contains your Fitbit data). (3) Choose your export format and click "Create export." (4) When the export is ready, download and extract the ZIP archive. (5) In CPAP Analyzer, open the Import Wizard, select "Google Health" as the source, and point the file picker at the extracted folder (the one containing subdirectories like "Sleep," "Heart Rate," etc.).',
          'The Import Wizard validates the folder structure before parsing. If it does not recognize the directory layout, verify that you selected the correct top-level folder from the extracted archive.',
        ],
      },
      {
        heading: 'Supported Google Health data types',
        paragraphs: [
          "The following data types are imported when present in the export: Sleep Sessions (start/end times, duration, efficiency), Sleep Scores (composite sleep quality metric, 0--100), Sleep Stages (wake, light, deep, REM durations and transitions), SpO\\u2082 — daily summary and per-minute intraday readings (peripheral oxygen saturation measured by the wearable's red/infrared sensor), HRV — daily summary and detailed intraday readings (heart rate variability, measured as RMSSD in milliseconds), Respiratory Rate (breaths per minute during sleep), Resting Heart Rate (daily resting BPM), Readiness Score (recovery/readiness composite, 0--100), Stress Score (stress management composite), Skin Temperature (nightly deviation from personal baseline in degrees), Daily Activity (steps, active minutes, calories), and Snoring (detected snoring episodes and duration).",
          'Not every Fitbit device records every data type. Older trackers may lack SpO\\u2082, HRV, or skin temperature sensors. The importer processes whatever data is present and silently skips missing categories.',
          'The large, full-resolution intraday series — heart rate at roughly a 5-second cadence, plus SpO\\u2082, HRV, and snoring — are parsed off the main thread so a big wearable import does not freeze the interface. Each of these data types advances its own determinate progress row in the import indicator, so you can watch them complete one by one while you continue using the app.',
        ],
      },
      {
        heading: 'Incremental import and duplicate detection',
        paragraphs: [
          'Re-importing the same Google Health export — or a newer export that overlaps with previously imported dates — is safe. The importer detects duplicates by matching on data type, date, and timestamp. Records that already exist in the local database are skipped; only genuinely new records are added. This means you can periodically re-export from Google Takeout and re-import without manually tracking which dates you have already loaded.',
        ],
      },
      {
        heading: 'Data privacy for Google Health imports',
        paragraphs: [
          'Google Health data is processed entirely in your browser, using the same client-side architecture as CPAP SD card imports. No data is uploaded to any server during or after the import. The parsed records are stored locally in IndexedDB alongside your CPAP data. The original export files on your computer are read but never modified.',
        ],
      },
      {
        heading: 'Cancelling an import',
        paragraphs: [
          'You can cancel an in-progress import at any time from the Cancel button in the expanded progress panel. Cancellation is immediate and safe: it stops the import promptly rather than waiting for the current phase to finish.',
          'Anything already written to your local database when you cancel is kept — cancellation never rolls back or corrupts data that was already stored. Because import is incremental and de-duplicated (see below), you lose no progress: when you re-import the same source later, the nights and records that were already saved are recognised and skipped, and only the remainder is added. In effect, cancelling and re-importing resumes from where you stopped.',
        ],
      },
      {
        heading: 'De-duplication: re-importing is always safe',
        paragraphs: [
          'Every import is incremental. CPAP Analyzer identifies what it already holds and imports only genuinely new data, so re-importing the same SD card or Google Health export — or a newer export that overlaps dates you have already loaded — never creates duplicates. For CPAP data this is keyed by session; for Google Health data it is keyed by data type, date, and timestamp. This is what makes cancellation, a closed tab, and routine periodic re-exports all safe: you can always just re-import, and the app sorts out what is new.',
        ],
      },
      {
        heading: 'Closing the tab during an import',
        paragraphs: [
          'Because the app is entirely client-side, an import lives inside the browser tab — there is no server-side job and no background process that survives the tab. If you close the tab (or the whole browser) while an import is running, the import simply ends.',
          'No data is corrupted by this. Results are written durably and incrementally as the import proceeds, so every night and record stored up to that moment remains valid and usable. The partial results are real, finished data — not a half-written file. To pick up the rest, re-import the same source: de-duplication recognises what was already saved, skips it, and imports only what is left. If you want an import to complete in one pass, leave the tab open until the completion toast appears; you are free to switch to other browser tabs in the meantime, but do not close this one.',
        ],
      },
    ],
  },

  // ─── DASHBOARD GUIDE ──────────────────────────────────────────────
  {
    slug: 'dashboard',
    title: 'Dashboard Guide',
    summary:
      'Reading the Signal Deck home dashboard: the good-night rate verdict and how it is defined, the 12-month AHI calendar spine, alert cards, the signal small-multiples rail, distribution plots, wearable correlation lanes, the weather summary card, the TECSA trajectory, the session log, and the 30D/90D analysis window.',
    icon: 'dashboard',
    sections: [
      {
        heading: 'Overview — the Signal Deck',
        paragraphs: [
          'The Dashboard is the app\'s home view: a dense, single-surface therapy overview called the "Signal Deck". It replaces the earlier "Control Room" dashboard (KPI cards plus a sessions table) with a set of purpose-built panels — a headline good-night-rate verdict, a long-horizon AHI calendar, alert cards, a rail of signal small-multiples, distribution plots, wearable correlation lanes, a weather summary card (when the weather integration is enabled), a treatment-emergent central-apnea trajectory, and a session log — laid out so a data-literate reader can take in the shape of their therapy at a glance and then drill into Sessions, Trends, or Explore for detail.',
          'The deck is theme-aware (light, dark, and custom themes) and, like the rest of the app, is computed entirely in your browser: nothing on this page is uploaded, and the header carries a "LOCAL · NO UPLOAD" badge as a reminder. Two windows are in play at once. Most panels follow the 30D/90D analysis-window toggle in the header (described at the end of this guide); the AHI calendar spine and the TECSA trajectory deliberately ignore the toggle and always cover a trailing 12 months, because they exist to show long-horizon structure that a 30- or 90-day window would hide.',
        ],
      },
      {
        heading: 'The good-night rate verdict',
        paragraphs: [
          'The top-left panel is the good-night rate: the percentage of the recorded nights in the active window that were, on that single night, both effective and adherent. It is shown as a ring (the rate itself), with a qualitative band and two supporting gate readouts, above a short factual line. The verdict eyebrow reads "Good-night rate" and the card caption states its meaning plainly: "Nights that were both effective (AHI < 5) and adherent (≥ 4 h use). A summary, not a diagnosis." It is meant to answer "over this window, what fraction of my nights actually went well on both counts?" in a single glance.',
          'A night counts as good only when it clears two independent gates. The effective gate is AHI < 5 events/h — the American Academy of Sleep Medicine (AASM) boundary between the normal and mild residual-AHI bands, i.e. residual apnea in the normal range. The adherent gate is usage ≥ 4 h for the night — the U.S. Centers for Medicare & Medicaid Services (CMS) per-night compliance floor. Both must hold on the same night; a night that was well-controlled but only used for two hours, or used all night but with an AHI of 8, is not a good night.',
          'The denominator is every recorded night in the window, not just the strong ones. This is deliberate and keeps the metric honest: a short or aborted night, and a night whose recording was too brief to yield a trustworthy AHI (a null AHI, which cannot confirm control), each count as a not-good night rather than being quietly dropped. Skipping weak nights would inflate the rate; including them means the figure reflects how often therapy actually went well, missed and half-nights included.',
          'Beneath the rate the card shows the two gates in isolation, over the same all-nights denominator: the share of nights meeting AHI < 5 (the effective rate) and the share meeting ≥ 4 h of use (the adherent rate). These explain why the combined rate is what it is — each can exceed the good-night rate itself, because a night may pass one gate but not the other, and the gap between them tells you whether efficacy or adherence is the limiting factor. Both gate thresholds are the same canonical constants used elsewhere in the app (the AASM AHI severity bands and the CMS compliance hours), not numbers invented for the dashboard.',
          'The ring carries a qualitative band for at-a-glance colour and wording — Excellent (rate ≥ 85), Good (≥ 70), Fair (≥ 50), or Low (< 50). Read these cut-offs for exactly what they are: a heuristic presentation layer that drives only the label and its colour, not part of the measurement. The 70 % cut loosely mirrors the CMS "≥ 70 % of nights" adherence convention, but the bands are a user-experience affordance, not a clinical classification. The grounded, auditable figure is the rate itself and its two component gates.',
          'Unlike the Therapy Index it replaces, the good-night rate invents no weights and blends nothing. The old index combined four normalized sub-scores (AHI, adherence, usage, leak) with fixed weights into a single opaque 0–100 composite; that mixed efficacy and adherence into one number whose value depended on product-chosen weightings rather than on anything a guideline defines. The good-night rate does none of that: it simply counts the nights that cleared two established clinical thresholds. It is easier to reason about, harder to game, and every input is a published clinical convention. It is still explicitly not a diagnosis, not a clinical severity grade, and not a validated instrument — treat it as a starting point that tells you which underlying metric to inspect, and rely on the AHI, adherence, usage, and leak figures on this same page for anything you act on. This tool does not diagnose.',
        ],
      },
      {
        heading: 'AHI calendar spine and monthly means',
        paragraphs: [
          "To the right of the verdict is a 12-month nightly-AHI calendar heatmap — one cell per night, coloured by that night's AHI using the same fixed clinical severity bands as the Sessions calendar and the Trends severity zones (Normal < 5, Mild 5–<15, Moderate 15–<30, Severe ≥ 30 events/h) — with a monthly-mean strip beneath it showing each calendar month's duration-weighted (pooled) AHI. This is the deck's longitudinal spine: it always covers a trailing 12 months regardless of the 30D/90D toggle, so seasonal drift, a stretch of missed nights, or a step change after a settings adjustment stays visible. As with every calendar in the app, missed nights and nights too short to yield an AHI are shown as distinct non-value states rather than being coloured or counted as 0.",
        ],
      },
      {
        heading: 'Alert cards',
        paragraphs: [
          'Below the calendar sits a short stack of alert cards: a handful of automatically generated, plain-language observations about the current window — for example an AHI trending up or down beyond a noticeable threshold, adherence above or below the CMS reference, or a mean usage that clears or falls short of the recommended target. They are ordered with warnings first, then neutral notes, then positive ones, and are capped at a few at a time so the panel stays a summary rather than a wall of text. These are descriptive prompts drawn from your own metrics, not clinical advice; use them as pointers to which panel or view to inspect next.',
        ],
      },
      {
        heading: 'Signal small-multiples rail',
        paragraphs: [
          'The small-multiples rail is a row of compact sparklines — one small multiple per signal — over the active 30D/90D window, so you can scan the recent trajectory of several signals side by side at the same time scale. It covers your core CPAP metrics and, when a wearable is connected, resting heart rate and heart-rate variability (HRV). Each cell is a quick-read trend, not a precise chart; open Trends for a full-resolution, interactive view with rolling statistics and severity zones. Where a signal has no data (for example the wearable lanes when no wearable is connected), the cell reads "—" rather than drawing a misleading flat line at zero.',
        ],
      },
      {
        heading: 'Distribution plots',
        paragraphs: [
          "The distributions row summarizes the shape of the window, not just its averages. The AHI histogram bins each night's AHI (with finer resolution across the clinically interesting low range and an open final bin for severe nights), so you can see whether your nights cluster tightly in the normal band or have a long right tail of bad nights that a mean would mask. The leak spread box plot summarizes the distribution of nightly median leaks — quartiles, with whiskers at the 2nd and 98th percentiles to trim lone outlier nights, and the min/max reported separately — giving a robust picture of typical nightly leak across the window. The per-night event mix shows the composition of scored events (obstructive, central, mixed, and hypopnea) so you can see which event types dominate — a rising central share, for instance, is worth following up in the TECSA panel and in Explore.",
          "A histogram or box plot summarizes only the nights that have a valid value for the metric; nights below the rate-validity floor contribute no AHI and are excluded rather than counted as 0, and the leak box plot describes nightly medians, so brief in-night leak spikes it cannot show are best inspected in a session's per-session leak chart.",
        ],
      },
      {
        heading: 'Wearable correlation lanes',
        paragraphs: [
          'When you have connected a wearable (an opt-in integration; no wearable data is fetched or stored unless you enable it), the deck adds a set of correlation lanes that align nightly resting heart rate, overnight SpO₂, and HRV against your therapy nights over the active window, so you can eyeball whether these physiological signals move with your CPAP metrics. If no wearable is connected, this panel is replaced by a short prompt explaining what connecting one would add, and the heart-rate and HRV cells elsewhere on the deck read "—". These lanes are exploratory context, not a clinical measurement, and visual co-movement is not causation — the Explore view has the dedicated correlation and event-triggered analyses for a rigorous look.',
        ],
      },
      {
        heading: 'Weather summary card',
        paragraphs: [
          'When the opt-in weather integration is enabled, the deck keeps a compact weather summary card that surfaces the overnight environmental conditions for your recent nights — overnight-low temperature, humidity, barometric (atmospheric) pressure, and air quality, each with a short trend and an "as-of" date stamp — as context alongside your therapy. It is a summary drawn from the fuller Weather Overview panel and the Signal-Viewer weather lanes; see the "Weather & Environment" help article for what is fetched, the privacy model, and how to read each figure. If the weather integration is disabled (the default), the card does not appear. As everywhere on the deck, any apparent link between an environmental figure and a therapy metric is exploratory context, not causation — the Explore → Correlations tooling is the place for a rigorous look.',
        ],
      },
      {
        heading: 'TECSA trajectory',
        paragraphs: [
          'TECSA — treatment-emergent central sleep apnea — is the phenomenon in which central apneas appear or persist after obstructive events are controlled by pressure therapy. The TECSA panel plots a long-horizon trajectory of the relevant central-apnea signal over a trailing 12 months (again independent of the 30D/90D toggle, because a treatment-emergent pattern only reveals itself over months), so a rising central component is visible as a trend rather than as the noise of any single night. It is a screening-oriented indicator to help you notice a pattern worth raising with your clinician; it is not a diagnosis of central sleep apnea, and only a sleep physician can make that determination.',
        ],
      },
      {
        heading: 'Session log',
        paragraphs: [
          'At the foot of the deck is a session log: a compact, chronological list of the nights in the active window, each with its key figures, as a quick index into recent therapy. Selecting a night takes you to its full session detail (event breakdown, pressure profile, leak statistics, and the high-resolution signal viewer). For sorting, filtering, calendar colouring, and page-by-page browsing across your whole history, use the Sessions view.',
        ],
      },
      {
        heading: 'Analysis window (30D / 90D)',
        paragraphs: [
          "The header carries a 30D/90D segmented toggle that sets the analysis window for the deck's window-following panels — the good-night rate, alert cards, small-multiples rail, distribution plots, wearable lanes, and session log all recompute when you switch it. The AHI calendar spine and the TECSA trajectory intentionally do not follow the toggle: they always span a trailing 12 months, as the deck's fixed longitudinal reference. For arbitrary custom ranges, presets beyond 90 days, or an all-time view, use the date range controls in Sessions and Trends.",
        ],
      },
    ],
  },

  // ─── SESSIONS GUIDE ───────────────────────────────────────────────
  {
    slug: 'sessions',
    title: 'Sessions Guide',
    summary:
      'How to browse sessions in the table or calendar view, read the calendar severity bands, and read the redesigned single-night detail page — the two-gate Night assessment verdict, the KPI grid with trailing 30-night baseline deltas, the embedded signal viewer, the respiratory-event breakdown and event clusters, the session-statistics panel, and the gated wearable and weather cards. Also: exploring signal data, measuring per-lane statistics over a region using the five analysis modes (Statistics, Variability, Trend, Distribution, and Selection), and comparing nights.',
    icon: 'sessions',
    sections: [
      {
        heading: 'Session list',
        paragraphs: [
          'The Sessions view shows all imported therapy sessions in a sortable, filterable table. Each row displays the date, usage hours, AHI, leak rate, and pressure summary. Click any column header to sort. Use the search bar to filter by date range or metric thresholds.',
          'Color indicators on each row reflect clinical status: green (excellent control), yellow (mild concerns), orange (moderate concerns), red (significant concerns). These thresholds follow AASM severity classifications.',
          'A page-size control lets you show 25, 50, or 100 nights per page; with more pages, a page jumper moves between them. Your choice of page size — like the calendar view and metric described below — is written into the URL, so a particular Sessions view is bookmarkable and shareable (the link reproduces the same view, metric, and page size when reopened) and survives a reload or browser back/forward.',
        ],
      },
      {
        heading: 'Calendar view',
        paragraphs: [
          'A Table ⇄ Calendar toggle at the top of the Sessions page switches between the table above and a calendar grid. The calendar lays out one cell per night in a GitHub-contribution-style grid (weeks as columns, days as rows), so patterns — a run of bad nights, a stretch of missed nights, a seasonal drift — stand out spatially in a way a paginated table cannot show. Rather than squeezing the whole date range into one strip, the calendar renders one panel per calendar year, stacked vertically with the oldest year at the top and each panel labelled with its year. Cells keep a fixed size at every time frame, so a short range shows a small neat grid and a multi-year range stacks cleanly instead of collapsing into an unreadable sliver; the All time preset shows just the years that contain data (empty leading and trailing years are trimmed, but an interior empty year is kept, because a multi-year therapy gap is itself meaningful). On a narrow or mobile viewport each year panel scrolls horizontally while its year and weekday labels stay in view. Click any night to open its session detail, exactly as clicking a table row does. The grid is keyboard-navigable: focus a cell and use the arrow keys to move between nights — including across year-panel boundaries — and press Enter to open the focused night.',
          "Each cell is coloured by one metric, which you choose from a selector: AHI, Usage hours, or Leak median. Switching the metric recolours the whole grid; the chosen metric is part of the URL (for example `/sessions?view=calendar&metric=leak`), so the view is shareable and is restored on reload. The colours are discrete clinical severity bands — a fixed green → amber → orange → red scale anchored to clinically meaningful thresholds — not a relative gradient stretched to fit the data on screen. This is deliberate: because the band edges are fixed (and are the same constants used by the table's AHI badges and the Trends severity zones), a given colour means the same thing on every night and across every date range, so you can compare nights directly by eye and a single colour always carries a clinical, not merely relative, meaning. A legend below the grid names each band and its numeric range, plus the two non-data markers described further down.",
        ],
      },
      {
        heading: 'Calendar — reading the colour bands',
        paragraphs: [
          'AHI (events per hour) — higher is worse. The bands follow the AASM / ICSD-3 severity classification used throughout the app: Normal, AHI < 5 (green); Mild, 5 to < 15 (amber); Moderate, 15 to < 30 (orange); Severe, ≥ 30 (red). AHI is the Apnea–Hypopnea Index, the number of apneas and hypopneas the machine scored per hour of recorded therapy; see the "AHI (Apnea-Hypopnea Index)" glossary entry for what it measures and its limitations. As always, a single night\'s AHI is statistically noisy — the calendar is best read for the pattern across many cells rather than any one night; the Trends AHI chart adds the rolling median and typical-nightly-range band for that purpose.',
          'Usage (hours per night) — higher is better, so this metric\'s colour ramp is inverted relative to the other two: low usage is red and high usage is green. The bands are: under 2h (red); 2 to < 4h (orange); 4 to < 6h (amber); and ≥ 6h (green). The 4-hour edge is the CMS compliance floor — the United States Medicare definition of an adherent night is at least 4 hours of use — and the 6-hour edge is the commonly recommended adherence target associated with fuller symptomatic benefit. See the "Usage Hours" and "Compliance" glossary entries for the precise definitions (usage measures mask-on therapy time, which is not the same as time asleep).',
          'Why missed nights matter, and why the calendar makes them visible: adherence is not only about how good your good nights are, but about how many nights you treat at all. A green AHI on the nights you use the machine tells you nothing about the nights you skip — and untreated nights carry the full, unmitigated apnea burden. Insurers and clinicians frequently assess adherence over a window (a common benchmark is use on at least 70% of nights, for at least 4 hours, over 30 consecutive days), so a scatter of missed nights can matter as much as the usage hours on the nights you do record. The calendar deliberately draws missed nights as a distinct, visible state (see below) precisely so these gaps are not invisible the way they are in a table that only lists the nights you have data for.',
          'Leak median (litres per minute) — lower is better. The bands are: < 6 (green); 6 to < 12 (amber); 12 to < 24 (orange); and ≥ 24 (red). The red edge is anchored on the ResMed large-leak threshold of roughly 24 L/min — a device convention (mask-dependent, not an AASM standard) above which leak is high enough to compromise both therapy delivery and the reliability of the machine\'s own event detection. The 6 and 12 edges are display subdivisions of the acceptable region and carry no formal clinical authority. See the "Mask Leak" glossary entry for what unintentional leak is and why it matters.',
        ],
      },
      {
        heading: 'Calendar — the leak-median caveat',
        paragraphs: [
          'The leak cell colours a night by its median (typical) leak, not by its worst moment. This makes the cell a robust summary of the night as a whole, but it has a specific blind spot you should know about: a night can be quiet for most of its duration and still have brief, severe leak spikes — a mask shifting during a position change, a few minutes of mouth leak — and those short excursions may not move the median enough to change the band. A green or amber leak cell therefore means the typical leak was fine, not that there were no large-leak episodes.',
          "When you want spike-level detail, do not rely on the calendar colour. Open the night's session detail and read the per-session leak chart, which shows leak over the course of the night, and the higher-percentile and exposure statistics — the P95 (the level exceeded only 5% of the night) and the time spent in large leak — which are designed precisely to surface brief excursions that a median hides. The calendar is for spotting nights and patterns; the per-session leak view is for understanding what happened within a night.",
        ],
      },
      {
        heading: 'Calendar — gaps and partial nights',
        paragraphs: [
          'Cells come in three states, each with a cue that does not rely on colour, so the calendar stays readable for colour-blind users and in any theme (WCAG 1.4.1). A filled cell — coloured in one of the severity bands above — is a night that has a value for the selected metric. The other two states are deliberately not coloured, because they are not "good" or "bad" values but the absence of one, and colouring them would be misleading.',
          'A gap (dashed, empty cell) is a missed night: there is no recorded session for that date at all — you did not use the machine, or its data was not imported. Gaps are drawn distinctly, rather than simply left blank, so that the holes in your adherence are visible (see "why missed nights matter," above). A gap is never coloured and never counted as a value; it is the absence of a night, not a night with a metric of zero.',
          'A partial night (neutral cell with a small glyph) is a night that has a recorded session, but for which the selected metric is unavailable. The most common reason is a too-short recording: AHI is a rate (events per hour), and on a recording too brief to compute a trustworthy rate the app declines to report an AHI rather than divide a tiny event count by a tiny duration and emit a wild or misleading figure. Crucially, an unavailable metric is shown as exactly that — unavailable — and never silently rendered as 0. A zero would read as a perfect night (no events, in the green Normal band) and would be a false reassurance; "no valid measurement" and "a measured value of zero" are different facts, and the calendar keeps them distinct. Hover or focus a partial cell to see why the metric is unavailable for that night.',
        ],
      },
      {
        heading: 'Session detail — the single-night view',
        paragraphs: [
          'Click any session — a table row, a calendar cell, or a night in the Dashboard session log — to open its detail view: the canonical surface for reviewing one night of therapy. The page reads top to bottom as a narrowing funnel. A header bar names the night (date, mask-on clock span, and machine) and carries Previous-/Next-night navigation and an Export-report action. Below it, a hero pairs a "Night assessment" verdict card with a grid of key-performance-indicator (KPI) tiles. Then come the embedded signal viewer, a respiratory-event breakdown and an event-cluster list, a full session-statistics panel, and — only when the relevant opt-in integrations are connected — a row of wearable and weather cards. A footer restates that the page is informational, not a diagnosis, and links to the raw data.',
          'One principle governs the whole page: every figure is mapped to real recorded data, and a value with no computed source is shown as an explicit gap (an em dash, "—") rather than approximated or filled with a zero. A zero and a missing measurement are different facts — a zero can read as a perfect night — so the page keeps them distinct everywhere. The same rule is why some numbers you might expect are deliberately absent; see "Honest gaps and omitted metrics," below.',
        ],
      },
      {
        heading: 'Session detail — the Night assessment verdict',
        paragraphs: [
          'The hero card is the Night assessment. It summarises the night through two independent, clinically-grounded gates — deliberately not a single blended "quality score." (The reasoning is recorded in the project\'s architecture decision on the two-gate verdict: a lone composite number would imply a precision the data does not have and would hide which dimension actually drove the result. A "72 out of 100" could equally mean "well-controlled but barely used" or "used all night but leaking badly," and those are opposite clinical situations.)',
          "The two gates are: Effective — the night's residual AHI (Apnea–Hypopnea Index, the scored apneas plus hypopneas per hour of mask-on time) was below 5 events/h, which is the American Academy of Sleep Medicine (AASM) boundary between the normal and mild residual bands; and Adherent — mask-on usage was at least 4 hours, the United States Centers for Medicare & Medicaid Services (CMS) per-night compliance floor. Each gate is shown on its own with a pass (✓) or fail (✗) mark, so you can always see which one held. Both thresholds are the same canonical constants used across the app (the AASM AHI severity bands and the CMS compliance hours), not numbers invented for this page — so if a clinical boundary is ever revised, this card and the Dashboard good-night rate move together.",
          'The two gates resolve to a single heuristic verdict word — never a number: Good night (both gates passed), Fair night (adherent only — used long enough, but residual AHI at or above 5), Partial night (effective only — well-controlled, but used under 4 hours), or Rough night (neither). Read the word as a rough, at-a-glance summary and read the two gate marks for what actually happened; the word is coarse by design and does not rank two Good nights against each other (an AHI of 0.5 and of 4.9 both clear the Effective gate). The verdict word and its colour are an explicitly heuristic presentation layer — a therapy-review affordance, not a medical assessment. This tool does not diagnose.',
          'If the night\'s AHI is unavailable — a recording too short to compute a trustworthy per-hour rate falls below the rate-validity floor and yields no AHI — the Effective gate cannot be confirmed and therefore does not pass. Critically, an unconfirmable gate is treated as "not passed," never quietly counted as a pass; a missing AHI can never inflate the verdict.',
        ],
      },
      {
        heading: 'Session detail — the KPI grid and baseline deltas',
        paragraphs: [
          "Beside the verdict is a grid of KPI tiles for the night's headline metrics: AHI (events/h), Usage (hours), Leak (the night's median unintentional leak, L/min), Pressure 95% (the 95th-percentile delivered pressure, cmH₂O), SpO₂ min (the night's oxygen-saturation nadir, %), and — when a wearable is connected — Resting HR (beats/min). Each tile shows the value in the night's own units, a small sparkline of the recent trajectory, and, where applicable, a severity badge (for AHI, the Normal/Mild/Moderate/Severe band).",
          'Under each value is a baseline delta: how this night compares to a trailing 30-night baseline, drawn as "▲" or "▼ vs 30-night." The baseline is the mean of the metric over roughly the preceding month of nights, computed by skipping missing nights rather than treating them as zero, so a run of gaps does not drag the baseline toward an artificial floor. The delta simply tells you whether the night sat above or below your recent normal; the arrow direction is neutral about good-versus-bad, because that depends on the metric (a ▼ on AHI or leak is an improvement, a ▼ on usage is not). Until enough prior nights exist to form a stable baseline, the tile reads "baseline building" or "no baseline yet" instead of showing a delta against too little history — the page will not manufacture a comparison it cannot support.',
        ],
      },
      {
        heading: 'Session detail — the embedded signal viewer',
        paragraphs: [
          'The Signals card embeds a compact, high-resolution waveform viewer directly in the page, reusing the same optimized rendering pipeline (Canvas drawing with LTTB / min–max decimation) as the full-page viewer, so it stays responsive even on a whole night of 25 Hz data. It stacks the core lanes — Flow, Pressure, Leak, and SpO₂ (when oximetry is present) — with channel chips to toggle lanes, a per-channel readout on hover, a whole-night minimap with a draggable view window, zoom presets (whole night / event cluster / breath detail), and wheel-zoom plus drag-pan. Scored events are marked on the lanes.',
          'The embedded viewer is for orientation and quick inspection within the night. For the complete experience — all channels, the Measure overlay and its five analysis modes, and the full toolbar — use the "Full explorer" link on the Signals card (or "Raw data →" in the footer), which opens the standalone signal viewer described in the following sections ("Signal viewer," "Measuring a region," and the Measure-mode sections). The event-cluster list also has "View in signal viewer" buttons that jump the viewer straight to a cluster\'s time window.',
        ],
      },
      {
        heading: 'Session detail — respiratory-event breakdown',
        paragraphs: [
          'The Respiratory events card decomposes the night\'s scored breathing events. A set of bars shows each event type with its per-hour rate and raw count: obstructive apnea, hypopnea, and central apnea are always listed (even at zero, because they are the primary AHI contributors), while mixed apnea, unclassified apnea, and RERA (respiratory effort-related arousal) appear only when they actually occurred. A per-type rate that is undefined for the recording shows "—" rather than a fabricated 0.',
          'Four summary figures sit below the bars. Longest apnea is the duration of the single longest apnea of the night (across the obstructive, central, mixed, and unclassified classes), with its type and clock time. Central fraction is the share of apneas that were central — central apneas divided by all apneas — shown as a percentage, or "—" when there were no apneas to divide (never a fake 0%); it is a descriptive ratio, not a diagnosis of central sleep apnea. RERA gives the count of respiratory effort-related arousals scored, and Flow limitation the count of flagged flow-limitation events. See the glossary for each of these terms and their limitations — in particular, device-scored central and RERA counts are lower-precision surrogates for what a full sleep study would score.',
        ],
      },
      {
        heading: 'Session detail — event clusters',
        paragraphs: [
          'Events rarely fall evenly across a night; they tend to bunch — during REM, in the supine position, or when pressure is momentarily inadequate. The Event clusters card surfaces those bunches. It lists runs of closely-spaced events, each with its clock window (start–end), the number of events, and a density in events per minute. Expand a cluster to see its individual events (time, type, duration) and a button to open that window in the signal viewer.',
          'Each cluster carries a relative intensity band — High, Medium, or Low — alongside a numeric severity score defined as the cluster\'s duration multiplied by its event density. Read this as an explicitly relative, within-night cue: the bands are scaled so the densest cluster of this night is "High," and they are always paired with the numeric score and a word label so colour is never the only signal. The bands rank clusters against each other on the same night; they are not a clinical severity grade and do not compare across nights. If the night\'s events were isolated rather than clustered, the card says so instead of inventing clusters.',
        ],
      },
      {
        heading: 'Session detail — the session statistics panel',
        paragraphs: [
          'The Session statistics panel is the full numeric readout for the night, grouped into four columns. Pressure lists the mean, median, 95th percentile, and maximum delivered pressure (cmH₂O), plus median EPAP — expiratory positive airway pressure — and, on bilevel machines, median IPAP and the pressure support (IPAP minus EPAP). Ventilation lists median tidal volume (mL), mean minute ventilation (L/min), median respiratory rate (breaths/min), and the flow-limitation event count. Leak lists the median, 95th-percentile (P95), and maximum unintentional leak (L/min), the time spent above the 24 L/min large-leak threshold, and the number of large-leak episodes.',
          'The Oxygenation & sleep column appears with real values only when the data exists. When the machine (or a connected oximeter) recorded SpO₂, it lists the mean and nadir saturation, the ODI (Oxygen Desaturation Index, desaturations per hour), the percentage of the night spent below 90% saturation, and the oximetry coverage (what fraction of the night was actually measured — a low coverage means the other oximetry figures rest on a short sample). Sleep efficiency is shown when a wearable supplies it. When no oximetry was recorded at all, the column says so plainly rather than showing zeros.',
        ],
      },
      {
        heading: 'Session detail — wearable and environment cards (gated)',
        paragraphs: [
          "When you have connected the opt-in wearable integration (Google Health / Fitbit) and it has data for the night, the detail page adds two cards. Sleep stages shows the night's time in Deep, Light, REM, and Awake as a proportion bar with per-stage minutes and percentages, plus the wearable's sleep efficiency. Physiology tonight lists resting heart rate, HRV (heart-rate variability, as RMSSD in milliseconds), the wearable's average and nadir SpO₂, and sleep efficiency. These are drawn from your wearable export and are context alongside therapy, not a clinical measurement; any apparent link between them and your CPAP metrics is exploratory, and the Explore view has the rigorous correlation tooling.",
          'When the opt-in weather integration is enabled, an Environment card shows the overnight conditions for the night — low and mean temperature, humidity, barometric (atmospheric) pressure, and air quality (US AQI). If weather is enabled but that particular night has not yet been synced, the card prompts you to sync rather than showing blanks. All of these cards are gated: if the integration is not connected, the card simply does not appear — the page never fabricates wearable or weather numbers to fill space. Both integrations are strictly opt-in and, like everything else, are processed and stored only in your browser.',
        ],
      },
      {
        heading: 'Session detail — honest gaps and omitted metrics',
        paragraphs: [
          'The detail page deliberately shows only metrics it can actually compute from your imported data, and marks anything genuinely missing with an em dash ("—") rather than a zero. A dash means "no value to show here"; a real measured zero is shown as 0. This distinction matters most for rate metrics on short recordings: a night too brief to yield a trustworthy AHI shows no AHI (and cannot pass the Effective gate) rather than a misleading near-zero rate.',
          'For the same reason, several figures you may have seen in other CPAP tools are intentionally absent, because the app does not derive them from the current data and will not approximate them: the I:E ratio (inspiratory-to-expiratory timing) and inspiratory time, a flow-limitation median (flow limitation is reported as an event count, not a median index), a single largest-leak timestamp, T90 expressed as minutes below 90% saturation (the panel reports the percentage of the night below 90% instead), an awakenings count, and pollen (the weather integration does not fetch it). Their absence is a correctness choice, not an oversight — the page would rather omit a number than present one it cannot stand behind. If a metric you expect is missing, that is why; the figures that are shown are the ones the data supports.',
        ],
      },
      {
        heading: 'Signal viewer',
        paragraphs: [
          'The signal viewer displays high-resolution waveform data recorded by your CPAP machine. Available channels include flow (breathing pattern), mask pressure, and leak rate. The viewer uses LTTB downsampling for smooth rendering of hundreds of thousands of data points.',
          'Click and drag to zoom into any time region. At full zoom, individual breaths are visible — you can identify apneas (flat-line flow), hypopneas (reduced amplitude), and flow limitation (flattened inspiratory shape). The signal viewer marks scored events with colored overlays.',
        ],
      },
      {
        heading: 'Measuring a region (per-lane statistics)',
        paragraphs: [
          "Measure mode summarises every lane over a time region at once. Turn it on with the Measure button in the toolbar, the M key, or by momentarily holding Alt while the pointer is over the plot to peek; it is off by default. Each numeric lane then gains a small chip showing four descriptive statistics of that lane over the region: the average (mean, $\\bar{x}$), the median ($\\tilde{x}$), the minimum, and the maximum. The hypnogram (sleep-stage) lane instead shows per-stage occupancy — the percentage of the region spent in each stage — and event-marker lanes show a count. A footer reports whether the figures describe the VIEWPORT or a pinned REGION, the region's clock span, and the sample count n.",
          'By default the region is the visible viewport — whatever is currently on screen — and the figures recompute once each time you finish panning or zooming (on settle, never mid-gesture, so scrolling stays smooth). To pin a fixed region instead, Alt(Option)+drag horizontally across the plot; a neutral dashed band marks it (distinct from the blue Shift+drag zoom band), and the statistics stay locked to that time span even as you pan and zoom away. Press Esc to clear a pinned region (a second Esc turns Measure off). Keyboard and screen-reader users can define a region without the mouse: move the data cursor (arrow keys) and press [ to set the start and ] to set the end. The per-lane figures are also exposed in a focusable "Region statistics" table for screen readers, and a concise summary is announced whenever the region changes.',
          'Why both mean and median? For symmetric, well-behaved signals the two nearly coincide. For right-skewed signals such as leak rate they diverge, and the difference is informative: the median is robust to brief spikes (a few seconds of mask-off or a cough barely move it), whereas the mean is pulled toward those extremes. The minimum and maximum bound the range — the most extreme valid samples seen in the region — and are useful for spotting a single excursion, but by construction they are the least robust figures shown. The sample count n is the statistical weight behind the figures: a region with very few samples (in the limit, n = 1) gives a median you should not over-read, while a region spanning many minutes at the recording rate gives a stable summary. For an extremely long region the median may be reported as a high-accuracy approximation (marked with a leading ~); the average, minimum, and maximum are always exact.',
          'Only physiologically valid samples are counted. Sensor dropouts, probe-off readings, and other non-physiological sentinel values are excluded from every statistic, so they cannot distort the mean or fake a minimum of zero. A lane with no valid samples in the region shows "—" rather than 0 — the em dash means "nothing to measure here," whereas a genuine measured zero is shown as 0. These are descriptive statistics of your own recorded data; the figures describe what was recorded over the region you chose and nothing more — this tool does not diagnose.',
        ],
      },
      {
        heading: 'Measure — switching analysis modes',
        paragraphs: [
          'The Measure overlay can summarise the region through five interchangeable analysis modes, each of which re-skins the per-lane chips (and the screen-reader "Region statistics" table) to show a different family of figures over the same region. The default mode, Statistics, is the four-number summary described above; the other four — Variability, Trend, Distribution, and Selection — are described below. Only the active mode is computed (and only on settle, never mid-gesture), so adding modes does not slow the viewer down.',
          'Switch modes with the `.` key (next) and the `,` key (previous); the two keys cycle through the five modes and wrap around, so you can spin through them quickly without leaving the keyboard. You can also click the segmented control in the region footer, which both selects a mode and shows which one is active. Your choice is remembered per session, so reopening the same night returns to the mode you last used. Across every mode the same honesty rules hold: a metric that does not apply to a given lane shows a dash (—) rather than a fabricated number, and only physiologically valid samples are counted. These remain descriptive statistics of your own recorded data — this tool does not diagnose.',
        ],
      },
      {
        heading: 'Measure — Variability mode',
        paragraphs: [
          'Variability mode describes how much each lane moves around its own typical level over the region, using three complementary figures. The first is the sample standard deviation ($s$), computed with the $n-1$ (Bessel-corrected) denominator — the conventional estimator of spread in the same units as the signal. See the "Standard Deviation" glossary entry for the definition; in short, a small $s$ means the lane was steady over the region and a large $s$ means it swung widely.',
          'The second is the coefficient of variation (CV), the standard deviation expressed as a fraction of the mean and shown as a percentage: $CV = s / |\\bar{x}| \\times 100\\%$. Because it is unitless, the CV lets you compare relative stability across signals measured on completely different scales — for example whether pressure or respiratory rate is, proportionally, the steadier signal over this region — in a way that comparing their raw standard deviations (one in cmH₂O, one in breaths/min) cannot. The CV is only meaningful for ratio-scale signals with a true zero and a mean comfortably away from zero. It is therefore suppressed (shown as a dash) for zero-mean signals such as raw flow — flow is held symmetric about zero, so its mean is near zero by construction and the ratio $s/|\\bar{x}|$ would blow up to a meaningless figure — and for SpO₂, whose 0–100% scale makes a percent-of-mean value clinically meaningless. See the "CV (Coefficient of Variation)" glossary entry for the full reasoning.',
          'The third is the interquartile range (IQR = $P_{75} - P_{25}$), the spread of the middle 50% of the samples. The IQR is the spike-robust companion to the standard deviation: a few brief excursions (a cough, a momentary mask-off) inflate $s$ but barely move the IQR, so when $s$ is large and the IQR is small you are looking at a quiet region punctuated by short spikes rather than a genuinely turbulent one. See the "IQR (Interquartile Range)" glossary entry for more.',
        ],
      },
      {
        heading: 'Measure — Trend (rate of change) mode',
        paragraphs: [
          'Trend mode answers "is this lane drifting over the region, and if so how fast and how trustworthily?". It fits an ordinary-least-squares line to the lane’s samples within the region and reports the slope per minute — the principled rate of change for a noisy signal. This is deliberately not the endpoint difference (last sample minus first sample): on a noisy signal the two endpoints are individually noise-dominated, so their difference is a poor estimate of the underlying drift, whereas the least-squares slope uses every sample and is far more stable. The slope is shown with an explicit sign (a leading + or −) and in the lane’s own units per minute.',
          'Alongside the slope, Trend reports the net change over the region (the modelled change from start to end), the percent change (that net change relative to the region mean, which gives a noise-stable base rather than dividing by a single possibly-extreme endpoint), and a direction label — rising, falling, or flat — for an at-a-glance read. A change is called flat when the slope is too small (or too uncertain) to assert a direction.',
          'Crucially, Trend also reports $R^2$, the coefficient of determination — the fraction of the lane’s variation that the fitted line explains, from 0 to 1. $R^2$ is the guard that tells you whether a trend is real or essentially noise: a steep slope with a low $R^2$ means the line is being pulled through a scatter that does not actually follow it, and should not be trusted as a trend; a slope with a high $R^2$ is a direction you can rely on. Always read the slope and $R^2$ together — neither alone is sufficient. See the "R² (Coefficient of Determination)" glossary entry for the definition.',
          'For irregularly-sampled wearable signals — heart rate, SpO₂ from a wearable — the slope is fitted against each sample’s real timestamp, not against an assumed uniform sample spacing. This matters because those signals are recorded at an uneven cadence; using the true times keeps the per-minute slope honest rather than distorting it by pretending the samples are evenly spaced.',
        ],
      },
      {
        heading: 'Measure — Distribution mode',
        paragraphs: [
          'Distribution mode shows the shape of the lane’s values over the region as a five-number percentile summary: the 5th, 25th, 50th (median), 75th, and 95th percentiles ($P_5$, $P_{25}$, $P_{50}$, $P_{75}$, $P_{95}$). Reading these together tells you where the bulk of the values sat (the central $P_{25}$–$P_{75}$ band), where the typical value was ($P_{50}$), and how far the tails reached without being dominated by a single extreme sample the way the raw minimum and maximum are. See the "Percentile" glossary entry for how percentiles are defined.',
          'This is the mode for questions about tails and asymmetry that a single mean cannot answer. For SpO₂, for instance, the $P_5$ shows how low the bottom 5% of the region’s saturation dipped — a far more informative read of desaturation exposure than the average, which a few good minutes can prop up. A wide gap between $P_{50}$ and $P_{95}$ on a leak lane reveals a right-skewed distribution with occasional high excursions even when the median looks fine.',
        ],
      },
      {
        heading: 'Measure — Selection (timing) mode',
        paragraphs: [
          'Selection mode is about the region itself rather than the signal values. The footer reports the region’s precise start and end timestamps and its exact duration to the millisecond, with a button that copies the timing to the clipboard — convenient for noting the span of an event or quoting it elsewhere. Each lane’s chip shows that lane’s effective sample rate (in Hz) and the number of samples it contributed to the region, so you can see the statistical weight behind every other mode’s figures at a glance.',
          'The mode is deliberately honest about precision. Region edges snap to sample boundaries, so the start and end times resolve only to the nearest sample — i.e. to a resolution of $1/\\text{sampleRate}$ for the lane in question; a 25 Hz CPAP lane resolves to 40 ms, a sparsely-sampled wearable lane only to its much coarser cadence. The sample rate shown also differs by source: CPAP lanes report their nominal recording rate (a fixed figure the device records at, such as 25 Hz for flow), whereas wearable lanes — whose sampling is irregular — report an effective or mean cadence computed from the actual sample timestamps, because there is no single fixed rate to quote. See the "Sample Rate" glossary entry for background.',
        ],
      },
      {
        heading: 'Measure — keyboard and screen-reader access',
        paragraphs: [
          'Every analysis mode is fully keyboard- and screen-reader-accessible. Cycle through the modes with the `,` (previous) and `.` (next) keys without touching the mouse. The footer’s segmented control is a standard radiogroup: move between modes with the arrow keys and select with Space or Enter, with the active mode announced politely so a change is not silent.',
          'The per-lane figures for the active mode are also exposed in a focusable "Region statistics" table, whose columns and cells re-label themselves for whichever mode is selected — so a screen-reader user reads exactly the same figures (standard deviation and CV in Variability, slope and $R^2$ in Trend, the percentile summary in Distribution, sample rate and count in Selection) that a sighted user sees on the chips. A concise summary is announced whenever the region or the mode changes.',
        ],
      },
      {
        heading: 'How each lane is scaled (the y-axis)',
        paragraphs: [
          'Each signal lane has its own vertical (y) axis with its own units — flow in L/min, pressure in cmH₂O, leak in L/min, SpO₂ in %, and so on. The lane fills the available height, so the same physical change looks different from lane to lane; always read the axis labels and gridlines, not the apparent size of a wiggle.',
          "Each lane starts from a clinically sensible default range and then expands outward only as far as that night's data requires — it never shrinks below the default. So a normal night shows the default range, and a night with a genuine excursion (say a large leak spike) widens just that lane to keep the whole excursion visible. The axis never shrinks to crop the data: nothing is drawn off-lane or flattened against the edge. This is a deliberate change from earlier versions, which scaled each lane to the range declared in the EDF file header. That declared range (sometimes called physicalMin/physicalMax) is a decode calibration anchor — the physical values that correspond to the raw encoding's extremes — not a display bound. Using it could clip real data that exceeded the declared range, or squash normal therapy into a thin band when the declared range was far too wide.",
          'Because the default range is fixed and the axis only ever grows, lanes stay stable and directly comparable from one night to the next: a flow trace of a given amplitude, or a leak at a given level, occupies the same vertical position on most nights, so you can scan across sessions and judge differences by eye. A night that needed a wider axis is the exception and is visibly so.',
          'A few lanes are scaled specially because their physiology calls for it. Flow is held symmetric about zero (inspiration positive, expiration negative), so the zero line stays centred. SpO₂ (blood-oxygen saturation, as a percentage) pins the top of its axis at 100% — saturation cannot exceed 100% — and expands only downward, so desaturations (dips below the normal range) are shown without ever implying an impossible value above 100%. A flow-limitation index, which is defined on a 0–1 scale, is held fixed at 0–1. To stop a single corrupt or implausible sample from blowing the axis out to an illegible scale, each signal also has a plausibility ceiling: values beyond it are clamped for the purpose of choosing the axis, rather than allowed to stretch it.',
          'The clinical default ranges currently in use are: flow ±60 L/min; mask pressure / EPAP / EPR 0–25 cmH₂O and IPAP 0–30 cmH₂O; leak 0–60 L/min; respiratory rate 0–30 breaths/min; tidal volume 0–1000 mL; minute ventilation 0–20 L/min; SpO₂ 85–100%; pulse rate 40–120 bpm; snore 0–1; flow limitation 0–1. These are display conventions chosen to frame typical therapy comfortably — they are not normal ranges or thresholds, and a value sitting high or low within a lane is not by itself a finding. One number worth knowing as you read the leak lane: ResMed treats roughly 24 L/min as the threshold for a "large" unintentional leak (a device convention, mask-dependent, not an AASM standard); the 0–60 L/min default simply gives that region room to be seen. The underlying recorded values are unchanged by any of this — only the vertical extent of each lane is. This tool is for analysis and does not diagnose; discuss anything that concerns you with your clinician.',
        ],
      },
      {
        heading: 'Session comparison',
        paragraphs: [
          'Select two or more sessions to compare side-by-side. The comparison view aligns metrics in a table for easy comparison and overlays trend data. This is useful for evaluating the effect of therapy changes (new mask, pressure adjustment, medication change) by comparing nights before and after the change.',
        ],
      },
    ],
  },

  // ─── STATISTICAL ANALYSIS ─────────────────────────────────────────
  {
    slug: 'statistical-analysis',
    title: 'Statistical Analysis',
    summary: 'Understanding the statistical methods, trend tests, and what the numbers mean.',
    icon: 'statistics',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          'The Statistical Analysis view applies rigorous statistical methods to your therapy data. Rather than just showing averages, it provides confidence intervals, trend significance, distributional analysis, and correlation matrices to help you understand patterns and make informed decisions.',
        ],
      },
      {
        heading: 'Descriptive statistics',
        paragraphs: [
          'For each metric, you will see: mean ($\\bar{x}$), median ($\\tilde{x}$), standard deviation ($s$), interquartile range (IQR), and key percentiles ($P_5$, $P_{25}$, $P_{75}$, $P_{95}$). These give a complete picture of both the central tendency and the spread of your data.',
          'The mean is the arithmetic average: $\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i$. The median is the middle value. When these differ substantially (common with AHI data), the distribution is skewed. In skewed distributions, the median often better represents the "typical" night than the mean.',
          'Missing data is treated as missing, not as zero. Pressure, leak, and respiratory statistics are computed only over samples that were actually recorded; gaps where the sensor produced no value are excluded rather than folded in as real zeros, which would otherwise bias means and percentiles downward. SpO₂-derived statistics are similarly computed over valid-oximetry time only (see oximetry coverage %).',
        ],
      },
      {
        heading: 'Trend analysis',
        paragraphs: [
          'Trend analysis determines whether your metrics are improving, worsening, or stable over time. CPAP Analyzer fits an ordinary-least-squares linear regression ($y = \\beta_0 + \\beta_1 x$) for the overall direction, tests the slope with a Student-$t$ test, and overlays a LOESS curve (Cleveland 1979) to reveal non-linear structure a straight line would miss.',
          'Results include the slope $\\hat{\\beta}_1$ (rate of change per day or week), the coefficient of determination $R^2$ (how much of the variation the linear fit explains), and the $p$-value for the slope (the statistical significance of the trend). A statistically significant downward AHI trend is good news — it suggests therapy is progressively improving. Because nightly metrics such as AHI are often right-skewed, weigh the LOESS curve alongside the straight-line slope rather than relying on the line alone.',
        ],
      },
      {
        heading: 'Distribution analysis',
        paragraphs: [
          'Histograms and box plots show the shape of your data distribution. Is AHI consistently low, or does it vary widely? Are there distinct "good night" and "bad night" clusters? The distribution view helps answer these questions visually.',
          "The Shapiro–Francia test checks whether your data follows a normal distribution, $f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$. Shapiro–Francia is the correlation-based variant of the Shapiro–Wilk family — it is the statistic CPAP Analyzer actually computes (a squared correlation between the ordered data and the expected normal order statistics), and it is well suited to that correlation form. This matters because some statistical methods assume normality: CPAP Analyzer reports the Shapiro–Francia result alongside the histogram and Q–Q plot and offers rank-based (non-parametric) alternatives — for example Spearman's $\\rho$ for correlation — so you can choose a method appropriate to your data's actual distribution.",
        ],
      },
      {
        heading: 'Correlation analysis',
        paragraphs: [
          'The correlation matrix shows relationships between metrics. For example: Is higher leak associated with higher AHI? Does AHI vary with usage hours? Correlations are displayed as a heatmap with Pearson ($r$) and Spearman ($\\rho$) coefficients.',
          'Important: correlation does not imply causation. A correlation between two metrics means they tend to move together, but not necessarily that one causes the other. Use correlations as starting points for investigation, not as conclusions.',
          'For directional questions, a Granger causality test asks whether the past of one series helps predict another beyond the series\' own past. Treat its results as exploratory: when you scan many metric pairs, the reported $p$-values are selection-affected (not corrected for multiple comparisons), and CPAP Analyzer now flags this. The test also assumes (weak) stationarity, so non-stationary inputs — for example a series with a strong trend or change point — are flagged because they can produce spurious "causality." Granger causality measures predictive precedence, not physiological cause, and is never on its own a basis for a clinical decision.',
        ],
      },
      {
        heading: 'Change point detection',
        paragraphs: [
          'Change point detection identifies dates when your data underwent a significant shift — perhaps a pressure adjustment, mask change, or clinical event. CPAP Analyzer uses the PELT algorithm (Killick et al. 2012) to find breaks in the mean level of a series; it does not currently test for changes in variance or slope on their own.',
          "Each detected change point reports the date, the metric affected, and the magnitude of the mean shift (the size of the level change, in the metric's own units — not a calibrated probability). You can annotate change points with notes about what happened on that date.",
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Tukey, J. W. (1977). Exploratory Data Analysis. Reading, MA: Addison-Wesley. — Interquartile-range fences for outlier detection and box plots.',
          'Shapiro, S. S., & Francia, R. S. (1972). An approximate analysis of variance test for normality. Journal of the American Statistical Association, 67(337), 215–216. DOI: 10.1080/01621459.1972.10481232. — The normality statistic CPAP Analyzer computes.',
          'Royston, P. (1993). A toolkit for testing for non-normality in complete and censored samples. The Statistician (Journal of the Royal Statistical Society, Series D), 42(1), 37–43. DOI: 10.2307/2348109. — Shapiro–Francia p-value transform.',
          'Cleveland, W. S. (1979). Robust locally weighted regression and smoothing scatterplots. Journal of the American Statistical Association, 74(368), 829–836. DOI: 10.1080/01621459.1979.10481038. — LOESS smoothing.',
          'Killick, R., Fearnhead, P., & Eckley, I. A. (2012). Optimal detection of changepoints with a linear computational cost. Journal of the American Statistical Association, 107(500), 1590–1598. DOI: 10.1080/01621459.2012.737745. — PELT change-in-mean detection.',
        ],
      },
    ],
  },

  // ─── INTERPRETING GRANGER CAUSALITY ───────────────────────────────
  {
    slug: 'interpreting-granger-causality',
    title: 'Interpreting Granger Causality',
    summary:
      'How to read the Granger Causality tab: predictive precedence vs. causation, directionality, the exploratory flag, non-stationarity, confidence, and the AIC-by-lag chart.',
    icon: 'statistics',
    sections: [
      {
        heading: 'What Granger causality is (and is not)',
        paragraphs: [
          'Granger causality answers a forecasting question, not a mechanistic one. It fits two nested vector-autoregression (VAR) models for the target metric Y: a restricted model using only Y’s own lagged history, $y_t = \\sum \\alpha_i y_{t-i} + \\varepsilon$, and an unrestricted model that also adds the lagged history of a second metric X, $y_t = \\sum \\alpha_i y_{t-i} + \\sum \\beta_i x_{t-i} + \\varepsilon$. An F-test then asks whether the X terms jointly improve the prediction (i.e. whether all $\\beta_i = 0$ can be rejected). If they do, X is said to "Granger-cause" Y — meaning the past of X has predictive precedence over Y.',
          'This is predictive precedence, not proof of physical causation. A lurking third variable — a behavior, an illness, a seasonal factor, or an equipment change that drives both series — can produce exactly the same pattern. Granger causality narrows down candidate relationships to investigate; it never establishes a mechanism on its own, and it is never by itself a basis for a clinical decision.',
        ],
      },
      {
        heading: 'Directionality: X→Y and Y→X are separate tests',
        paragraphs: [
          'The three statistics in the Directional detail panel — the F-statistic, the p-value, and the reported lag — describe the X→Y direction only: does the past of X help predict Y? The reverse question, does the past of Y help predict X, is a distinct test with its own F-statistic and p-value.',
          'The verdict and confidence shown at the top of the tab consider both directions; the directional statistics shown below them do not. The two directions can disagree — it is common for X→Y to be significant while Y→X is not, which is itself informative about which metric tends to lead.',
        ],
      },
      {
        heading: 'The "Exploratory p-value (lag auto-selected)" flag',
        paragraphs: [
          'In Exploratory mode the lag is chosen automatically by minimizing the Akaike Information Criterion (AIC) over the candidate lags — and then the F-test is run at that same lag on the same nights. When the data both chooses and tests the model, the resulting p-value is selection-affected: it is anti-conservative and understates the true false-positive rate, so causality is declared too readily. This is a post-selection inference problem (Leeb & Pötscher 2005), and CPAP Analyzer flags it rather than presenting such a p-value as a clean inferential quantity.',
          'Read a flagged result as hypothesis-generating, not confirmed. To obtain a clean inferential p-value, switch to Confirmatory mode and fix the lag in advance — ideally a lag chosen from prior knowledge or estimated on a separate stretch of nights, not read off the AIC chart for the very data you are testing.',
        ],
      },
      {
        heading: 'The non-stationarity caution',
        paragraphs: [
          'The VAR F-test assumes its inputs are at least trend-stationary — their mean does not drift systematically over time. CPAP nightly series often violate this (acclimatization, weight change, seasonal leak). When CPAP Analyzer detects a significant deterministic linear trend in either input series, it raises a non-stationarity caution naming the affected metric.',
          'This matters because a trend shared by two otherwise unrelated series can manufacture spurious Granger causality — the same mechanism behind spurious regression (Granger & Newbold 1974), where independent trending series appear strongly related. The usual remedy is first-differencing: analyze night-to-night changes ($\\Delta x_t = x_t - x_{t-1}$) instead of levels, which removes a linear trend and often restores stationarity before re-running the test.',
        ],
      },
      {
        heading: 'Confidence levels',
        paragraphs: [
          'The confidence chip summarizes the strength of evidence based on the more significant of the two directions: high when $p < 0.01$, moderate when $p < 0.05$, and low otherwise. Confidence is shown with a label and a dot indicator, not by color alone.',
          'Confidence reflects statistical strength only. A "high" confidence result that carries the exploratory flag is still selection-affected, and even a clean high-confidence result is predictive precedence, not proof of causation. Always weigh confidence together with the exploratory and non-stationarity flags.',
        ],
      },
      {
        heading: 'The AIC-by-lag chart',
        paragraphs: [
          'AIC (Akaike Information Criterion) scores each candidate lag’s model by balancing fit against complexity: $\\text{AIC} = n\\ln(\\text{RSS}/n) + 2k$, where lower is better. Only differences in AIC between lags are meaningful — it is a comparison tool, not an absolute measure of fit.',
          'Each point on the chart is the AIC for the unrestricted X→Y model at that lag. In Exploratory mode the lag with the lowest AIC is the one tested, marked by the reference line — which is precisely why that result’s p-value is selection-affected. Lags that cannot be fit because too few paired nights remain appear as gaps (infeasible lags), not as zero.',
        ],
      },
      {
        heading: 'Assumptions and limitations',
        paragraphs: [
          'The test assumes: (1) (trend-)stationary inputs — a significant linear trend triggers the non-stationarity caution; (2) roughly equal time spacing — CPAP Analyzer uses one value per night; and (3) a linear lagged relationship — purely non-linear dependence may be missed.',
          'Data requirements: the test needs at least $2 \\cdot \\text{maxLag} + 2$ paired nights (nights where both metrics have a finite value); below that threshold the result reports as insufficient data and you can reduce the max lag. A constant metric (no variation across nights) carries no information to test and cannot be used.',
          'Because the per-pair p-values are not corrected for multiple comparisons, scanning many metric pairs further inflates false positives — another reason to treat Exploratory findings as leads to confirm. CPAP Analyzer reports Granger results for exploration and does not diagnose.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Granger, C. W. J. (1969). Investigating causal relations by econometric models and cross-spectral methods. Econometrica, 37(3), 424–438.',
          'Granger, C. W. J., & Newbold, P. (1974). Spurious regressions in econometrics. Journal of Econometrics, 2(2), 111–120.',
          'Akaike, H. (1974). A new look at the statistical model identification. IEEE Transactions on Automatic Control, 19(6), 716–723. DOI: 10.1109/TAC.1974.1100705. — The Akaike Information Criterion used for lag selection.',
          'Leeb, H., & Pötscher, B. M. (2005). Model selection and inference: facts and fiction. Econometric Theory, 21(1), 21–59.',
        ],
      },
    ],
  },

  // ─── EVENT ANALYSIS ───────────────────────────────────────────────
  {
    slug: 'event-analysis',
    title: 'Event Analysis',
    summary: 'Event clustering, temporal patterns, false negatives, and survival curve analysis.',
    icon: 'events',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          'Event Analysis goes beyond counting events (AHI) to examine when, how, and why respiratory events occur. Understanding event patterns provides insights that a single AHI number cannot — event clustering, type distribution, and temporal patterns all have clinical significance.',
        ],
      },
      {
        heading: 'Event type breakdown',
        paragraphs: [
          'Events are categorized as obstructive apneas, central apneas, mixed apneas, and hypopneas. The distribution of event types matters: predominantly obstructive events respond well to CPAP pressure adjustments; predominantly central events may indicate complex sleep apnea or treatment-emergent central apnea requiring a different therapy mode.',
          'A pie chart and table show the proportion of each event type. Trend charts track how the mix changes over time — watch for an increase in central events after CPAP initiation.',
        ],
      },
      {
        heading: 'Event clustering',
        paragraphs: [
          'Events that cluster together in time are more disruptive than evenly spaced events. A burst of 10 events in one hour followed by 7 quiet hours is clinically different from 10 events evenly spread over 8 hours — even though the AHI is the same.',
          "The Event Explorer's clustering lens groups events that occur close together in time, with selectable sensitivity: strict (≥ 3 events separated by gaps under 1 minute), balanced (≥ 2 events within 2 minutes), and lenient (≥ 2 events within 5 minutes). Clusters concentrated in specific time windows may suggest positional or sleep-stage effects.",
        ],
      },
      {
        heading: 'Temporal patterns and time-to-event',
        paragraphs: [
          'Where events fall in the night matters as much as how many there are. Events concentrated in the first couple of hours can reflect ramp or acclimatization; events concentrated toward morning often track REM-dominant disease (REM periods lengthen in the second half of the night); events spread evenly suggest a pressure or positional cause present all night.',
          "The Event Explorer's inter-event-interval lens shows the distribution of time gaps between consecutive events: a peak at short intervals indicates clustering, while a long-tailed distribution indicates isolated events. Combined with the time-of-night filter, it answers questions such as “do my apneas cluster in the first two hours?”",
          'A related classical tool is the Kaplan–Meier estimator (Kaplan & Meier 1958), $\\hat{S}(t) = \\prod_{t_i \\leq t} \\frac{n_i - d_i}{n_i}$, where $n_i$ is the number still event-free (“at risk”) just before time $t_i$ and $d_i$ is the number of events at $t_i$ — it expresses the probability of remaining event-free as the night progresses. CPAP Analyzer retains the Kaplan–Meier primitive (with Greenwood-variance confidence intervals) for analyses that need it; the dedicated survival-curve view was retired when Event Analysis was reorganized into the Event Explorer, whose interval and clustering lenses answer the same temporal questions.',
        ],
      },
      {
        heading: 'Limitations',
        paragraphs: [
          'CPAP machines score events from airflow and pressure alone, using proprietary algorithms, and cannot detect EEG arousals. Device-reported AHI may therefore differ from manually scored polysomnography (PSG) — sometimes substantially, and in either direction — depending on the device, its scoring algorithm, and which hypopnea rule is applied. Polysomnography remains the diagnostic standard (Kapur et al. 2017); treat device-reported events as a monitoring and screening signal, not a diagnostic substitute.',
          'One specific consequence of flow-only scoring: an apnea the device cannot confidently classify as obstructive or central is reported as an unclassified apnea. It still counts toward AHI, but it is not folded into the obstructive, central, or mixed totals — most often this happens when high mask leak degrades the forced-oscillation measurement the device uses to tell central from obstructive.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172. — Definitions of obstructive, central, and mixed apnea, hypopnea, and RERA.',
          'Kapur, V. K., Auckley, D. H., Chowdhuri, S., et al. (2017). Clinical Practice Guideline for Diagnostic Testing for Adult Obstructive Sleep Apnea: An AASM Clinical Practice Guideline. Journal of Clinical Sleep Medicine, 13(3), 479–504. DOI: 10.5664/jcsm.6506. — Polysomnography is the diagnostic standard; device-derived event counts are a screening signal, not a diagnostic substitute.',
          'Kaplan, E. L., & Meier, P. (1958). Nonparametric estimation from incomplete observations. Journal of the American Statistical Association, 53(282), 457–481. DOI: 10.1080/01621459.1958.10501452. — The Kaplan–Meier estimator.',
        ],
      },
    ],
  },

  // ─── EVENTS BY SLEEP STAGE & CYCLE ────────────────────────────────
  {
    slug: 'events-by-sleep-stage',
    title: 'Analysing Events by Sleep Stage & Cycle',
    summary:
      'A new Event Explorer lens that correlates your apnea/hypopnea events with wearable sleep-stage data and intraday heart rate — REM-predominant OSA, per-cycle event load, and the cardiac response to events.',
    icon: 'events',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          'The "Sleep stages & cycles" lens in the Event Explorer asks where in the structure of your sleep your respiratory events fall. It overlays the apneas and hypopneas your CPAP machine scored onto the sleep-stage hypnogram imported from a wearable (Fitbit / Google Health), and onto your intraday heart rate, so you can see whether events concentrate in REM, in particular sleep cycles, or at specific times of night — and how your heart responds to each event.',
          'This lens requires a Google Health (Fitbit) import that contains sleep-stage data, and ideally intraday heart rate, for the same nights as your CPAP data. Without wearable staging, the lens has no hypnogram to align events to. Everything here is computed in your browser; no data leaves your device. Crucially, this is an exploratory analysis layer built on consumer-wearable estimates — it does not diagnose. Read it as a way to generate questions for your clinician, not answers.',
        ],
      },
      {
        heading: 'Sleep stages and the hypnogram',
        paragraphs: [
          'Sleep is not uniform. Across the night the brain cycles through distinct stages: Wake; REM (rapid eye movement) sleep, the dreaming stage marked by near-complete muscle atonia; and non-REM sleep, conventionally split into Light sleep (the AASM stages N1 and N2) and Deep, or slow-wave, sleep (stage N3). CPAP Analyzer displays four levels — Wake, REM, Light (= N1 + N2, because consumer wearables rarely separate them), and Deep (= N3). The step graph of these stages over the night is called a hypnogram.',
          'The stages differ in ways that matter for sleep apnea. REM relaxes the muscles that hold the upper airway open, so obstructive events in REM tend to be longer and to cause deeper oxygen dips; Deep N3 sleep is usually the most stable and arousal-resistant. The gold standard for staging is polysomnography (PSG), which scores 30-second epochs from the EEG, eye movements, and chin muscle tone (Berry et al. 2012). A CPAP machine cannot stage sleep at all — the stages here come entirely from the wearable, which infers them from heart rate, its variability, and movement. See the "Limitations & interpretation" section below for what that approximation costs.',
        ],
      },
      {
        heading: 'Sleep cycles, and how this tool derives them',
        paragraphs: [
          'A sleep cycle is one pass through the non-REM → REM progression: the night descends from light into deep non-REM sleep, rises into a REM episode, and then repeats. The cycle length is an ultradian rhythm of roughly 90 minutes (often cited as 90–120 minutes), so a full night contains about four to six cycles. The structure shifts across the night — Deep sleep dominates the early cycles, while REM episodes lengthen in the later ones, back-loading REM into the hours before waking (Feinberg & Floyd 1979).',
          'Because a wearable does not produce the cycle scoring a sleep technologist would, CPAP Analyzer derives cycles heuristically from the imported hypnogram. First it identifies REM episodes as maximal runs of REM, merging runs separated by gaps of 15 minutes or less so a brief interruption does not split one physiological REM period into two. It then defines each sleep cycle as the span from the end of one REM episode to the end of the next — following the classical convention that a cycle ends when a REM period ends. Any non-REM sleep that trails after the final REM episode is reported as an incomplete final cycle rather than discarded.',
          'This reproduces the textbook ~90-minute cadence and the across-night trends when the wearable staging is reasonable, but it is explicitly a heuristic over modeled stages — not PSG cycle scoring. It inherits every uncertainty of consumer-wearable staging, and a single missed or spurious REM episode shifts the cycle boundaries. Treat the cycle structure as an approximate scaffold for organising your events, not as a precise architecture.',
        ],
      },
      {
        heading: 'Events by stage: the per-stage rate and the χ² test',
        paragraphs: [
          'The first view reports the event rate per hour within each stage — apneas plus hypopneas scored during REM divided by hours of REM, and likewise for Light, Deep, and (where relevant) Wake. Comparing these rates directly is more informative than a raw count, because you naturally spend very different amounts of time in each stage.',
          'To ask whether the differences are real, the lens runs a chi-square (χ²) goodness-of-fit test. The categories are the sleep stages; the observed counts are the events scored in each stage; and the expected counts are proportional to the time spent in each stage — so the expected count for a stage is the total event count times that stage\'s share of staged time. The null hypothesis is therefore "events occur at the same rate per hour in every stage." The statistic is $\\chi^2 = \\sum_i (O_i - E_i)^2 / E_i$, summed over the stages, and under the null it follows a χ² distribution with degrees of freedom $\\mathrm{df} = k - 1$, one fewer than the number of stages.',
          "How to read it: a larger χ² means the observed counts depart further from what time-in-stage predicts; the p-value is the probability of a χ² at least that large under the null, so p < 0.05 is the usual signal that your per-stage event rates genuinely differ (most often, an excess in REM). The test is an omnibus test — it tells you that some stage differs, not which one, so pair it with the per-stage bar chart to see the direction. The key validity caveat is Cochran's rule: the χ² approximation is unreliable when expected counts are small, the common guideline being that all expected counts should be at least 5. A short night, or a stage with very little time, can leave too few expected events for the test to be trusted; CPAP Analyzer flags this rather than printing a spurious p-value.",
        ],
      },
      {
        heading: 'REM-predominant OSA: AHI_REM, AHI_NREM, and the ratio',
        paragraphs: [
          'Because REM atonia makes the airway most collapsible — and because the supine posture common late in the night compounds it (the classic "supine-REM" worst case) — many people have obstructive sleep apnea that is concentrated in REM. The lens quantifies this with two stage-specific indices: AHI_REM, the apnea–hypopnea index computed within REM time only, and AHI_NREM, the index within non-REM time only.',
          'The widely used literature definition of REM-related OSA is a ratio AHI_REM / AHI_NREM ≥ 2 (with AHI_NREM > 0). A stricter REM-predominant definition adds floors so the label is not driven by a sliver of REM or a near-zero NREM denominator: additionally AHI_NREM < 15/h, at least 30 minutes of REM sleep, and at least 15 minutes of NREM sleep (Conwell et al. 2012; Koo et al. 2008; Mokhlesi & Punjabi 2012). CPAP Analyzer reports the ratio and shows whether each floor is met. This matters clinically because REM events are often longer and desaturate more deeply, and because REM lengthens toward morning, so a REM-predominant pattern can mean your worst breathing falls in the hours before you wake.',
          "A single night with little REM can produce a wild ratio, so the lens also offers an across-nights Wilcoxon signed-rank test — the rank-based, non-parametric counterpart of a paired t-test — comparing each night's AHI_REM with that same night's AHI_NREM. It asks whether the REM excess is consistent across your nights rather than a one-night artifact, without assuming the (typically skewed) nightly differences are normally distributed. A small p-value there indicates a reliable, repeated REM-versus-NREM difference.",
        ],
      },
      {
        heading: 'Which cycles do events occur in?',
        paragraphs: [
          'Using the derived cycles, the lens shows the per-cycle event load — how many events, and at what rate, fall in cycle 1, cycle 2, and so on — and summarises the early- versus late-night distribution. Because REM episodes lengthen across the night, a REM-predominant pattern typically shows up as an event load that grows in the later cycles; an even spread across cycles instead points toward a positional or pressure cause present all night, and a front-loaded pattern can reflect ramp or acclimatisation effects.',
          "Read the per-cycle view alongside the stage view: they are two slices of the same structure. As with everything in this lens, the cycle boundaries are heuristic and the stage labels are wearable-derived, so compare the shape of the distribution across several nights rather than over-reading any single night's cycle count.",
        ],
      },
      {
        heading: 'Heart-rate response (cyclic variation of heart rate)',
        paragraphs: [
          'When intraday heart rate is available, the lens computes an event-triggered average heart rate: it aligns every respiratory event to a common time origin and averages the heart-rate trace in a window around it. This reveals the cyclic variation of heart rate (CVHR), the cardiac signature of sleep-disordered breathing first described by Guilleminault et al. (1984) — heart rate tends to slow during the apnea (bradycardia) and then surge upward (tachycardia) at event termination, when the arousal and resumption of breathing trigger a burst of sympathetic activity.',
          "The magnitude of that post-event tachycardia surge is the number to watch: it reflects the strength of the autonomic (sympathetic) arousal each event provokes, and hence how much cardiovascular stress accompanies your events. Averaging across many events is what makes the pattern visible even when any single event's heart-rate trace is noisy. Bear in mind that wearable heart rate comes from a wrist or ring photoplethysmographic (PPG) sensor with smoothing, latency, and roughly a 5-second sampling cadence — so the surge's shape and rough size are informative, but the exact beat-to-beat timing is not resolved as it would be from an ECG.",
        ],
      },
      {
        heading: 'Limitations & interpretation',
        paragraphs: [
          'Consumer-wearable sleep staging is approximate, not a measurement. Without EEG, eye-movement, and chin-muscle signals, the device cannot truly score N1/N2/N3/REM; it predicts them from heart rate, its variability, and motion. Independent validation finds stage-classification accuracy notably lower than PSG, with the largest errors at the N1 and N3 boundaries and degraded performance specifically in people with obstructive sleep apnea. A small misplacement of REM boundaries can move events between the REM and NREM buckets and swing the AHI_REM / AHI_NREM ratio across the 2.0 line. Read stage- and cycle-aligned numbers as trends across several nights with adequate REM, not single-night verdicts.',
          'The other inputs carry their own caveats. Device event scoring is flow-only and leak-sensitive, so weight low-leak nights more heavily. Optical (PPG) heart rate has latency and smoothing and a ~5-second cadence, which blurs the CVHR surge. Where SpO₂ appears at an event it is CPAP oximetry (if your machine records it), not the wearable. Time alignment between the CPAP and wearable records assumes both devices share the same wall-clock time for that import; a clock offset would shift events relative to stages.',
          'Finally, correlation is not causation: an association between a stage and your events does not establish that the stage causes them. This lens is an analysis and exploration tool — it does not diagnose. Treat a REM-predominant pattern, an uneven per-stage rate, or a large CVHR surge as a candidate finding to discuss with a qualified clinician, who can place it in the context of your full history. For the underlying measurement-reliability reasoning, see "Understanding Measurement Uncertainty"; for the event filters and other lenses, see "Event Explorer."',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172. — AASM epoch-based sleep-stage and respiratory-event definitions.',
          'Feinberg, I., & Floyd, T. C. (1979). Systematic trends across the night in human sleep cycles. Psychophysiology, 16(3), 283–291. DOI: 10.1111/j.1469-8986.1979.tb02991.x. — The ~90-minute NREM–REM cycle and its across-night trends; basis for the cycle-derivation heuristic.',
          'Guilleminault, C., Connolly, S., Winkle, R., Melvin, K., & Tilkian, A. (1984). Cyclical variation of the heart rate in sleep apnoea syndrome. The Lancet, 1(8369), 126–131. DOI: 10.1016/S0140-6736(84)90062-X. — Original description of cyclic variation of heart rate.',
          'Conwell, W., Patel, B., Doeing, D., et al. (2012). Prevalence, clinical features, and CPAP adherence in REM-related sleep-disordered breathing. Sleep and Breathing, 16(2), 519–526. DOI: 10.1007/s11325-011-0537-6. — REM-predominant OSA definition and floors.',
          'Koo, B. B., Patel, S. R., Strohl, K., & Hoffstein, V. (2008). Rapid eye movement-related sleep-disordered breathing: influence of age and gender. Chest, 134(6), 1156–1161. DOI: 10.1378/chest.08-1311. — REM-related OSA criteria.',
          'Mokhlesi, B., & Punjabi, N. M. (2012). "REM-related" obstructive sleep apnea: an epiphenomenon or a clinically important entity? Sleep, 35(1), 5–7. DOI: 10.5665/sleep.1570. — On denominator floors and clinical significance of the REM/NREM ratio.',
          'Pearson, K. (1900). On the criterion that a given system of deviations from the probable... Philosophical Magazine, Series 5, 50(302), 157–175. DOI: 10.1080/14786440009463897. — Chi-square goodness-of-fit statistic.',
          'Cochran, W. G. (1954). Some methods for strengthening the common χ² tests. Biometrics, 10(4), 417–451. DOI: 10.2307/3001616. — The expected-count (≥ 5) validity rule.',
          'Wilcoxon, F. (1945). Individual comparisons by ranking methods. Biometrics Bulletin, 1(6), 80–83. DOI: 10.2307/3001968. — The signed-rank paired test.',
        ],
      },
    ],
  },

  // ─── PRESSURE ANALYSIS ────────────────────────────────────────────
  {
    slug: 'pressure-analysis',
    title: 'Pressure Analysis',
    summary: 'Pressure-response relationships, titration insights, and APAP/BiPAP analysis.',
    icon: 'pressure',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          "Pressure Analysis helps you understand how your machine's pressure delivery relates to therapy effectiveness. This is especially valuable for APAP users, where the machine continuously adjusts pressure, and for evaluating whether a fixed CPAP setting is optimal.",
        ],
      },
      {
        heading: 'Pressure profile',
        paragraphs: [
          'The pressure profile shows the distribution of delivered pressures during each session. For fixed CPAP, this should be a single value (with EPR variation on exhalation). For APAP, it shows the full range of pressures the machine used, with key percentiles (P50, P90, P95).',
          'The pressure histogram reveals whether the machine spends most of its time at lower pressures (good airway stability) or frequently ramps to maximum (potential pressure inadequacy).',
        ],
      },
      {
        heading: 'Pressure-response relationship',
        paragraphs: [
          'An interactive scatter plot shows the relationship between delivered pressure and residual events. This helps answer: "At what pressure does my AHI reach its minimum?" and "Is my current pressure setting in the optimal range?"',
          'The analysis identifies the minimum effective pressure (lowest pressure with acceptable AHI) and the pressure plateau (above which additional pressure provides no further benefit).',
        ],
      },
      {
        heading: 'APAP utilization',
        paragraphs: [
          'For APAP users, this section shows how much of the allowed pressure range the machine actually uses. If P95 is consistently near Pmax, the upper limit may need to be increased. If P95 is consistently well below Pmax, the range is adequate.',
          'Time-at-pressure analysis shows what percentage of the night is spent at each pressure level. This data is commonly used by sleep physicians to determine an optimal fixed CPAP setting when transitioning from APAP.',
        ],
      },
      {
        heading: 'BiPAP/ASV analysis',
        paragraphs: [
          "For bilevel users, the analysis separately tracks IPAP and EPAP trends, pressure support (IPAP − EPAP), and the relationship between pressure support and event control. ASV-specific metrics include the machine's learned target ventilation and actual versus target minute ventilation. These metrics are descriptive: ASV is contraindicated in symptomatic heart failure with reduced ejection fraction (LVEF ≤ 45%) following the SERVE-HF trial (Cowie et al. 2015), and any change of therapy mode is a clinician decision, not one to make from these charts.",
          'The summary cards labelled "Mean EPAP" and "Mean IPAP" report the mean across nights of each night\'s median pressure (a mean of nightly medians) — not a grand median. They were previously labelled "Median EPAP/IPAP"; the relabel makes the statistic match what is computed. For a robust single-night central value, read the per-session pressure profile, which reports the within-night median and percentiles directly.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — In-lab and auto-titration, including use of the 90th/95th-percentile auto-adjusting pressure to derive a fixed CPAP prescription.',
          'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172. — Event definitions underlying the pressure–AHI response analysis.',
          'Cowie, M. R., Woehrle, H., Wegscheider, K., et al. (2015). Adaptive servo-ventilation for central sleep apnea in systolic heart failure (SERVE-HF). New England Journal of Medicine, 373(12), 1095–1105. DOI: 10.1056/NEJMoa1506459. — Safety caveat for ASV in heart failure with reduced ejection fraction (relevant to the BiPAP/ASV section).',
        ],
      },
    ],
  },

  // ─── REPORTS GUIDE ────────────────────────────────────────────────
  {
    slug: 'reports',
    title: 'Reports Guide',
    summary: 'How to generate, customize, and share therapy reports.',
    icon: 'reports',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          'The Reports view lets you generate comprehensive therapy reports suitable for sharing with your sleep physician, tracking progress over time, or keeping personal records. Reports are generated entirely in your browser — no data is sent to any server.',
        ],
      },
      {
        heading: 'Report templates',
        paragraphs: [
          'Choose from several report templates: Clinical Summary (concise overview for physicians), Detailed Analysis (comprehensive report with all metrics), Compliance Report (focused on adherence metrics for insurance), and Trend Report (focusing on changes over time).',
          'Each template can be customized: select which metrics to include, the date range, whether to include charts, and the level of statistical detail.',
        ],
      },
      {
        heading: 'PDF export',
        paragraphs: [
          'Generate a formatted PDF report with charts, tables, and clinical context. The PDF is created in your browser using jsPDF — no cloud service is involved. Reports include the date range, patient identifier (if configured), machine info, and all selected metrics with interpretive context.',
        ],
      },
      {
        heading: 'CSV export',
        paragraphs: [
          'Export raw data as CSV files for use in external analysis tools (Excel, R, Python, MATLAB). You can export session summaries (one row per night), detailed signal data (time-series), or statistical results. The CSV format preserves full precision.',
        ],
      },
      {
        heading: 'Data privacy in reports',
        paragraphs: [
          'Reports are generated locally and never leave your browser unless you explicitly save or share them. You can optionally encrypt PDF reports with a password before saving. Consider removing personal identifiers from reports before sharing.',
        ],
      },
    ],
  },

  // ─── SETTINGS GUIDE ───────────────────────────────────────────────
  {
    slug: 'settings',
    title: 'Settings Guide',
    summary: 'Customizing preferences, analysis parameters, and storage management.',
    icon: 'settings',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          'The Settings view lets you customize CPAP Analyzer to match your preferences, therapy configuration, and analysis needs. All settings are stored locally in your browser.',
        ],
      },
      {
        heading: 'Display preferences',
        paragraphs: [
          'Choose between light and dark themes. Both themes are designed for clinical data readability with WCAG AA contrast compliance. Select your preferred date format, number format, and time zone. Configure the dashboard layout and default date range.',
        ],
      },
      {
        heading: 'Analysis parameters',
        paragraphs: [
          'Configure the statistical analysis methods: rolling average window (7, 14, or 30 days), confidence interval level (90%, 95%, or 99%), and change point sensitivity. You can also set custom clinical thresholds for status indicators — for example, if your physician considers AHI < 3 as your personal target rather than the standard < 5.',
        ],
      },
      {
        heading: 'Storage management',
        paragraphs: [
          'View how much local storage your imported data occupies. CPAP Analyzer uses IndexedDB for structured data and the Origin Private File System (OPFS) for large signal files. You can selectively delete old data, export all data as a backup file, or clear all data to start fresh.',
        ],
      },
      {
        heading: 'Keeping your data safe (data persistence)',
        paragraphs: [
          'Because CPAP Analyzer is entirely client-side, your imported data lives in your browser\'s own storage (IndexedDB and OPFS) rather than on a server. Browsers keep that storage in one of two modes. The default is "best-effort": the browser is allowed to automatically evict — silently delete — site data to reclaim space when the disk runs low, when the browser is configured to "clear data on exit," or during routine cleanup. This is the most common cause of unexpected data loss, and it is most often seen on Chrome on Windows; the symptom is opening the app to an empty database, or a "database connection is closing" error part-way through a session.',
          'To prevent that, CPAP Analyzer asks the browser for "persistent" storage when it starts. Persistent storage opts your data out of automatic eviction — the browser will not discard it to free space. The Storage Usage panel above shows a "Data persistence" indicator with the current state: "Protected" means the browser has granted persistence and your data is safe from automatic eviction; "Not protected" means your data is still in best-effort storage and could be evicted. Requesting persistence is entirely local — it is a request to your own browser and sends nothing anywhere; no network connection is made.',
          'If the indicator shows "Not protected," use the "Protect my data" button to ask the browser again. Note that some browsers — Chrome in particular — do not grant persistence on request alone: they apply a heuristic based on how "engaged" you are with the site. The most reliable ways to satisfy it are to bookmark CPAP Analyzer (or install it to your home screen / as an app) and to use it regularly; once those signals accumulate, a later request is usually granted. Regardless of persistence state, the safest backstop is to export your data to a file periodically (Storage management, above) — an export is a snapshot you control that survives whatever the browser does with its cache, and it lets you re-import on a new device or browser profile. Persistence protects only against the browser\'s *automatic* eviction; it does not prevent you (or a manual "clear browsing data") from deleting the data yourself, and it applies only to the current browser profile on the current device. See the "Persistent Storage" glossary entry for the full technical detail.',
        ],
      },
      {
        heading: 'Machine configuration',
        paragraphs: [
          'Set your machine type, therapy mode, and mask type so that CPAP Analyzer can provide more accurate interpretive context. This information is used only locally for analysis and is not transmitted anywhere.',
        ],
      },
    ],
  },

  // ─── CLINICAL REFERENCE ───────────────────────────────────────────
  {
    slug: 'clinical-reference',
    title: 'Clinical Reference',
    summary: 'AASM guidelines, severity classifications, treatment goals, and clinical context.',
    icon: 'clinical',
    sections: [
      {
        heading: 'AASM severity classifications',
        paragraphs: [
          'The American Academy of Sleep Medicine (AASM) classifies obstructive sleep apnea severity based on the Apnea-Hypopnea Index (AHI): Normal (AHI < 5 events/hr), Mild (5 ≤ AHI < 15), Moderate (15 ≤ AHI < 30), Severe (AHI ≥ 30). These thresholds are used globally for diagnosis and treatment decisions.',
          'Severity classification guides treatment approach: Mild OSA may be treated with lifestyle modification, positional therapy, or oral appliances. Moderate to severe OSA typically requires CPAP or bilevel therapy. Surgical options exist for select patients.',
        ],
      },
      {
        heading: 'Treatment goals',
        paragraphs: [
          'The primary treatment goal is to reduce the residual AHI to below 5 events/hr — functionally normalizing breathing during sleep. Additional goals include: maintaining SpO₂ > 90% throughout the night, eliminating snoring, achieving usage of ≥ 4 hours/night (ideally ≥ 6 hours), and reducing daytime symptoms (sleepiness, fatigue, cognitive impairment).',
          'Therapy success is dose-dependent: more hours of use per night and more nights per week yield greater clinical benefit. In the Weaver et al. (2007) dose-response study, subjective sleepiness normalized near 4 hours of nightly use, objective alertness near 6 hours, and daily functioning near 7.5 hours — there is no single threshold above which benefit abruptly stops. Reported benefits of consistent therapy include reduced blood pressure, improved daytime alertness and cognition, reduced accident risk, and improved quality of life.',
        ],
      },
      {
        heading: 'Compliance standards',
        paragraphs: [
          'Medicare and most insurance companies define CPAP compliance as usage of ≥ 4 hours per night for ≥ 70% of nights (21 out of 30 consecutive days). This threshold was established for administrative purposes but is below the level needed for full clinical benefit.',
          'Non-compliance within the initial 90-day trial period may result in loss of insurance coverage for CPAP equipment. If compliance is a concern, early intervention (mask refitting, pressure adjustment, behavior coaching) is recommended.',
        ],
      },
      {
        heading: 'Leak management guidelines',
        paragraphs: [
          'A common acceptability threshold for unintentional mask leak is < 24 L/min — but note this is a ResMed device/manufacturer convention (the "large leak" red line), not an AASM clinical standard, and it is mask-dependent (ResMed cites roughly 36 L/min for some full-face/oronasal masks). Leak above the flagged threshold can cause inaccurate event scoring by the machine, inadequate pressure delivery, dry mouth and eyes, aerophagia (air swallowing), and sleep disruption.',
          'Common causes of excessive leak: incorrect mask size, a worn mask cushion (manufacturers typically recommend replacing cushions on a regular schedule — often every 1–6 months depending on the cushion type), mouth opening during sleep (consider a chin strap or full-face mask), and sleeping positions that displace the mask.',
        ],
      },
      {
        heading: 'When to consult your physician',
        paragraphs: [
          'Review your data with your sleep physician if: residual AHI consistently > 10, significant increase in AHI from baseline, emergence of central apneas (Central AI > 5), SpO₂ nadirs < 80%, compliance consistently below 70%, or new symptoms despite therapy.',
          'CPAP Analyzer provides data analysis tools — it is not a diagnostic device and does not provide medical advice. All clinical decisions should involve your healthcare provider.',
        ],
      },
      {
        heading: 'Disclaimer',
        paragraphs: [
          'CPAP Analyzer is intended for informational and educational purposes only. It is not a medical device and is not FDA-cleared for diagnostic or therapeutic use. The analysis provided should not be used as a substitute for professional medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider with questions about your sleep apnea therapy.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — AASM severity classification (Normal/Mild/Moderate/Severe) and treatment goals.',
          'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172. — Apnea, hypopnea (recommended ≥3% desaturation or arousal; acceptable ≥4%), and RERA scoring definitions.',
          'Weaver, T. E., Maislin, G., Dinges, D. F., et al. (2007). Relationship between hours of CPAP use and achieving normal levels of sleepiness and daily functioning. Sleep, 30(6), 711–719. DOI: 10.1093/sleep/30.6.711. — Dose-response: sleepiness normalizes near 4 h, objective alertness near 6 h, daily functioning near 7.5 h.',
          'Centers for Medicare & Medicaid Services. Local Coverage Determination L33718: Positive Airway Pressure (PAP) Devices for the Treatment of Obstructive Sleep Apnea. — Adherence defined as ≥4 h/night on ≥70% of nights over a consecutive 30-day period within the first 90 days.',
          'Cowie, M. R., Woehrle, H., Wegscheider, K., et al. (2015). Adaptive servo-ventilation for central sleep apnea in systolic heart failure (SERVE-HF). New England Journal of Medicine, 373(12), 1095–1105. DOI: 10.1056/NEJMoa1506459. — Increased cardiovascular mortality with ASV in heart failure with reduced ejection fraction (LVEF ≤ 45%).',
          'ResMed. Unintentional leak is flagged as a large leak at 24 L/min (device/manufacturer convention; some oronasal masks use ~36 L/min). This is a device threshold, not an AASM clinical standard.',
        ],
      },
    ],
  },

  // ─── BREATHING PATTERNS ───────────────────────────────────────────
  {
    slug: 'breathing-patterns',
    title: 'Breathing Patterns: Periodic Breathing, Cheyne-Stokes & TECSA',
    summary:
      'How CPAP Analyzer detects periodic breathing, Cheyne-Stokes respiration, and treatment-emergent central sleep apnea — methods, defaults, confidence, and the clinical caveats that frame every result.',
    icon: 'clinical',
    sections: [
      {
        heading: 'What these patterns are',
        paragraphs: [
          'Periodic breathing (PB), Cheyne-Stokes respiration (CSR), and treatment-emergent central sleep apnea (TECSA, also called complex sleep apnea or CompSA) are three faces of the same underlying problem: an unstable respiratory control loop. Healthy breathing is regulated by chemoreceptors that sense arterial CO₂ and adjust ventilation to keep it near a setpoint. When the control loop has high gain — meaning a small change in CO₂ provokes a large ventilatory response — the system overshoots, drives CO₂ below the apneic threshold (the CO₂ level below which the brainstem stops issuing inspiratory drive), and a central apnea results. Ventilation then resumes, CO₂ rebuilds and overshoots, and the cycle repeats. The three patterns differ in how that instability manifests, not in their root mechanism.',
          'Periodic breathing (PB) is the umbrella term: a repeating cycle of waxing and waning tidal volume that may or may not include frank central apneas. It can appear at altitude, in heart failure, on opioids, in some neurological conditions, and idiopathically.',
          'Cheyne-Stokes respiration (CSR) is a specific morphology of PB defined by a crescendo-decrescendo envelope around each central apnea (breaths grow louder/deeper, then quieter/shallower into the apnea), with cycle lengths of 40–120 s (typically 45–90 s). Per AASM scoring, a CSR run requires ≥3 consecutive central apneas separated by crescendo-decrescendo breathing; at the session level the standard further requires either ≥5 central events per hour or ≥2 hours of cyclic pattern. CSR is most often seen with congestive heart failure but also occurs after stroke and in some renal disease.',
          'TECSA (treatment-emergent central sleep apnea) is a longitudinal pattern, not a per-night one: predominantly obstructive breathing at diagnosis converts to predominantly central breathing once CPAP is started, then often resolves on its own as the patient adapts. The widely cited Liu et al. 2017 cohort of ~133,000 patients identifies four such trajectories — obstructive (stable), transient (central early, resolves), persistent (central throughout), and emergent (obstructive at first, central later). TECSA is operationally defined when the central-apnea index (CAI) crosses a threshold (commonly 5/h) on therapy.',
          'How these differ from obstructive events matters for what the data look like. In an obstructive apnea the airway is closed but respiratory effort continues — flow stops while chest and abdominal motion persist. In a central apnea both flow and effort stop — the brain is not asking for a breath. ResMed machines distinguish the two by briefly modulating mask pressure during an apnea (forced oscillation technique, FOT) and listening for an airway response; an open airway implies central, a closed airway implies obstructive. PB and CSR are populations of central events with cyclic morphology, not a separate event type.',
        ],
      },
      {
        heading: 'Why this matters — and why it is not a diagnosis',
        paragraphs: [
          'CSR has a recognized association with reduced cardiac function. Studies of CSR cycle length consistently find that longer cycles track lower cardiac output and worse heart-failure severity: the cycle length is roughly twice the lung-to-chemoreceptor circulation time, which lengthens as cardiac output falls (Midelet et al. 2023; Javed et al. 2018). The presence of CSR on a CPAP report is therefore a candidate signal that warrants conversation with a clinician — particularly if it is new, sustained, or progressive. It is not a heart-failure diagnosis. Many causes are possible, and a cardiac evaluation is the appropriate next step if a clinician thinks the signal warrants one.',
          'TECSA, despite its alarming name, is most often self-limiting. Across the literature, somewhere on the order of 60–80% of patients with treatment-emergent central events show spontaneous resolution within roughly the first three months of continued CPAP as the respiratory control loop re-adapts (Nigam et al. 2016 systematic review; Kwok et al. 2022). The Liu et al. 2017 trajectory model exists precisely to distinguish patients who will resolve from those who will not — which is why we surface the trajectory rather than a single yes/no label.',
          'The single most important clinical caveat: do not self-prescribe adaptive servo-ventilation (ASV) on the basis of CSR or central-apnea findings here. The SERVE-HF randomized trial (Cowie et al. 2015) showed increased all-cause and cardiovascular mortality with ASV in patients who had symptomatic chronic heart failure with reduced ejection fraction (LVEF ≤ 45% with predominantly central sleep apnea); on the strength of that trial, ASV is contraindicated in this group. Adjusting therapy mode — particularly moving to ASV — is a clinician decision informed by echocardiography and the full clinical picture, not by a software flag. CPAP Analyzer surfaces candidate patterns for discussion; it does not diagnose, does not recommend therapy changes, and does not classify ejection fraction.',
        ],
      },
      {
        heading: 'What ResMed flags — and what it does not',
        paragraphs: [
          'ResMed machines apply forced oscillation technique (FOT) during apneas to classify them as ClearAirway (central) or obstructive, and they include an on-device CSR detector that flags a CSR run when it observes ≥15 consecutive minutes of cyclic crescendo-decrescendo breathing with cycle length in the 40–120 s band. These flags are conservative and binary: they fire only above the device-internal thresholds and surface no morphology — no cycle length, no modulation depth, no graded confidence.',
          'What the device does not surface, and what CPAP Analyzer adds: sub-threshold periodic breathing (cyclic envelopes that do not reach the device CSR criterion), short CSR runs (shorter than the 15-minute device floor), the morphology of each candidate episode (cycle length, modulation depth, crescendo-decrescendo shape score), and the cross-night TECSA trajectory. These are computed in-browser from the same raw data the device already records; nothing leaves your machine.',
        ],
      },
      {
        heading: 'How CPAP Analyzer detects PB and CSR',
        paragraphs: [
          'PB and CSR detection runs per-session on the airflow / minute-ventilation envelope, not on raw 25 Hz flow. Breaths are segmented from the flow signal, then summarized into a per-breath envelope (tidal volume or minute ventilation). The envelope is the substrate every literature-validated single-channel method works on (Weinreich et al. 2009; Javed et al. 2018; Guyot et al. 2020; Midelet et al. 2023). No esophageal or respiratory-effort belt is required, and CPAP data does not provide one.',
          'Periodicity is established by autocorrelation of the envelope. A dominant lag in the 40–120 s band, with a sufficiently sharp peak, is the necessary signature of cyclic ventilation. The modulation index — a Guyot-style measure on $[0, 1]$ of how strongly the envelope oscillates relative to its mean — is the primary confidence basis: a near-flat envelope scores near $0$, a deeply modulated cyclic envelope scores near $1$.',
          'Morphology — the crescendo-decrescendo shape that distinguishes CSR from generic oscillation — is scored separately with a harmonic-ratio measure: the fraction of in-band spectral energy concentrated at the fundamental cycle frequency, $\\text{HR} = E_{\\text{fundamental}} / E_{\\text{in-band total}}$. A pure crescendo-decrescendo waveform is nearly sinusoidal at its fundamental and scores high; a noisy or non-sinusoidal cyclic envelope scores lower. This separates CSR-shaped runs from other periodic patterns.',
          'CSR is then scored against the AASM morphology criteria: a candidate run requires ≥3 consecutive central events with crescendo-decrescendo envelopes between them and a cycle length ≥40 s (typically 45–90 s). The session-level criterion — ≥5 central events per hour over ≥2 hours of cyclic pattern, the threshold ResMed uses internally — is computed and reported as a separate boolean field, `sessionCriterionMet`, so that short or borderline runs are not silently promoted to a session-level CSR label. Device `ClearAirway` flags are used to anchor the cycle nadirs of each candidate run, which both improves boundary accuracy and reduces false positives on flow artifacts.',
          'Sub-threshold periodic breathing (PB without sufficient central events to meet CSR) and short CSR runs that fall below the device 15-minute floor are surfaced explicitly as "candidate / below device threshold," not silently dropped and not promoted to formal flags. The distinction is preserved in the rendering: device-asserted CSR shows one way, computed candidates show another. (See "How to read these in the app" below.)',
          'Every detection carries a confidence on $[0, 1]$ with discrete bands. The confidence integrates the modulation index, the harmonic ratio, the cycle-length plausibility, and the alignment with `ClearAirway` events. SpO₂ desaturation coupling, when wearable oximetry data is available, can corroborate but is never required (see Intraday Health Signals & Overlays for what coupling looks like, and how strong it tends to be around CSR cycles).',
        ],
      },
      {
        heading: 'How CPAP Analyzer classifies TECSA',
        paragraphs: [
          'TECSA classification is longitudinal — it operates over many nights, not within a single session. The implementation follows the four-class trajectory model of Liu et al. 2017 (Chest, DOI 10.1016/j.chest.2017.06.010), the largest published study of treatment-emergent central apnea trajectories (≈133,000 patients). A nightly central-apnea index (CAI) is compared across an early treatment window and a late treatment window; the combination of below- vs. above-threshold CAI in each window assigns the user to one of four classes:',
          '• Obstructive (stable): CAI below threshold in both windows — predominantly obstructive breathing throughout, the expected response to CPAP.',
          '• Transient (TECSA, self-limiting): CAI above threshold in the early window, below in the late window — the most common TECSA pattern, consistent with the ~60–80% spontaneous-resolution literature.',
          '• Persistent (central): CAI above threshold in both windows — central physiology present from the start and continuing.',
          '• Emergent: CAI below threshold in the early window, above in the late window — central events appearing late in therapy.',
          'The default CAI threshold is 5/h (the conventional cutoff used by Liu et al. and reflected in the AASM CSA definition), and the default early/late windows are configurable. Nights with high leak are excluded from the classifier because FOT-based central/obstructive classification is degraded under large leak — a corrupted ClearAirway count would otherwise contaminate the trajectory. Each class assignment carries a confidence reflecting the number of usable nights in each window and the separation between the early and late CAI distributions; sparse or short histories yield an explicit "insufficient data" outcome rather than a guess.',
          'All TECSA output is a candidate trajectory label, never a diagnosis, never a prescription. In particular, a Transient or Emergent label does not on its own justify a switch to ASV — see the SERVE-HF caveat above.',
        ],
      },
      {
        heading: 'All thresholds are configurable',
        paragraphs: [
          'Every numeric threshold mentioned above is exposed as a configurable parameter, defaulted to the cited literature value: the cycle-length band (40–120 s, with the 45–90 s "typical" band as a sub-parameter), the minimum consecutive central events for CSR (3), the modulation-index threshold for candidate vs. confirmed, the harmonic-ratio threshold for crescendo-decrescendo morphology, the session-level CSR rate (5/h) and duration (2 h) gates, the TECSA CAI threshold (5/h), the early/late window definitions, and the leak threshold above which a night is excluded from TECSA. Because detection runs on-demand via the analysis layer — not at import time — changing a threshold takes effect immediately, with no re-import required. (This is a deliberate architectural choice; see ADR 0017.)',
        ],
      },
      {
        heading: 'How to read these in the app',
        paragraphs: [
          'In the per-session signal viewer, computed PB and CSR episodes are drawn as overlay bands distinct from device-asserted events: a hatched fill pattern marks computed detections, a confidence chip annotates each band, and dashed boundaries denote candidate / below-threshold episodes. Device-asserted CSR runs use the existing solid event styling. The provenance is never ambiguous — a band that originated from the device cannot be confused with one this app computed, and vice versa. (For an overlay walk-through and what the wearable-overlay context adds — including HR elevation around central events and the characteristic desaturation lag — see Intraday Health Signals & Overlays.)',
          'A dedicated Breathing view collects the longitudinal TECSA trajectory plot (CAI per night with early/late windows shaded), the episode catalog (every detected PB/CSR run with its cycle length, modulation depth, harmonic ratio, confidence, and a deep link that opens its source session in the Signal Viewer with the whole episode framed end to end), and the threshold controls (so a parameter change can be inspected immediately). The catalog analyzes the full date range you select — there is no per-page night limit; selecting "all time" on a multi-year history analyzes every night in it. A Dashboard "Breathing Stability" insight card surfaces the headline state — quiet, isolated candidate episodes, persistent PB, or a TECSA trajectory worth discussing — without ever asserting a diagnosis. A future Trends lane will show cycle-length over time, which is the signal most directly tied to circulation time in the cardiac-output literature.',
          'When using the Event Explorer to slice respiratory events by type, computed PB/CSR candidates carry their own filterable type tag and a hatched marker that distinguishes them from device-flagged PeriodicBreathing — so a query for "all PeriodicBreathing events" can be scoped to device-asserted, to computed candidates, or to both.',
        ],
      },
      {
        heading: 'Using the episode catalog (caching, streaming, and how to read the columns)',
        paragraphs: [
          'The episode catalog runs the PB/CSR detector described above once per night across every session in the date range you select, then lists each candidate episode as a row. Because the detector is run per night and the airflow signal it reads lives in browser storage, analyzing a long range is real work: each night costs roughly 150–300 ms, so a first-ever "all time" run over a multi-year history can take from many seconds to a few minutes. After that first run it is effectively instant — see the caching note below.',
          'Results are cached locally so you only pay that cost once. When a night is analyzed, its detection result is saved to a local on-device cache (an IndexedDB store inside your browser — the same private, in-browser storage your sessions already live in). A "cache" here simply means previously computed results kept on hand so they do not have to be recomputed. Nothing is uploaded; the cache never leaves your device, exactly like the rest of your data. Revisiting the same range later — or after a page reload — reads the saved results back near-instantly instead of re-deriving them from the raw airflow signal.',
          'Analysis runs in two phases, and the catalog tells you which one you are in. First, "Reading saved analysis…" reads any nights already in the cache; this is fast and is all that happens on a revisit of an already-analyzed range. Second, if some nights have never been analyzed (or were invalidated — see below), "Analyzing N new nights…" computes them. Uncached nights are computed in parallel and stream into the table as they finish, so the page is usable — you can filter, sort, and open episodes — the moment the first rows land, while the rest fill in underneath. A determinate progress bar shows total nights done out of total nights in the range, and notes how many came from the cache.',
          'Cancel and Resume let you bound a long first run without losing work. The Cancel button (shown only while analysis is running) stops computing the not-yet-finished nights but keeps every night already in the table — cancellation never discards completed work. After cancelling, a Resume button continues from where you stopped, computing only the nights that are still missing (the ones already done are read straight from the cache), so resuming is cheap relative to starting over. Changing the date range also restarts analysis for the new range; changing the Pattern, Min confidence, or Sort controls only re-filters or re-sorts what is already on screen and never restarts analysis.',
          'Cached results are kept honest automatically. Each saved result is tagged with a version identifier derived from the detector\'s algorithm and its current parameter values (a "version hash"). If the detection algorithm changes, or you change any detection threshold, that identifier changes and the stale entries are no longer used — the affected nights are recomputed transparently the next time you view them. You never see results produced by an old algorithm or by parameters you have since changed; correctness is preserved at the cost of one recomputation after a change. This is why a visit right after an update or a parameter change can briefly re-enter the "Analyzing…" phase even for a range you have looked at before.',
          'Each catalog row describes one candidate episode. The columns are: Night — the calendar date of the session the episode was found in (the link opens that session in the Signal Viewer, framed on the episode). Pattern — "PB" (periodic breathing) or "CSR" (Cheyne-Stokes respiration), with a "sub-threshold" tag when the episode is a genuine candidate that falls below the device\'s own reporting gate (these are shown deliberately, not hidden — see above). Confidence — the detector\'s confidence on a 0–1 scale (rendered as a bar with a numeric value), integrating the modulation index, harmonic ratio, cycle-length plausibility, and alignment with device central-apnea flags. Cycle — the dominant cycle length in seconds (the time from one ventilation peak to the next; longer cycles track longer circulation time and, in CSR, lower cardiac output). Modulation — the modulation depth on a 0–1 scale (how strongly the ventilation envelope waxes and wanes; near 0 is nearly flat, near 1 is deeply cyclic). Duration — how long the candidate run lasted, in minutes. Use the Min confidence slider and the Pattern selector to focus on the strongest CSR-shaped candidates; the status line always shows both how many episodes the filter is showing and how many nights have been analyzed, so a small filtered count during a long run is not mistaken for "nothing found."',
          'Nights that could not be analyzed are reported, not hidden. If a night\'s airflow signal is unreadable or lacks the flow / minute-ventilation channel the detector needs, that night is skipped but counted, and on completion the catalog shows "N nights could not be analyzed" with a "Details" list of the specific dates and short reasons. A failed night is not the same as a successfully analyzed night with no episodes — the former could not be examined, the latter was examined and found nothing — so the two are reported separately and a failed night never appears as a misleading empty row.',
          'Two empty results are distinguished. "No candidate … episodes were detected across N analyzed nights" is a clean finding — the range was analyzed and nothing cyclic was found. "No episodes match the current filters" means episodes do exist but your Min confidence or Pattern filter is excluding them; lower the threshold or widen the pattern to see them.',
        ],
      },
      {
        heading: 'Pitfalls and limitations',
        paragraphs: [
          'Leak artifact is the most common source of false positives. Large unintentional mask leak corrupts both the flow envelope (because the machine compensates) and the FOT-based central/obstructive classification (because the perturbation signal disperses through the leak path). CPAP Analyzer down-weights high-leak nights in TECSA and lowers the confidence of any PB/CSR episode that overlaps a high-leak segment, but a long leak event can still produce envelope oscillations that look cyclic. Treat any cyclic episode that coincides with a leak excursion with skepticism.',
          'Movement and arousal can mimic short oscillations in the envelope. Cycles shorter than 40 s are deliberately rejected by the cycle-length filter, but borderline events near the lower bound are inherently noisier.',
          'No respiratory-effort belt. PSG distinguishes central from obstructive events with thoracoabdominal effort signals (RIP belts or esophageal manometry); we have only flow plus FOT. This is sufficient for clinically useful PB/CSR detection (the literature cited above all operates from flow alone), but it is a strictly weaker channel than PSG. A clinical sleep study is the standard if the picture here is unclear.',
          'TECSA depends on history. A robust trajectory needs enough usable nights in both the early and late windows; sparse or recent imports will report low-confidence or "insufficient data" rather than guess.',
          'These are candidate flags. CPAP Analyzer is not a medical device, not FDA-cleared, and does not diagnose sleep-disordered breathing or cardiac disease. All output here is informational. Bring concerning findings — particularly new or sustained CSR, or a non-resolving TECSA trajectory — to your sleep physician and cardiologist.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Berry, R. B. et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. — Scoring rules for periodic breathing and Cheyne-Stokes respiration.',
          'Weinreich, G., Armitstead, J., Töpfer, V., Wang, Y.-M., Wang, Y., & Teschler, H. (2009). Validation of ApneaLink as screening device for Cheyne-Stokes respiration. Sleep, 32(4), 553–557. — Single-channel nasal-airflow CSR detection: airflow alone is sufficient.',
          'Javed, F., Fox, N., & Armitstead, J. (2018). ResCSRF: algorithm to automatically extract Cheyne-Stokes respiration features from respiratory signals. IEEE Transactions on Biomedical Engineering, 65(3), 669–677. DOI: 10.1109/TBME.2017.2712102. — Automated CSR feature extraction from flow.',
          'Midelet, A. et al. (2023). Features of Cheyne-Stokes respiration automatically extracted from CPAP airflow signal raw data: identification of discriminating features to detect heart failure. Biomedical Signal Processing and Control. — Airflow-based CSR feature extraction; longer cycle length tracks reduced cardiac output.',
          'Guyot, P., Djermoune, E.-H., Chenuel, B., & Bastogne, T. (2020). A signal demodulation-based method for the early detection of Cheyne-Stokes respiration. PLoS ONE, 15(3), e0221191. DOI: 10.1371/journal.pone.0221191. — Continuous flow-modulation index as a confidence measure for periodic breathing.',
          'Liu, D., Armitstead, J., Benjafield, A., Shao, S., Malhotra, A., Cistulli, P. A., Pepin, J.-L., & Woehrle, H. (2017). Trajectories of emergent central sleep apnea during continuous positive airway pressure therapy. Chest, 152(4), 751–760. DOI: 10.1016/j.chest.2017.06.010. — Four-class TECSA trajectory model from ~133,000 patients.',
          'Nigam, G., Pathak, C., & Riaz, M. (2016). A systematic review on prevalence and risk factors associated with treatment-emergent central sleep apnea. Annals of Thoracic Medicine, 11(3), 202–210. DOI: 10.4103/1817-1737.185761. — Systematic review of TECSA prevalence and risk factors.',
          'Kwok, K.-L. et al. (2022). Spontaneous resolution of treatment-emergent central sleep apnea. Respirology Case Reports. DOI: 10.1002/rcr2.916. — Self-limiting nature of TECSA on continued CPAP.',
          'Cowie, M. R., Woehrle, H., Wegscheider, K., Angermann, C., d’Ortho, M.-P., Erdmann, E. et al. (2015). Adaptive servo-ventilation for central sleep apnea in systolic heart failure. New England Journal of Medicine, 373(12), 1095–1105. — SERVE-HF trial: increased mortality with ASV in HFrEF.',
          'Somers, V. K., White, D. P., Amin, R. et al. (2008). Sleep apnea and cardiovascular disease: an American Heart Association/American College of Cardiology Foundation Scientific Statement. Circulation, 118(10), 1080–1111. DOI: 10.1161/CIRCULATIONAHA.107.189375. — On the cardiovascular consequences of sleep-disordered breathing.',
        ],
      },
    ],
  },

  // ─── INTRADAY HEALTH SIGNALS & OVERLAYS ───────────────────────────
  {
    slug: 'intraday-overlays',
    title: 'Intraday Health Signals & Overlays',
    summary:
      'How wearable heart-rate, SpO₂, HRV, snoring, and sleep-stage data are aligned with CPAP signals in the per-session signal viewer, and how to read sparse vs. dense lanes.',
    icon: 'integrations',
    sections: [
      {
        heading: 'What the overlays add',
        paragraphs: [
          'The per-session signal viewer can now display wearable health signals on a shared time axis with the CPAP channels (flow, pressure, leak). When a Google Health / Fitbit import is present and intraday data exists for the night, additional lanes appear below the CPAP lanes — heart rate (the hero lane, ~5 s cadence), wearable SpO₂, HRV (5-min cadence, step-rendered), snoring intensity, and a sleep-stage hypnogram (Wake / REM / Light / Deep as a categorical ribbon). All lanes share one time cursor, so a respiratory event in the CPAP flow can be read against simultaneous cardiac, oxygen, and sleep-stage context within the same view.',
          'Wearable lanes load asynchronously after the CPAP signal paints, so they never delay the first paint of flow and pressure. If the imported Google Health export does not include intraday data for that night, or if no Google Health import has been done, the lanes degrade gracefully — they either hide or show a hint linking to the Import Wizard. Daily-summary-only data (e.g., a single resting heart rate per day) is not used for intraday overlay, because it has no within-night structure.',
        ],
      },
      {
        heading: 'How alignment works',
        paragraphs: [
          'CPAP and wearable data are aligned by wall-clock timestamp. The viewer assumes "wall-clock-as-UTC" — that is, every timestamp is treated as if labelled in the same calendar time, and the viewer\'s displayed time zone equals the time zone of the night the data was recorded in. This is the right convention as long as you have not crossed time zones between the CPAP night and the Fitbit night being viewed: the lanes line up to the nearest sample.',
          'If you crossed a time zone (e.g., imported a night recorded abroad), or if the wearable\'s clock and the CPAP machine\'s clock disagreed when the night was recorded, the overlay will be shifted by the disagreement. There is no automatic re-alignment; the assumption is documented here so that an apparent lead/lag between cardiac and respiratory events can be sanity-checked against "was I in a different time zone that night?" before being read as physiology.',
          'Per-sample timestamps within a night are preserved exactly. No resampling is performed on the wearable side; CPAP 25 Hz data is downsampled for display (LTTB) but the underlying time index is unchanged.',
        ],
      },
      {
        heading: 'Sparse vs. dense lanes — how to read them',
        paragraphs: [
          'CPAP flow and pressure are dense: 25 samples per second, continuous across the session. Wearable signals are not: heart rate is roughly one sample every 5 s, HRV is one value every 5 min, and sleep stages are coarse intervals (a few minutes each). The viewer renders these honestly so you can tell at a glance how much signal is actually present.',
          'Dense lanes (heart rate, flow, pressure, leak): rendered as a continuous line.',
          "Sparse lanes (HRV in particular, but also any sparse cadence): rendered as a step function — the line holds the last sample's value until the next sample arrives — with a sample dot at each measurement so it is visually obvious where the actual data points are. Reading the height of the line between dots tells you the held value at that instant; the dots tell you where new evidence arrived.",
          "Dashed connectors imply uncertainty. When two adjacent samples are far apart in time (gap larger than the lane's expected cadence), the segment between them is drawn dashed to signal that the interpolation across the gap is not actual data. A solid line between samples means the gap is within the expected cadence; dashed means a dropout occurred and the held value is not trustworthy across that interval. Sleep stages render as filled categorical blocks; a missing stretch shows as no block, not as Wake.",
        ],
      },
      {
        heading: 'What intraday data can reveal',
        paragraphs: [
          'Around obstructive and central apneas, heart rate often shows a characteristic two-step response: a brief bradycardia during the apnea (vagal response to the breath-hold), followed by a tachycardic rebound on arousal. The magnitude varies with autonomic tone, age, beta-blocker use, and event severity. The overlay makes this readable directly: zoom to a candidate apnea on the flow lane and look at the heart-rate lane underneath.',
          'SpO₂ desaturations from the wearable lag the respiratory event because of circulation time — typically 15–30 s between the start of the apnea and the SpO₂ nadir (see the Desaturation glossary entry). The lag depends on baseline SpO₂, lung volume, and cardiac output, and is informative in its own right: a long lag is consistent with reduced cardiac output. Wearable SpO₂ is generally less precise than dedicated pulse oximetry (motion artifact, perfusion, skin pigmentation effects on optical sensors); treat the wearable SpO₂ lane as corroborative, not as a primary metric. Where they are available, CPAP-paired oximetry signals remain the higher-fidelity source.',
          'HRV (heart-rate variability, typically reported by Fitbit as RMSSD in milliseconds) tends to be depressed during REM with frequent respiratory events. Cycle-to-cycle modulation of HRV around CSR cycles has been described in the heart-failure literature and is sometimes visible at the 5-min cadence Fitbit provides — though the cadence is too coarse to resolve individual cycles. Read HRV as a context lane for autonomic state across the night, not as a beat-to-beat measure.',
          'The sleep-stage hypnogram lets you locate REM-dominant clusters of events: respiratory events typically intensify in REM (loss of accessory-muscle tone, more airway collapsibility). If your event clusters concentrate over the REM bars, that is consistent with REM-dominant disease and is a different therapy conversation than evenly distributed events.',
          'For computed CSR episodes (see Breathing Patterns: Periodic Breathing, Cheyne-Stokes & TECSA), the overlays make the cycle visible across modalities: the flow envelope crescendos and decrescendos, heart rate often modulates in counter-phase, and SpO₂ traces the cyclic desaturations a few seconds late.',
        ],
      },
      {
        heading: 'Requirements and how to import',
        paragraphs: [
          'The overlays require a Google Health / Fitbit import that includes intraday data for the night in question. Daily-only summaries (one heart rate per day, one HRV per day) are not enough — within-night lanes need within-night samples. Not every Fitbit device records every type: older trackers may lack SpO₂, HRV, or skin temperature sensors entirely, and even capable devices may not record on every night.',
          'To get intraday data into the app, follow the Google Takeout export workflow in the Importing Data article (Google Takeout → Google Health → extract → Import Wizard → Google Health source). The Importing Data article lists all supported data types and which are intraday vs. daily.',
        ],
      },
      {
        heading: 'Reading a lane label',
        paragraphs: [
          "Each lane carries a single label that tells you, at a glance, what the lane is and where its data came from. The lane name is drawn in the lane's own line color (so the label and the trace are unmistakably the same signal), the units are shown in muted grey beside it, and a short source tag marks the provenance: CPAP for signals recorded by the CPAP machine (flow, pressure, leak), WEAR for wearable-derived signals (heart rate, wearable SpO₂, HRV, snoring), and SLEEP for the sleep-stage hypnogram. The source tag matters because a wearable lane and a CPAP lane carry different fidelity and alignment assumptions (see How alignment works, above).",
        ],
      },
      {
        heading: 'Lane controls — collapse, reorder, hide',
        paragraphs: [
          'Each lane has three direct controls. To collapse a lane to a compact height (or expand it again), click its name; collapsing keeps the lane in the stack but reclaims vertical space so you can keep more lanes visible at once. To reorder a lane, drag its handle (the grip to the left of the label) up or down; lanes are also reorderable from the keyboard alone. To remove a lane from the view, use the hide (✕) button that appears next to the drag handle when you hover the lane or move keyboard focus to it — hidden lanes can be brought back from the Lanes drawer.',
          'The legend bar at the top of the viewer stays pinned in place as you scroll and shows the DEVICE EVENTS and DETECTIONS legends (the colored swatches that explain the event and candidate-pattern overlays). It does not contain a per-signal visibility toggle; signal visibility is managed entirely through the per-lane hide button and the Lanes drawer.',
        ],
      },
      {
        heading: 'The Lanes drawer, presets, and keyboard cursor',
        paragraphs: [
          'The set of visible lanes, their order, and their collapsed/expanded state are controlled from a Lanes drawer, accessible from the viewer toolbar or by pressing L. Lanes can be reordered (drag, or keyboard) and individually shown or hidden. The state persists per session, so reopening the same night restores your last layout.',
          'Presets group the lanes for common reading tasks: Respiratory focus (flow + pressure + leak + snoring), Cardio focus (flow + heart rate + HRV), Sleep architecture (flow + hypnogram + heart rate + SpO₂), and Everything (all available lanes). Picking a preset is non-destructive — you can fine-tune from there.',
          'A keyboard data cursor (arrow keys) walks through the session sample-by-sample and announces a synchronized multi-lane readout at the cursor — value, units, and time — for every visible lane. This gives screen-reader and keyboard-only users equivalent access to what the visual cursor shows on hover. Lanes are also reorderable from the keyboard alone.',
        ],
      },
      {
        heading: 'Privacy',
        paragraphs: [
          'All wearable data is read from the local Google Health export and stored in the same local IndexedDB / OPFS used for CPAP data. No data is uploaded for parsing or display. The signal viewer composes everything in-browser. Removing the integration (Settings → Integrations) removes the stored wearable data; deleting all data removes both sources.',
        ],
      },
    ],
  },

  // ─── EVENT EXPLORER ───────────────────────────────────────────────
  {
    slug: 'event-explorer',
    title: 'Event Explorer',
    summary:
      'How to query, slice, visualize, and export respiratory events with the Event Explorer — filters, null-field semantics, lenses, URL-serialized and saved queries, and CSV/JSON export.',
    icon: 'events',
    sections: [
      {
        heading: 'What the Event Explorer is',
        paragraphs: [
          'The Event Explorer (Explore → Event Explorer, route `/explore/events`) is an ad-hoc query tool for respiratory events across your imported nights. Rather than a fixed dashboard, it pairs a query builder with a swappable set of visualization lenses, all driven by the same matched set. The intent is to let you ask specific questions — "all hypopneas longer than 30 s above pressure 12 in the first two hours of the night, last 90 days" — and see them as a distribution, a scatter, a per-type comparison, or a cluster map without rebuilding the filter each time.',
        ],
      },
      {
        heading: 'Filters and how they combine',
        paragraphs: [
          'Filters in the left-rail query builder are combined with logical AND: every active filter must be satisfied for an event to be included in the matched set. The available filters are event type (one or more types from a chip selector — including obstructive apnea, central apnea, hypopnea, mixed apnea, RERA, snoring, flow limitation, and the sustained "detection" patterns like PeriodicBreathing, which carries a distinct hatched marker to distinguish device-asserted from computed candidates), duration (range), pressure at the event (range), leak at the event (range), SpO₂ at the event (range), time-of-night window (local clock-time range that may wrap past midnight, e.g. 22:00–06:00), and date range within the loaded set.',
          'Filters that are inactive — meaning the user has not constrained that field — let every event through on that field. The matched-count "trust strip" above the lenses ("N of M events match K filters") updates live as you adjust filters and is announced to screen readers via aria-live; the proportion bar gives an at-a-glance sense of how restrictive the query is.',
          'Range filters bound by a numeric slider always come with paired min/max numeric inputs, so a precise value can be typed (e.g. duration ≥ 10.0 s) without dragging. A range filter disables itself with an explanatory chip when the underlying field has no data in the currently matched set — for example, SpO₂ filters disable when no oximetry-bearing events match the other filters.',
        ],
      },
      {
        heading: 'Null-field semantics (important)',
        paragraphs: [
          'CPAP events do not all carry every field. An apnea recorded without paired oximetry has no SpO₂ value attached to it; a flow-limitation event may not have an associated discrete pressure reading; older imports may lack some fields entirely. The Event Explorer applies an explicit convention so these missing fields behave predictably.',
          'A bounded range on a field excludes events that are missing that field. If you set "SpO₂ between 88 and 92," only events with a recorded SpO₂ in that band are included; events with no SpO₂ value are excluded — they cannot be evaluated against the constraint, and including them would be silently fabricating data.',
          'An unbounded range on a field passes nulls through. If you leave SpO₂ unset (no min, no max), every event passes the SpO₂ filter regardless of whether SpO₂ was recorded — so the matched set is not silently narrowed by a constraint you never imposed.',
          'In practice this means: if you want "events on nights where SpO₂ is recorded, restricted to the 88–92 range," set the bounded range. If you want "all events, irrespective of oximetry," leave the field unbounded. The matched-count strip will reflect the effect of each choice immediately.',
        ],
      },
      {
        heading: 'Lenses (the visualization views)',
        paragraphs: [
          'All lenses operate on the same matched set; switching lenses does not change the query. A summary-stats strip above the lens area shows the matched event count, the per-type breakdown, and basic descriptive stats; the lens itself answers a more specific question.',
          'Duration histogram. A configurable-bin-width histogram of event durations, with an optional split-by-type stacking so the contributions of different event types stack into each bar. Bin width is set in the lens toolbar. An overflow bin is provided at the right edge so long-tail outliers (a 5-minute leak-induced event) do not force the rest of the histogram to compress into the first few bars — those events land in the overflow bin instead of being clipped.',
          'Scatter. Duration on the x-axis against a configurable y-axis: pressure, leak, SpO₂, or time-of-night. Points are colored by event type. For matched sets larger than 5,000 points, uniform-stride decimation is applied (every k-th point) so the scatter remains interactive and readable; the stride is chosen to keep approximately 5,000 points on screen, and the lens annotates that decimation is in effect so a partial view is never confused with the full set.',
          'Per-type box / violin. Small-multiples of duration distributions, one per event type, rendered as a box plot with violin overlay so both the quartiles and the full distribution shape are visible. This is the right lens for "how does the central-apnea duration distribution compare to the obstructive-apnea distribution in this set?"',
          'Inter-event intervals. The distribution of time gaps between consecutive events in the matched set. A long-tailed distribution indicates isolated events; a peaked distribution at short intervals indicates clustering. Useful in combination with a time-of-night filter for asking "do my apneas cluster in the first two hours?"',
          'Clusters. A density / cluster view based on the FLG-bridged clustering primitive (selectable as strict, balanced, or lenient) that groups events occurring close together in time into clusters. Strict mode requires tighter temporal proximity; lenient mode joins farther-apart events into the same cluster. The view shows cluster sizes, durations, and locations within the night.',
        ],
      },
      {
        heading: 'URL-serialized and saved queries',
        paragraphs: [
          'The entire filter state — every active filter, the chosen lens, lens-specific settings (bin width, scatter axis, cluster mode) — is serialized into the URL. This means a query is bookmarkable, back/forward-able, and shareable: opening a URL restores the exact view the URL encodes. (No data is shared by a URL; only the query parameters.) The browser history works the way you would expect.',
          'Saved queries persist to local storage. Give a query a name and it is added to your saved-query list; selecting it restores the filters and lens in one click. Four examples ship by default to demonstrate the pattern. Saved queries live entirely in the browser — there is no account, nothing is synced.',
        ],
      },
      {
        heading: 'The event table and Signal-Viewer deep-links',
        paragraphs: [
          'Below the lens, a virtualized event table lists the events in the matched set (windowed for large sets, with a "showing N of M" note so the truncation is transparent), sortable by every column. Clicking any row deep-links into the Signal Viewer for that event\'s session and frames the entire event: the viewer opens with the event spanning roughly 90% of the visible width and comfortable margins on either side, so a multi-minute event is shown end to end rather than running off the edge. Very short or point-in-time events are given a sensible minimum window (about 30 seconds) so there is always context around them. Targets outside the session\'s recording are ignored, and the framing is applied once — subsequent panning and zooming preserve your interaction.',
          'This whole-event framing is the right default for sustained patterns such as periodic breathing and Cheyne-Stokes respiration, which can run for several minutes: framing the whole span keeps the crescendo–decrescendo morphology visible at once instead of pushing the back half off the right edge. For computed PeriodicBreathing / CSR candidates (see Breathing Patterns: Periodic Breathing, Cheyne-Stokes & TECSA), the deep link lands on the cyclic episode in question, framed in full, with the wearable overlays available alongside (see Intraday Health Signals & Overlays). For backward compatibility, an older link that encodes only a single timestamp (`?t=<epochMs>`) still opens a centered ±1-minute window on that timestamp.',
        ],
      },
      {
        heading: 'Export',
        paragraphs: [
          'The matched set can be exported to CSV (one row per event, with all available fields) or JSON (the same event objects the app uses, useful for downstream analysis in R, Python, or pandas). Export happens entirely in-browser using the matched set already in memory — no data is uploaded to any server.',
          'Very large exports show a warning before generating the file because writing tens or hundreds of thousands of rows can take noticeable time and produce a large download. The warning includes the row count so you can decide whether to narrow the query first.',
        ],
      },
      {
        heading: 'Privacy and limits',
        paragraphs: [
          'The Event Explorer operates entirely on data already loaded into the app from your local storage. No queries, filters, or exports leave your browser. Saved queries are stored locally. URLs encode the query parameters but not the data itself; sharing a URL does not share your events.',
          'The Explorer queries device-scored and app-computed events; it does not re-detect anything from raw signal. For methods and confidence on computed breathing detections, see Breathing Patterns: Periodic Breathing, Cheyne-Stokes & TECSA.',
        ],
      },
    ],
  },

  // ─── CROSS-SOURCE ANALYSIS ────────────────────────────────────────
  {
    slug: 'cross-source-analysis',
    title: 'Cross-Source Analysis',
    summary:
      'Correlating CPAP therapy data with wearable health metrics to discover relationships and track holistic sleep health.',
    icon: 'integrations',
    sections: [
      {
        heading: 'What cross-source analysis does',
        paragraphs: [
          'Cross-Source Analysis correlates metrics from your CPAP machine with metrics from your wearable device (e.g., Fitbit via Google Health). By aligning nightly CPAP data (AHI, leak, pressure, usage) with wearable data (HRV, SpO₂, sleep stages, activity, resting heart rate, readiness), you can explore questions like: Does higher daytime activity predict lower AHI? Does poor HRV correlate with more respiratory events? How does sleep efficiency from the wearable compare to CPAP usage duration?',
          'These analyses are exploratory. They surface candidate relationships for you to investigate — they do not establish causation and are not clinical diagnoses. Treat every finding as a hypothesis, not a conclusion.',
        ],
      },
      {
        heading: 'Correlation Explorer tab',
        paragraphs: [
          'The Correlation Explorer lets you select any two metrics — one from each data source, or both from the same source — and visualize their relationship with a scatter plot and regression line. For each pair the Explorer reports:',
          'Correlation coefficient ($r$ or $\\rho$): A value between $-1$ and $+1$ measuring the strength and direction of the linear (Pearson $r$) or monotonic (Spearman $\\rho$) relationship. Values near $\\pm 1$ indicate a strong relationship; values near $0$ indicate little or no relationship.',
          'P-value: The probability of observing a correlation this extreme if the two metrics were actually unrelated ($H_0\\colon r = 0$). A small $p$-value (conventionally $< 0.05$) suggests the observed correlation is unlikely to be due to chance alone — but see the caveats below.',
          '95% confidence interval: The range within which the true population correlation likely falls, given your sample size. Narrow intervals indicate a more precise estimate; wide intervals mean less certainty.',
          "Strength classification: A plain-language label (negligible, weak, moderate, strong, very strong) based on the absolute value of the coefficient, using CPAP Analyzer's convenience bands: $|r| < 0.1$ negligible, $0.1$–$0.3$ weak, $0.3$–$0.5$ moderate, $0.5$–$0.7$ strong, $> 0.7$ very strong. These bands are a rule of thumb, not a standard — the cutoffs are inherently arbitrary (Schober et al. 2018), and other conventions differ (Cohen's 1988 benchmarks for $r$ are $0.1$/$0.3$/$0.5$ for small/medium/large). Read the coefficient and its confidence interval, not just the label.",
        ],
      },
      {
        heading: 'Correlation Matrix tab',
        paragraphs: [
          'The Correlation Matrix displays pairwise correlations for all available metrics as a color-coded heatmap. Cells are colored on a diverging scale: deep blue for strong negative correlations, white for near-zero, and deep red for strong positive correlations. Statistically significant cells ($p < 0.05$) are marked to distinguish them from non-significant results.',
          'How to read the matrix: scan the row and column headers to find the metric pair of interest. The cell value is the Pearson $r$ (or Spearman $\\rho$, depending on your settings). Focus first on cells that are both strongly colored and marked significant — these are the most likely to reflect real relationships rather than noise.',
          'With many metric pairs in the matrix, some will appear significant by chance alone (the multiple comparisons problem). If you test 50 independent pairs at $\\alpha = 0.05$, you expect roughly 2–3 false positives. Use the matrix as a discovery tool: note the interesting pairs, then investigate them individually in the Correlation Explorer with domain knowledge in mind.',
        ],
      },
      {
        heading: 'Metric Comparison tab',
        paragraphs: [
          'The Metric Comparison tab provides two advanced analysis modes for pairs of metrics: Bland-Altman agreement analysis and lagged cross-correlation.',
          'Bland-Altman analysis: When two sources measure the same underlying quantity (e.g., SpO₂ from the wearable vs. SpO₂ estimated from CPAP flow signals, or sleep duration from the wearable vs. CPAP usage hours), a Bland-Altman plot assesses how well they agree. It plots the difference between the two measurements ($y$-axis) against their average ($x$-axis). If the measurements agree perfectly, all points lie on the zero line. The plot shows the mean bias (systematic offset), 95% limits of agreement (mean $\\pm$ 1.96 SD of the differences), and whether the bias is proportional (larger at higher values). A small mean bias and narrow limits of agreement indicate good agreement between the two sources.',
          'Lagged cross-correlation: This analysis shifts one time series forward or backward relative to the other by 0 to $N$ days and computes the correlation at each lag. It answers: "Does a change in metric X today predict a change in metric Y tomorrow (or two days later, etc.)?" For example, you might find that high step counts on day $t$ correlate with lower AHI on day $t+1$, suggesting a one-day delayed relationship. The lag with the highest absolute correlation is highlighted, along with its statistical significance. Be cautious: testing multiple lags inflates false-positive risk, so treat the optimal lag as exploratory.',
        ],
      },
      {
        heading: 'Statistical methods',
        paragraphs: [
          'Pearson correlation ($r$) measures the linear relationship between two continuous variables. It assumes both variables are approximately normally distributed and that the relationship is linear. It is sensitive to outliers — a single extreme night can inflate or deflate $r$.',
          'Spearman rank correlation ($\\rho$) measures the monotonic relationship between two variables (whether one tends to increase as the other increases, not necessarily linearly). It operates on ranks rather than raw values, making it robust to outliers and applicable to non-normal data. The Correlation Explorer lets you toggle between Pearson and Spearman, so when a normality check is borderline or either variable is visibly skewed you can switch to Spearman directly.',
          'Partial correlation measures the association between two variables after removing the influence of one or more confounding variables. For example, the partial correlation between AHI and HRV controlling for usage hours tells you whether the AHI–HRV relationship persists after accounting for the fact that both may be influenced by how long you wore the CPAP mask.',
          'P-values: In this context, a $p$-value answers: "If these two metrics had zero true correlation in the population, how likely is it that I would observe a sample correlation at least this large?" A small $p$ (typically $< 0.05$) is conventionally called "statistically significant," meaning the result is unlikely under the null hypothesis. However, statistical significance does not guarantee clinical importance — a weak correlation can be significant with enough data points, and a strong correlation can fail to reach significance with too few. Always consider effect size (the coefficient itself) alongside $p$.',
        ],
      },
      {
        heading: 'Correlation does not imply causation',
        paragraphs: [
          'This is the single most important caveat for cross-source analysis. A statistically significant correlation between two metrics means they tend to move together — it does not mean one causes the other. There are several reasons a spurious correlation can appear:',
          'Confounders: A third variable drives both metrics. For example, seasonal changes can simultaneously affect sleep quality, AHI, and activity levels, creating apparent correlations between metrics that are actually independent once season is controlled for.',
          'Reverse causation: The direction of influence may be opposite to what you assume. A correlation between poor sleep (low HRV) and high AHI could mean untreated apnea worsens HRV, or that poor autonomic function worsens apnea, or both.',
          'Coincidence and multiple testing: When you examine many metric pairs, some will correlate by chance. With 20 pairs at $\\alpha = 0.05$, you expect one false positive on average.',
          'These analyses are designed to help you generate hypotheses — for example, "I should discuss my exercise-AHI pattern with my sleep physician" — not to reach clinical conclusions independently.',
        ],
      },
      {
        heading: 'Key caveats and limitations',
        paragraphs: [
          'Self-reported vs. device-measured data: Some Fitbit metrics (e.g., sleep logs) can be manually edited by the user, which may introduce inaccuracies. Device-measured metrics (e.g., heart rate, SpO₂) are generally more reliable but still subject to sensor limitations (motion artifact, poor fit, skin tone effects on optical sensors).',
          'Confounders: Many variables that affect sleep and health are not captured by either device — medication changes, alcohol consumption, stress, illness, travel, altitude, and ambient temperature can all influence both CPAP and wearable metrics simultaneously.',
          'Small sample sizes: If you have only a few weeks of overlapping data, correlation estimates are imprecise (wide confidence intervals) and significance tests have low statistical power — you may miss real relationships or find spurious ones. As a rough guideline, at least 30 overlapping nights are needed for reasonably stable correlation estimates, and 60+ are preferable for lagged analyses.',
          'Measurement differences: The wearable and CPAP machine may define "sleep" differently (wearable uses actigraphy and heart rate; CPAP uses mask-on time). Timestamps may differ by minutes. These discrepancies are generally small but can introduce noise into the correlations.',
          'Ecological inference: Nightly aggregates obscure within-night dynamics. A night with 4 hours of excellent therapy followed by 4 hours of poor therapy looks the same in the summary as a uniformly mediocre night.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Pearson, K. (1895). Note on regression and inheritance in the case of two parents. Proceedings of the Royal Society of London, 58, 240–242. DOI: 10.1098/rspl.1895.0041. — Pearson product-moment correlation.',
          'Spearman, C. (1904). The proof and measurement of association between two things. American Journal of Psychology, 15(1), 72–101. DOI: 10.2307/1412159. — Spearman rank correlation.',
          'Fisher, R. A. (1915). Frequency distribution of the values of the correlation coefficient in samples from an indefinitely large population. Biometrika, 10(4), 507–521. DOI: 10.2307/2331838. — The z-transformation used for correlation confidence intervals.',
          'Bland, J. M., & Altman, D. G. (1986). Statistical methods for assessing agreement between two methods of clinical measurement. The Lancet, 327(8476), 307–310. DOI: 10.1016/S0140-6736(86)90837-8. — Limits of agreement (mean ± 1.96 SD of the differences).',
          'Bland, J. M., & Altman, D. G. (1999). Measuring agreement in method comparison studies. Statistical Methods in Medical Research, 8(2), 135–160. DOI: 10.1177/096228029900800204. — Proportional-bias assessment.',
          'Schober, P., Boer, C., & Schwarte, L. A. (2018). Correlation coefficients: appropriate use and interpretation. Anesthesia & Analgesia, 126(5), 1763–1768. DOI: 10.1213/ANE.0000000000002864. — Notes that correlation-strength cutoffs are inherently arbitrary.',
          'Cohen, J. (1988). Statistical Power Analysis for the Behavioral Sciences (2nd ed.). Hillsdale, NJ: Lawrence Erlbaum. — Effect-size benchmarks (r: 0.1/0.3/0.5 for small/medium/large).',
          'Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate: a practical and powerful approach to multiple testing. Journal of the Royal Statistical Society, Series B, 57(1), 289–300. — Context for the multiple-comparisons caveat.',
        ],
      },
    ],
  },

  // ─── WEATHER & ENVIRONMENT ────────────────────────────────────────
  {
    slug: 'weather-environment',
    title: 'Weather & Environment',
    summary:
      'The opt-in Open-Meteo weather and air-quality integration — what it correlates and why, exactly what leaves your device, how to enable/disable/delete it, how historical backfill and the ~5-day archive lag work, and how to read the dashboard panel, the Signal-Viewer weather lanes, and the cross-source correlations.',
    icon: 'integrations',
    sections: [
      {
        heading: 'What this feature does, and why',
        paragraphs: [
          'Weather & Environment is an optional integration that fetches local weather and air-quality data for the nights you have recorded and lets you correlate that environmental context against your CPAP therapy metrics. The motivating observation is that some patients show seasonal or weather-dependent variation in their therapy: a stretch of bad nights that lines up with a cold front, a humid spell, or a polluted week rather than with anything about the machine or the mask. Without environmental context that pattern is invisible; with it, you can put a number on the association.',
          'The headline hypothesis is barometric (atmospheric) pressure versus apnea and central events. Ambient pressure changes alter the gas already in the lungs and the way the respiratory control loop responds to it, and shifts in pressure have been linked to changes in apnea and especially central-event frequency. A falling barometer — a passing weather system — is therefore a plausible modifier of a bad night, and because such a shift can precede the night it affects, this feature treats pressure as the variable of primary interest (see "Reading the cross-source correlations" below for why lagged correlation is the apt tool). Humidity, dewpoint, temperature, wind, and air quality are provided alongside it as additional, secondary context.',
          'This is an exploratory, hypothesis-generating tool. It can surface that your therapy and the weather tend to move together; it cannot establish that one causes the other, and it does not diagnose anything. Treat every association it shows as a question to investigate, not an answer.',
        ],
      },
      {
        heading: 'The privacy contract — exactly what is and is not sent',
        paragraphs: [
          'This is the first feature in CPAP Analyzer that makes an outbound network request. Every other part of the app — including the Fitbit / Google Health integration, which is a local file import — runs entirely in your browser and contacts no server. Because this feature must ask a remote service "what was the weather at this place on these nights," it necessarily discloses a place and some dates to that service. The whole design is built to make that disclosure minimal, explicit, and reversible, and it stays off until you turn it on.',
          'What leaves your device, per sync: (1) your configured coordinates, rounded to two decimal places (roughly 1.1 km, i.e. neighbourhood-level, never GPS-precise) before every request; (2) the calendar dates of the nights you are syncing; and (3) only if you use the optional "Find" city search, the city name you type. Nothing else. The requests go only to Open-Meteo (the named provider), over four specific Open-Meteo hosts that the app whitelists — never to a wildcard, never anywhere else.',
          'What never leaves your device: any therapy or health data (your AHI, leak, pressures, events, signals — none of it is ever transmitted), any identifier (there is none — Open-Meteo needs no account and no API key, so a request carries no credential tying it to you), and your precise GPS location (only the rounded coordinates are ever sent). The browser sends weather requests directly to Open-Meteo, so Open-Meteo necessarily sees your network IP address, as any website you visit does; the app cannot hide that, which is one more reason the feature is opt-in and the disclosure is shown up front.',
          'Enabling the feature requires you to pass through an explicit consent dialog that states this contract in plain language — a blue "what leaves your device" block and a green "what stays on your device" block — before any request is ever made. The app records the moment you consented (a timestamp). If a future version ever changes what is sent off-device, that recorded consent is used to re-ask you rather than silently carrying your old consent forward.',
        ],
      },
      {
        heading: 'Enabling, disabling, and deleting your weather data',
        paragraphs: [
          'To enable: open Settings → Integrations and expand the Weather & Air Quality item (it carries a "Connects online" pill to distinguish it from the local-file Fitbit import, which sends nothing). Toggling it on opens the consent dialog described above; you must read and accept it. You then set a single location — type latitude and longitude directly, search for a city with "Find," or use the one-time "Use current location" button (which asks your browser for permission and only fills in the field; it never auto-sends anything). Choose your display units (temperature °C/°F, pressure hPa/inHg, wind, precipitation), which domains to fetch (Core weather and/or Air quality), and the resolution (Daily, or Daily + Hourly — the hourly series is what powers the Signal-Viewer lanes). Then press "Sync now."',
          'Nothing is fetched automatically. Every request is either started by you pressing "Sync now," or — only if you separately opt in to the "Auto-sync newly imported nights" checkbox, which is off by default — triggered when you import new CPAP nights. With auto-sync off (the default), the integration never reaches the network unless you press Sync.',
          'To disable: toggle the integration off in Settings → Integrations. This immediately stops all requests. By default your already-fetched weather data is kept (so re-enabling does not re-fetch nights you already have, and your past correlations still work); the disable prompt offers a "Keep" option (selected by default) and a "Delete" option. Choosing Delete removes the stored weather and air-quality records from your browser. You can also remove everything at any time via the app-wide "delete all data" control, which clears weather alongside your CPAP and wearable data. Weather data lives in the same local IndexedDB as everything else and, like everything else, never leaves your device once fetched.',
        ],
      },
      {
        heading: 'How historical backfill works (and why some nights show "No data available")',
        paragraphs: [
          "CPAP analysis is retrospective — you may have months or years of nights — so the integration is built to backfill weather for past nights, not just report current conditions. When you sync, the app looks up each night's local calendar date and fetches the matching weather and air-quality summary for your configured location, caching each result so a given night is fetched at most once. A night that spans two calendar dates fetches both and merges them, the same way the wearable lanes handle a night that crosses midnight.",
          'Open-Meteo serves historical weather from two places, and the app routes between them automatically. Settled history comes from a reanalysis archive that reaches back decades but lags roughly five days behind today — the most recent few days are not yet in the archive. For those recent nights the app instead uses the forecast API\'s "recent past" window, so there is no gap at the boundary; you do not need to think about which source is used. Because of the lag, the dashboard panel always stamps its values with the date they are "as of" and never implies "today."',
          'Air-quality history is shallower and region-dependent. The air-quality archive reaches back several years for Europe but only to more recent years for the rest of the world, so for older nights, or for nights outside the better-covered regions, the provider may simply have no air-quality record. This is normal and expected — not a failure.',
          'It is important to read "No data available" correctly. The app deliberately stores "we asked and the provider had nothing" as a state distinct from "we have not asked yet" and from "the request failed." A night with no provider data shows a dash ("—"), never a fabricated zero, and is marked as a terminal "No data available" state in the coverage view — re-syncing it will not conjure data that does not exist on the provider\'s side. This is separate from a genuine error (offline, rate-limited, or an HTTP failure), which is marked "Sync failed" and is worth retrying. The coverage view distinguishes four states with separate icons, words, and colours: Synced (have data), Not synced (not yet fetched — actionable), No data available (queried, provider had none — terminal), and Sync failed (an error — retry). So if recent nights, or non-European nights, show "No data available" for air quality, that is the archive\'s coverage limit, not a bug.',
        ],
      },
      {
        heading: 'The overnight window — what each displayed number means',
        paragraphs: [
          'Every weather number you see is summarized over one canonical "overnight" window, shared identically by the dashboard panel, the Signal-Viewer lanes, and the correlation surface — so a given night\'s "humidity" is the same number everywhere, never three different values. The window is the half-open wall-clock interval from the start of the recorded night up to (but not including) its end: in interval notation, [sleep start, sleep end). Half-open means the closing instant belongs to the next bucket, so adjacent nights never double-count the boundary hour.',
          'Within that window, each metric is reduced to one statistic chosen to be the clinically meaningful one for that variable, and the displayed tile names the statistic so there is no ambiguity. Temperature is shown as the overnight low (the minimum across the window — the coldest point of the night), because the low is what is physiologically relevant overnight. Barometric pressure, relative humidity, and dewpoint are shown as the overnight mean (the average across the window), because for these a representative central value over the night is what matters. Wind is shown as a representative overnight value, and air quality is summarized as the overnight statistic of the hourly AQI. Whenever you compare a weather value against a therapy metric, you are comparing two nightly summaries computed over the same window.',
        ],
      },
      {
        heading: 'Reading the dashboard panel',
        paragraphs: [
          'When the integration is enabled and at least one night is synced, a Weather Overview panel appears on the Dashboard with six headline tiles: overnight-low temperature, relative humidity, barometric pressure (the headline tile, marked with a subtle accent), air quality (AQI), dewpoint, and wind. Each tile shows the current value in your chosen units alongside a seven-day trend indicator, and the panel carries an "As of {date}" caption — because the provider archive lags about five days, the panel always tells you which night the numbers describe rather than implying they are live. When the most recent synced night is more than about five days old, the caption notes that the provider data lags ~5 days, so a slightly stale date is expected and not a problem.',
          'The trend indicators are deliberately non-judgemental for most metrics. Temperature, humidity, pressure, dewpoint, and wind use a neutral trend: the arrow tells you the direction of change (rising, falling, steady) without colouring it good or bad, because there is no universally "better" direction for, say, barometric pressure. Air quality is the one exception that is treated as directional: lower AQI is better, so a falling AQI is shown favourably and a rising AQI unfavourably. The AQI tile also shows a category word (e.g. "Good," "Moderate") next to the number and a small ranked swatch, and the severity is always conveyed by the word and number and a pattern, never by colour alone — so the meaning survives colour-blindness and greyscale.',
          'If the integration is enabled but you have not synced yet, the panel shows a prompt to sync rather than empty tiles. If it is disabled, the panel does not appear at all. A footer links you to the cross-source correlations and reports how many nights of weather data you have.',
        ],
      },
      {
        heading: 'Reading the Signal-Viewer weather lanes',
        paragraphs: [
          'If you fetch at the "Daily + Hourly" resolution, the per-session Signal Viewer gains an optional weather lane group (a "WX" pill) that overlays the night\'s hourly weather on the same wall-clock time axis as your CPAP signals, aligned to the actual recording hours. There are three lanes you can toggle on or off: a conditions ribbon (one segment per run of weather — clear, cloud, rain, etc. — with a small weather glyph), a pressure-and-temperature line lane (barometric pressure drawn solid and heavier because it is the headline variable, temperature drawn dashed so the two are distinguishable without relying on colour), and an air-quality ribbon (coloured by AQI rank, with an escalating hatch pattern so the severity reads without colour). The lane group hides itself automatically when there is no hourly weather for the night. An "Environment focus" lane preset brings up flow alongside the weather lanes for quick inspection.',
          'As with all Signal-Viewer lanes, the keyboard data cursor announces the weather values at the cursor — temperature, pressure, dewpoint, wind, the condition word, and "Air quality: {word}, AQI {value}" (always the word and the number, never a bare value) — so the weather context is fully available to screen-reader and keyboard-only users, not just visually. Weather lanes are aligned by wall-clock time exactly like the wearable lanes; if you recorded a night in a different time zone from your configured location, the same alignment caveats described in the Intraday Health Signals & Overlays article apply.',
        ],
      },
      {
        heading: 'Reading the cross-source correlations',
        paragraphs: [
          'In Explore → Correlations (the Cross-Source tab), Weather & Environment appears as a second source you can compare your CPAP and wearable metrics against, through a grouped "Compare against" selector (Wearable / Weather & Environment). The same machinery documented in the Cross-Source Analysis article applies unchanged: Pearson and Spearman correlation with confidence intervals and p-values, the correlation matrix, Bland–Altman agreement, and lagged cross-correlation. An availability statistic reports how many nights have weather data, so you can see how much overlap your estimate rests on.',
          'Lagged cross-correlation deserves emphasis here because it is especially apt for weather. Environmental effects can precede a bad night: a barometric-pressure drop on day t may be associated with worse AHI or more central events on day t (the same night) or on day t+1 (the following night), as a weather system moves through. A same-day-only (lag-0) correlation would miss that delayed relationship entirely. The lagged analysis shifts one series relative to the other across a range of day-offsets and reports the correlation at each lag, highlighting the strongest — so "does a falling barometer tonight predict a worse night tomorrow?" is a question you can actually pose. As always, testing many lags inflates the chance of a spurious "best" lag, so treat the optimal lag as a hypothesis to confirm with more data and domain knowledge, not as an established lead-time.',
          'All of the usual cross-source caveats apply with full force: correlation is not causation; season is a powerful confounder that can drive weather, sleep, and activity simultaneously; small overlapping samples give wide, unstable estimates (aim for tens of nights, more for lagged analyses); and these analyses are designed to help you frame a question for your clinician — for example, "my central events seem to rise after pressure drops" — not to reach a clinical conclusion on your own.',
        ],
      },
      {
        heading: 'Scope and limitations',
        paragraphs: [
          'Pollen is not included in this version. Open-Meteo\'s pollen data is forecast-only (a few days ahead), Europe-only, and has no historical archive, so it could never be backfilled for any past night. Surfacing it would risk the opposite of helpful: it would show a permanent "no data" for your history and could mislead you into concluding pollen does not affect your therapy when in truth the data simply never existed. Because correctness outranks adding features, pollen is deliberately deferred until a historical-capable source is available.',
          'A single location is supported per profile in this version. If you travelled, the weather shown is for your configured home location, not wherever you actually slept — so read travel nights with that in mind. Per-night / travel-aware location is a planned future capability.',
          'Weather and air-quality data come from a third party (Open-Meteo) and depend on its modelled reanalysis and continued availability; like any model, it is an estimate of conditions at your rounded coordinates, not a measurement at your bedside. Missing weather never blocks your CPAP analysis — a night with no weather simply shows a dash, and the rest of the app is unaffected.',
          'CPAP Analyzer is not a medical device and is not certified for diagnosis. Weather & Environment is an exploratory analysis aid: it informs and helps you frame questions; it does not diagnose, and it does not recommend any change to your therapy. Bring anything new, sustained, or trending — especially a rising central-event pattern — to a qualified clinician, who can place it in the context of your full history.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Open-Meteo. Open-Meteo Weather, Historical (ERA5 reanalysis archive), and Air Quality APIs. https://open-meteo.com/ — Keyless, no-account weather, historical-archive, and air-quality data sources used by this integration; the historical weather archive lags roughly five days behind the present.',
          'World Health Organization (2021). WHO global air quality guidelines: particulate matter (PM2.5 and PM10), ozone, nitrogen dioxide, sulfur dioxide and carbon monoxide. Geneva: WHO. — Health basis and recommended limits for the air-quality pollutants surfaced here.',
          'United States Environmental Protection Agency (2024). Technical Assistance Document for the Reporting of Daily Air Quality — the Air Quality Index (AQI). EPA-454/B-24-002. — Definition and category bands of the US Air Quality Index.',
          'European Environment Agency. European Air Quality Index (EAQI). https://www.eea.europa.eu/themes/air/air-quality-index — Definition and category bands of the European AQI.',
          'Mason, R. H., Ryan, C. M., et al. (2010). Changes in sleep-disordered breathing at altitude and with ambient pressure. — On ambient/barometric pressure as a modifier of respiratory events and the loop-gain mechanisms by which pressure change can shift the obstructive/central balance. (Illustrative of the pressure-vs-events hypothesis; not a claim specific to your data.)',
        ],
      },
    ],
  },

  // ─── AI INSIGHTS ──────────────────────────────────────────────────
  {
    slug: 'ai-insights',
    title: 'AI Insights',
    summary:
      'The opt-in, off-by-default feature that turns your already-computed metrics into plain-language summaries — what it does and deliberately does not do, the four on-device and cloud backends and their privacy tradeoff, exactly what is and is not sent, the compute-then-narrate grounding and numeral validation, the non-diagnostic framing, and how to make a local server (Ollama/LM Studio) reachable.',
    icon: 'integrations',
    sections: [
      {
        heading: 'What AI Insights does — and what it deliberately does not do',
        paragraphs: [
          'AI Insights is an optional feature that turns the metrics the app has *already computed* — your AHI and its sub-indices, leak, pressure, usage, compliance, and the trends across a date range — into a few sentences of plain-language context. Instead of reading a screen full of numbers, you can ask for a summary like "your AHI last night was 3.2, below your 30-day average of 4.1; leak stayed within the normal band, and your usage was just over 7 hours." It can summarise a single night, summarise a date range, or explain one metric or chart you are looking at.',
          'The single most important thing to understand is the architecture, which we call **compute-then-narrate**. Every number is calculated by the app\'s deterministic analysis pipeline — the same code that draws your charts and fills your dashboard. The language model is handed a frozen snapshot of those *finished* figures and is allowed only to phrase and explain them in prose. It is a **narrator, not a calculator**. It never computes, averages, sums, re-derives, rounds, extrapolates, classifies a severity band, or introduces any number, date, or threshold that the app did not already compute. This is a hard design rule, not a preference: a model that invents a clinical figure is the worst failure a health tool can have, so the model is structurally prevented from being the source of any number (see ADR 0024 and the "Understanding Measurement Uncertainty" article).',
          'It is equally important to understand what AI Insights is *not*. It is not a chatbot — there is no free-form conversation over your raw data; you choose from a small, safe set of summary and explanation actions and suggested prompts, each of which maps to something the analysis pipeline already answers. It does not diagnose, does not prescribe, and does not recommend changing your therapy. And it is entirely optional and additive: the app is fully functional with the feature switched off (the default), and when it is off, no AI element appears anywhere in the product.',
        ],
      },
      {
        heading: 'The four backends, and the on-device vs cloud privacy tradeoff',
        paragraphs: [
          'AI Insights does not pick one model for you. It exposes a single interface with four interchangeable backends, ordered privacy-first, so you choose your own point on the privacy/quality curve. The first two run entirely **on your device and send nothing off it**; the second two are **bring-your-own-key cloud** services that produce more fluent prose in exchange for sending a small, bounded snapshot to a provider.',
          '**In-browser (WebLLM)** — the privacy default. A small open model is downloaded once (a multi-gigabyte file stored in your browser) and then runs locally on your GPU via WebGPU. After that one-time download, inference is **zero-egress**: no data — and not even the request — leaves your device. The model-weights download itself is a fetch from a model host, but it carries *none of your data*; it is just the model. WebGPU is required, and the on-disk size is disclosed before you download and counts against the same storage budget shown in Settings → Privacy & Storage. You can remove the model at any time.',
          "**Chrome built-in AI** — progressive enhancement. Recent versions of Chrome ship a small on-device model (Gemini Nano, exposed through the browser's Summarizer / Prompt APIs). When it is available, there is nothing for the app to download, and inference is again **zero-egress** — nothing leaves your browser. It is gated on having a supporting browser, and some states require a one-time on-device model provisioning that the browser handles.",
          "**Claude (your API key)** — highest quality, cloud. The app calls Anthropic's API directly from your browser using *your own* API key. This is a cloud backend: the grounded metric snapshot is sent to Anthropic (see the next section for exactly what that is). You choose the model (Opus, Sonnet, or Haiku); each request uses your own Anthropic account and incurs a small cost on it, whereas the on-device backends are free.",
          '**OpenAI-compatible / Ollama (your key + URL)** — flexible cloud or local. This single backend targets any endpoint that speaks the OpenAI API shape: OpenAI itself, aggregators like OpenRouter and Together, **and local servers such as Ollama or LM Studio** running on your own machine. You supply a base URL, an optional API key, and a model name. Because the base URL is yours, this backend spans both worlds: a remote URL is treated as **cloud** (the snapshot egresses, consent required), while a loopback URL such as `http://localhost:11434/v1` is treated as **on-device** (nothing leaves your machine, no consent dialog). Switching the URL from local to remote re-triggers the consent gate.',
          'The practical tradeoff: on-device backends give you the strongest possible privacy — a posture stronger than any other feature in the app, because *nothing at all* leaves the device — at the cost of more modest prose and (for WebLLM) a large one-time download and a capable GPU. Cloud backends give you the most fluent wording at the cost of disclosing a small, aggregate snapshot of computed numbers to a third party you have chosen. Local servers (Ollama / LM Studio) are a middle path: high-quality models that still run entirely on your own hardware.',
        ],
      },
      {
        heading: 'Getting and entering an API key (cloud backends)',
        paragraphs: [
          'Cloud backends use **your own** API key — there is no shared or built-in key, and there is no CPAP Analyzer account. For **Claude**, create an API key in the Anthropic Console (console.anthropic.com) under API Keys, then paste it into the Claude backend\'s "Claude API key" field in Settings → Integrations → AI Insights. For an **OpenAI-compatible** cloud endpoint, obtain a key from that provider (for example the OpenAI platform dashboard, or your OpenRouter/Together account) and enter it alongside the endpoint base URL and the model name. For a **local Ollama or LM Studio** server you typically need no key at all — leave the key field blank and point the base URL at your local server.',
          'Keys are stored **locally and never persisted to disk by default**. They are held in session-scoped memory and are cleared when the browser tab closes, which keeps the exposure window small. A key is sent only as the authorization header on requests *you* trigger, only to the provider you configured; it is never placed in the metric snapshot, never logged, and never transmitted anywhere else. The app does not silently "check" a key by making a hidden network call — the first real summary you generate is what validates it, and an authorization failure is surfaced as a plain "key was rejected" message pointing you back to settings.',
          'Because there is no telemetry of any kind, the app cannot see your key, your usage, or your prompts. The privacy and cost of a cloud backend are entirely between you and the provider whose key you supplied.',
        ],
      },
      {
        heading: 'Exactly what is sent on a cloud backend (and what never is)',
        paragraphs: [
          'On a cloud backend, the *only* thing that ever leaves your device is a **grounded metric snapshot**: a compact, aggregate object of already-computed numbers for the night or range you asked about. Concretely, it contains the summary metrics you can already see on screen — values like AHI and its sub-indices, median and 95th-percentile leak, usage hours, a pressure summary, event counts, and trend direction — each at the same display precision shown in the UI (numbers are sent as their rounded display strings, so the model cannot even surface an extra digit). It also carries the **calendar date or date range** you asked about, your active units and thresholds (so the wording matches your settings), and your machine *type* only (CPAP / APAP / BiPAP / VPAP / ASV).',
          'What **never** leaves your device, by hard contract: the **raw signals** (no flow, pressure, leak, or SpO₂ time-series, no 25–50 Hz waveform samples, no EDF files); **within-night detail** (no exact event timestamps, no bedtime or other clock times — only calendar dates); any **device identifier** (no machine serial number, firmware version, session IDs); your **notes and tags** (which are free text and may contain personal detail); your **location**; and any **account or integration identifier**. There is no CPAP Analyzer account, so a request carries only your own provider API key. None of your data from nights you did not ask about is ever included. This blocklist is enforced by a unit-tested serializer, and a "preview the exact payload" affordance lets you inspect the snapshot before it is sent.',
          'This egress is gated by an explicit **two-gate consent**, the same pattern the weather integration established. Turning the feature on (gate 1) does *not* by itself send anything — it reveals the configuration with the privacy-preferring local backend pre-selected. Only when you deliberately choose a cloud backend (gate 2) does a consent dialog appear, stating in plain language — a blue "what leaves your device" block and a green "what never leaves" block — exactly the contract above. Nothing egresses until you acknowledge it. The app records the moment you consented; if a future version ever changes *what* is sent, that recorded consent is treated as stale and you are re-asked before the next cloud request. A persistent reminder ("Sends a metric snapshot to <provider>; no raw data leaves your device") sits in the insight panel whenever a cloud backend is active, so the disclosure is present at the point of use, not just at setup. On-device backends show no consent dialog and no reminder, because there is genuinely nothing to disclose.',
        ],
      },
      {
        heading: 'Compute-then-narrate grounding, and the numeral-validation backstop',
        paragraphs: [
          'Two layers keep the prose honest. The first is **grounding**: the model receives a structured snapshot of finished numbers and a system prompt that instructs it to reference only values that appear literally in that snapshot, to quote each value and its unit exactly, never to compute or convert anything, to use only the thresholds the app provided (not cutoffs from its own training data — you may have configured custom AHI bands), to attach the app-authored reliability caveat whenever a metric is anything less than high-reliability, and never to diagnose. A metric that the recording was too short to compute (an undefined per-hour rate, which is *not* the same as zero) is flagged so the model describes it as "too short to compute a reliable rate," never as a low number.',
          'The second layer is a **deterministic, app-side validator** that runs on the model\'s output *before you ever see it* — this is the backstop that catches a hallucinated figure regardless of which backend produced it. While building the snapshot, the app mechanically assembles the exact set of numeric tokens that legitimately exist (every metric value, threshold, slope, p-value, night count, and so on). It then extracts every numeral from the generated prose and requires each one to match that allow-list (with only a tiny, documented set of safe small integers permitted for ordinary phrasing like "the first night"). A number in the prose that is **not** one the app computed — or a value quoted with the wrong unit, or a severity/compliance verdict that disagrees with the app\'s own — is treated as a failure: the app first asks the model to regenerate with the offending token called out, and if that fails again it discards the generated text entirely and falls back to a plain, app-rendered template summary built from the same snapshot, with a quiet "To stay accurate, this is the app\'s own computed summary rather than AI-written text." notice. **Fabricated text is never shown.**',
          'Because of these two layers, the worst hallucination failure mode — a confidently invented AHI or threshold — is designed out rather than merely discouraged. The numbers you read in an AI summary are, by construction, the same numbers the app computed; if they ever disagreed, that would be a bug the validator is built to catch. Every generated block also surfaces a collapsible "Based on these numbers" panel listing the exact source figures (with their units and severity labels, each linking to the deterministic glossary), so you can always check the prose against the data it was built from.',
        ],
      },
      {
        heading: 'Not medical advice — talk to your clinician',
        paragraphs: [
          'AI Insights is framed deliberately as **descriptive wellness context, not clinical judgement**. The wording is constrained to descriptive verbs ("shows", "stayed within", "trended down", "may be worth discussing") and is forbidden the diagnostic and prescriptive register ("you have…", "you should set your pressure to…", "this proves…"). It does not adopt a persona, does not present itself as a clinician, and does not agree-to-please. At most it will note, non-directively, that a pattern "may be worth discussing with your sleep physician." Every output also carries an inseparable caveat — **"AI-generated — may be inaccurate; verify against the numbers above"** — that cannot be displayed or copied without the warning attached.',
          'CPAP Analyzer is not a medical device, is not certified for diagnosis, and does not provide medical advice. AI Insights only rephrases metrics the app computed from your own data, and — like any generated text — it can still mislead by implying causation or sounding more confident than the data warrant, even when every number is correct. Always confirm an AI summary against the numbers shown, and bring anything new, sustained, or trending — especially a rising central-event pattern — to a qualified clinician, who can place it in the context of your full history. The AI puts your existing numbers into words; the interpretation that matters is the conversation you have with your healthcare provider.',
        ],
      },
      {
        heading: 'Why these guardrails (the design principles behind them)',
        paragraphs: [
          'The trust-and-safety choices above are not arbitrary; they follow established human-AI design guidance. From Google\'s People + AI Guidebook and Microsoft\'s Human-AI eXperience guidelines: make clear what the system can and cannot do, show your work so trust is calibrated to the data rather than to confident phrasing, keep a human in the loop, and never manufacture precision the model cannot justify — which is why AI Insights shows the source numbers under every summary, avoids fabricated "confidence percentages," and prefers categorical wording ("consistent with your usual pattern") over invented exact figures. From Apple\'s guidance on generative content and from consumer-health products such as Oura and Google Health: clearly label generated content, default the feature off and give people an off switch, design for graceful failure, and use wellness/descriptive language that defers to clinicians rather than diagnosing. The persistent "AI" label, the off-by-default posture, the comprehensive error handling, and the "prepare to talk with your clinician" framing all come directly from these precedents.',
        ],
      },
      {
        heading:
          'Troubleshooting a local server (Ollama / LM Studio): CSP and the default-port limit',
        paragraphs: [
          'If you point the OpenAI-compatible backend at a local server (for example Ollama at `http://localhost:11434/v1`, or LM Studio at `http://localhost:1234/v1`) and generation fails with a "couldn\'t reach the endpoint / connection blocked" message, the cause is almost always the app\'s **Content-Security-Policy (CSP)**, not the model server. CPAP Analyzer locks down outbound network access with a strict `connect-src` allowlist so that — outside the explicit, consented integrations — the app is *architecturally* unable to contact the network. The same policy that protects your privacy also decides which origins a cloud or local AI backend may reach.',
          "Two consequences follow from how that policy is delivered. First, because the app is served as static files (with no server to set HTTP headers), the CSP is injected as a build-time `<meta>` tag and therefore **cannot be widened at runtime to an arbitrary host you type**. To make local servers work out of the box, the policy allows **loopback origins** — `localhost`, `127.0.0.1`, and `[::1]` — so a local Ollama or LM Studio endpoint is reachable without weakening the policy for everyone. Second, a meta-tag CSP allowlists loopback at its **standard/default ports** (such as Ollama's `11434` and LM Studio's `1234`); a loopback server reconfigured to listen on a **non-standard port** may fall outside the allowlisted entry and be **blocked**, which is why a non-default port can fail even though the server is running and reachable from a normal browser tab. The fix is to run your local server on its **default port** (or the standard port the app expects) so its origin matches the allowlisted loopback entry. This is a deliberate limitation: the alternative — a wildcard `connect-src` — would re-open exactly the data-exfiltration surface the strict policy exists to close, so correctness and privacy are kept ahead of accommodating every arbitrary port.",
          'For the same reason, a genuinely arbitrary *remote* OpenAI-compatible host you type at runtime is **not supported in this phase**: it cannot be added to the static CSP without a wildcard. The supported cloud endpoints are the curated, named presets (Anthropic, OpenAI, and similar) whose origins are already in the allowlist. If you need a remote OpenAI-compatible provider that is not a built-in preset, that is a known capability limit, accepted on purpose to preserve the network lockdown. When a request is blocked this way, the error message says so plainly and points you to an on-device backend, which never needs a network connection at all.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'CPAP Analyzer ADR 0024 — Grounded, Opt-In AI Insights via a Multi-Backend Provider Abstraction. — The architectural decision record: compute-then-narrate grounding, the four-backend provider abstraction, the two-gate consent and CSP model, and the non-diagnostic safety framing.',
          'Google PAIR (People + AI Research). People + AI Guidebook. https://pair.withgoogle.com/guidebook/ — Calibrating user trust to model reliability, "explain for understanding," user feedback, and avoiding false precision.',
          'Amershi, S., Weld, D., Vorvoreanu, M., et al. (2019). Guidelines for Human-AI Interaction (the Microsoft HAX guidelines). Proceedings of CHI 2019. DOI: 10.1145/3290605.3300233. — Make clear what the system can do and how well; support efficient invocation and dismissal; show why the system did what it did.',
          'Apple. Human Interface Guidelines — Generative AI / Machine Intelligence. https://developer.apple.com/design/human-interface-guidelines/ — Disclose generated content clearly, set expectations, give people control and an off switch, and design for graceful failure.',
          'U.S. Food & Drug Administration (2022). Clinical Decision Support Software — Guidance for Industry and FDA Staff. — The clinical-decision-support / general-wellness distinction that informs the descriptive, non-directive wording. (Framing only; this is not a certification claim and the project seeks no medical-device clearance.)',
        ],
      },
    ],
  },

  // ─── UNDERSTANDING MEASUREMENT UNCERTAINTY ────────────────────────
  {
    slug: 'understanding-measurement-uncertainty',
    title: 'Understanding Measurement Uncertainty',
    summary:
      'Why every number carries error, how to read the reliability tiers and the typical-range band, why a multi-night trend beats a single night, and how leak, device limits, and consumer wearables shape what you can trust.',
    icon: 'statistics',
    featured: true,
    sections: [
      {
        heading: 'Why every number has error',
        paragraphs: [
          'The most common way a sleep-data tool misleads is not by computing the wrong number — it is by presenting a correct number with more confidence than that number deserves. Every metric here is an estimate, and an honest estimate comes with a sense of how much to trust it. This tool does not diagnose; it describes the data your machine and any paired sensors recorded, and it tries to be explicit about the uncertainty in that description.',
          'It helps to separate two kinds of error. Systematic error (bias) shifts every measurement in the same direction and does not average out — for example, a leak-model error that makes every tidal-volume estimate read high. Random error scatters measurements around the truth and does average out as you collect more nights. A number can be precise (reproducible) yet biased (consistently off), which is exactly the situation with a device AHI that is repeatable on the same input but differs from how a sleep lab would score the same night.',
          'A second, equally important split is between uncertainty that more data can fix and uncertainty it cannot. Limited nights, an unknown sensor offset, or an algorithm you cannot inspect are knowledge gaps that shrink as you gather more or better data. Genuine night-to-night biological variation — your airway really does behave differently with body position, sleep stage, alcohol, congestion, and overnight fluid shift — is a real feature of you, not noise to be hidden. The app aims to show the second kind, not paper over it.',
        ],
      },
      {
        heading: 'The reliability tiers, the chip, and the band',
        paragraphs: [
          'Each metric is assigned one of three reliability tiers. High-reliability metrics are directly measured: delivered pressure (the device actively regulates to it), usage / mask-on time (a simple timer), and unintentional leak below the device threshold. Moderate-reliability metrics are algorithmically detected from a leak-corrected flow estimate: the apnea/hypopnea counts and the AHI, tidal volume, minute ventilation, and respiratory rate. Low-reliability metrics are modeled inferences: the central-versus-obstructive split, the flow-limitation index, RERA, and consumer-wearable SpO₂ and multi-stage sleep.',
          'The reliability cue is quiet by default. A high-reliability metric carries no chip at all — the absence of a caveat is the trust signal. A chip appears only when it changes how you should read a value: on a low-tier modeled metric, when a data-quality condition (such as high leak or a very short session) is active, or when a single night sits right on a severity boundary. These cues use a neutral violet visual axis and always pair a shape and a text label with any color, so the signal never depends on color alone and never collides with the red/orange axis reserved for clinical severity.',
          'For trends, the headline AHI is shown as a rolling median line with a shaded band that is the empirical inter-quartile range (the middle 50%, from the 25th to the 75th percentile) of the recent nights — labelled the "typical nightly range." The band is deliberately not a textbook confidence interval of the mean: consecutive nights are correlated and your underlying state can shift (a new mask, a pressure change), which makes the usual narrow error bar both invalid and misleading. The empirical quartile band makes no normality assumption, widens honestly when your nights genuinely vary, and is consistent with a median centre line.',
          'Beneath the median line and band, a faint line traces the individual nights. On a wide date range there can be more nights than the chart has horizontal pixels, so several nights fall in each one-pixel column; a plain line through one value per column could then skip over a lone spike and hide it. To keep that line honest, on these dense ranges it is drawn as a per-column min–max envelope — each column spans from the lowest to the highest AHI among the nights inside it — so a single bad night is always visible rather than lost between pixels. Nights with no valid AHI stay gaps and are never drawn as zero. This affects only how the faint raw line is drawn; the median, the band, and every computed value are unchanged.',
        ],
      },
      {
        heading: 'Why a multi-night trend beats a single night',
        paragraphs: [
          'A single night is a noisy snapshot. In the largest study to date — over 11 million nights from more than 67,000 people using a validated under-mattress sensor — diagnosing sleep apnea from a single night misclassified roughly 20% of people, and classification reliability kept improving until it plateaued at around 14 nights of data (Lechat and colleagues, 2022, as reported by PubMed). The lesson is not that the device is broken; it is that one night simply does not pin down your typical state.',
          'There are two independent reasons. First, genuine biology: your airway behaviour varies night to night, and that variation is largest in the mild range where a category boundary is nearby. Second, counting noise: respiratory events behave like a random arrival process, so the relative precision of a rate improves only as the square root of the number of events. A short or low-event night therefore gives a wide, uncertain AHI even if the detector were perfect.',
          'A worked illustration: two nights both report AHI = 5.0, the normal/mild boundary. Night A has 30 events over 6 hours; night B has 5 events over 1 hour. The counting uncertainty on the rate is the square root of the event count divided by the hours — about ±0.9 /h for night A but about ±2.2 /h for night B. Night B\'s honest interval straddles "normal" and well into "mild." Same number, completely different confidence. This is why the app leads with a trailing multi-night statistic rather than last night\'s raw value, treats a single-night change of one or two events per hour as essentially flat, and annotates a value sitting on a boundary as "could fall either side" rather than asserting a category.',
        ],
      },
      {
        heading: 'How leak degrades flow-derived metrics',
        paragraphs: [
          'Unintentional mask leak is the most insidious error source because it is systematic and shared. The device estimates your breathing flow by subtracting a modelled leak from total flow; if that leak model is off, the error flows straight into every metric computed from the flow trace — tidal volume, minute ventilation, respiratory rate, the central/obstructive classification, and flow-based event detection — all at once. Because they share a common cause, those errors reinforce each other rather than cancelling, so a high-leak night should be read as "several correlated numbers are suspect," not "a few independent noisy readings."',
          "The application gates on leak in two graduated steps, matching the device's own reporting conventions. At the device large-leak red line (24 L/min) it raises a data-quality notice. At a higher threshold (30 L/min) it actually flags or suppresses the flow-derived metrics, because by then their morphology is too distorted to trust. The step is graduated rather than a hard cliff so that usable nights in the 24–30 band are not over-suppressed, and the robust aggregate apnea count — which tolerates leak far better than tidal volume does — is kept usable. These thresholds are ResMed device/reporting conventions, not clinical (AASM) standards, and are documented as such. The practical rule: on a high-leak night, trust pressure and usage, but discount the flow-derived numbers and the central/obstructive split.",
        ],
      },
      {
        heading: 'Device data is not a sleep study',
        paragraphs: [
          'A CPAP machine scores events from airflow and pressure alone, using a proprietary algorithm, and cannot see the EEG arousals that a laboratory polysomnogram uses. It also divides events by mask-on time rather than true sleep time. As a result, a device-reported AHI is not interchangeable with a lab-scored AHI — the mean difference is often small, but the limits of agreement (the spread of disagreement on any given night) are wide. Treat device events as a monitoring and screening signal that is excellent for tracking your own trend over time, not as a diagnostic substitute for a sleep study.',
          'The central-versus-obstructive split deserves a specific caution. The device tells the two apart by briefly probing the airway with a small pressure oscillation during an apnea (the forced oscillation technique) and watching the response — open airway implies central, closed implies obstructive. This probe is degraded by leak, and the device tends to under-call closed-airway central events; on top of that, when true central events are rare, even a small false-positive rate on the abundant obstructive pool inflates the central count. So the precise central number on any one night is low-precision. The safety-critical point: low precision lowers confidence in the number, it does not mean "ignore it." A sustained upward trend in central events still warrants a conversation with your clinician, because treatment-emergent central apnea is real and actionable. The app surfaces such a trend rather than burying it, and it never recommends a therapy change — for example, it will not suggest a switch to a different device mode, which is a clinician decision informed by the full clinical picture.',
        ],
      },
      {
        heading: 'Consumer wearables: SpO₂ and sleep stages',
        paragraphs: [
          'Wearable data is a welcome context layer, but its reliability varies sharply by sensor. A dedicated or cleared pulse oximeter (a finger transmissive device, or a calibrated ring) is a moderate-reliability measurement with an accuracy of roughly two percentage points, which is already enough that sub-percent SpO₂ digits are noise; a documented residual bias related to skin pigmentation also exists. A consumer wrist or ring SpO₂, by contrast, uses uncalibrated reflectance optics, is sensitive to motion and perfusion, tends to overestimate at darker skin tones, and is intended for wellness rather than measurement — read it as a trend, never as a clinical value.',
          'Wearable multi-stage sleep (Light / Deep / REM) is a modeled inference, not a measurement: without EEG the device cannot truly stage sleep, and agreement with polysomnography is moderate at best and worse in disordered sleep. It is genuinely useful for locating when event clusters fall — for example, whether your apneas concentrate in REM-dominant stretches — but the exact minutes in each stage should be taken loosely. For every oximetry-derived number, read it next to the oximetry coverage percentage: a dramatic minimum or T90 computed over only a few minutes of valid signal is not reassuring, just under-sampled.',
        ],
      },
      {
        heading: 'A note on the per-night sampling interval',
        paragraphs: [
          'For low-count nights the app can show a per-night sampling interval around the AHI. It is computed from the event count as a Poisson (counting) interval: for larger counts the standard error of a count is approximately its square root, $u(N) \\approx \\sqrt{N}$, so the AHI uncertainty is $u(\\text{AHI}) = \\sqrt{N}/T$ where $T$ is the recorded hours; for small counts an exact form is used instead, and a night with zero scored events still has a nonzero upper bound rather than an impossible "exactly zero."',
          'This interval is deliberately labelled a lower bound on uncertainty, never "the 95% confidence interval." Real apnea events cluster — in REM, in supine position, in arousal cascades — so the true spread is wider than a pure counting model implies. Rather than invent an inflation factor that could not be justified from one night, the app accounts for that extra, real spread at the multi-night level, where the empirical typical-range band captures it directly. So: read the per-night interval as "at least this uncertain," and lean on the trend band for the fuller picture.',
        ],
      },
      {
        heading: 'The bottom line: surface, do not diagnose',
        paragraphs: [
          'The guiding posture is to surface patterns and defer interpretation to your clinician. Trust the high-reliability numbers (pressure, usage) plainly. Read the moderate ones (AHI, leak, the flow-derived metrics) as good trend trackers that are not lab-grade and degrade under leak. Treat the low ones (the central/obstructive split, flow limitation, RERA, consumer-wearable SpO₂ and sleep stages) as modeled estimates — informative as trends, not as precise single values. Prefer the multi-night median and its typical-range band over any single night, and take any value on a severity boundary as ambiguous.',
          'Above all, a low reliability tier lowers the precision claim; it never silences a clinically important trend. CPAP Analyzer is not a medical device, is not certified for diagnosis, and does not provide medical advice. Bring the patterns it surfaces — especially anything new, sustained, or trending across a boundary — to a qualified clinician, who can place them in the context of your full history.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Lechat, B., Naik, G., Reynolds, A., et al. (2022). Multinight Prevalence, Variability, and Diagnostic Misclassification of Obstructive Sleep Apnea. American Journal of Respiratory and Critical Care Medicine, 205(5), 563–569. DOI: 10.1164/rccm.202107-1761OC. PMID: 34904935. — Single-night diagnosis misclassifies ~20% of people; reliability plateaus after ~14 nights.',
          'Prasad, B., Usmani, S., Steffen, A. D., et al. (2016). Short-Term Variability in Apnea-Hypopnea Index during Extended Home Portable Monitoring. Journal of Clinical Sleep Medicine, 12(6), 855–863. DOI: 10.5664/jcsm.5886. PMID: 26857059. — Night-to-night AHI variability, larger in the mild range.',
          'Bland, J. M., & Altman, D. G. (1986). Statistical methods for assessing agreement between two methods of clinical measurement. The Lancet, 1(8476), 307–310. DOI: 10.1016/S0140-6736(86)90837-8. PMID: 2868172. — Bias versus limits of agreement, the lens for device-versus-sleep-study comparison.',
          'JCGM 100:2008. Evaluation of measurement data — Guide to the expression of uncertainty in measurement (GUM). Joint Committee for Guides in Metrology / BIPM. — Vocabulary of systematic versus random uncertainty and the propagation of uncertainty.',
          'Kapur, V. K., Auckley, D. H., Chowdhuri, S., et al. (2017). Clinical Practice Guideline for Diagnostic Testing for Adult Obstructive Sleep Apnea: An AASM Clinical Practice Guideline. Journal of Clinical Sleep Medicine, 13(3), 479–504. DOI: 10.5664/jcsm.6506. — Polysomnography is the diagnostic standard; device-derived event counts are a screening signal.',
          'ResMed. Unintentional leak is flagged as a large leak at 24 L/min (device/manufacturer convention; some oronasal masks use ~36 L/min). This is a device threshold, not an AASM clinical standard.',
        ],
      },
    ],
  },
] as const;

/** Map of article slug → article for O(1) lookup */
export const articleMap: ReadonlyMap<string, HelpArticle> = new Map(
  helpArticles.map((a) => [a.slug, a]),
);

/** Article slugs in display order */
export const articleSlugs: readonly string[] = helpArticles.map((a) => a.slug);

---
name: Token
description: Compact live workspace for tutor-led exam preparation
colors:
  canvas: "#f5f7fb"
  surface: "#ffffff"
  rail: "#eef3ff"
  border: "#e3e8f2"
  text: "#1b2333"
  text-muted: "#7b869c"
  action-blue: "#2f6bff"
  action-blue-soft: "#e8efff"
  success: "#16a34a"
  success-soft: "#e8f8ee"
  warning: "#d97706"
  warning-soft: "#fff4e0"
  danger: "#dc2626"
  danger-soft: "#fdeaea"
  code-violet: "#7c3aed"
  code-violet-soft: "#f2ecff"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Inter, Roboto, sans-serif"
    fontSize: "26px"
    fontWeight: 750
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Inter, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Inter, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Inter, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.06em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.62
rounded:
  tag: "6px"
  compact: "9px"
  control: "10px"
  panel: "14px"
  pill: "99px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  panel: "13px"
  page-x: "18px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    typography: "{typography.body}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "13px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.compact}"
    padding: "8px 10px"
    typography: "{typography.code}"
  status-chip:
    backgroundColor: "{colors.action-blue-soft}"
    textColor: "{colors.action-blue}"
    rounded: "{rounded.pill}"
    padding: "5px 11px"
    typography: "{typography.label}"
---

# Design System: Token

## Overview

**Creative North Star: "The Live Lesson Control Room"**

Token is a compact operational workspace: the page keeps the lesson stage, task, live student work, validation and group state visible as one connected field. Its visual world is calm and technical rather than decorative—dark working surfaces when the system preference is dark, clear tonal panels, restrained blue action color and status hues that communicate meaning at a glance.

Density is intentional. Small type and tight controls support scanning during a live lesson, while stable cards, strong alignment and generous separation between columns prevent the interface from becoming noisy. Light and dark themes preserve the same semantic hierarchy.

**Key Characteristics:**

- Compact, information-rich desktop workspace
- Blue reserved for navigation, selection and primary action
- Semantic green, amber and red used consistently for learning state
- Monospace reserved for code, answers, timers and test runs
- Tonal depth with quiet shadows and hairline borders

## Colors

The palette combines cool neutral work surfaces with one saturated action blue and a compact semantic status set. The tokens above describe the shared light palette; dark-theme counterparts are supplied by CSS under `prefers-color-scheme: dark`.

### Primary

- **Action Blue** (`#2f6bff`): active navigation, current stage, selected controls, links and primary actions.
- **Action Blue Soft** (`#e8efff`): selected rows, mode-switch tracks and informational states.

### Secondary

- **Success Green** (`#16a34a`) with **Success Soft** (`#e8f8ee`): correct, complete, connected and accepted states.
- **Warning Amber** (`#d97706`) with **Warning Soft** (`#fff4e0`): waiting, attention, tutor annotations and help requests.
- **Danger Red** (`#dc2626`) with **Danger Soft** (`#fdeaea`): errors, failed checks and destructive or return states.
- **Code Violet** (`#7c3aed`) with **Code Violet Soft** (`#f2ecff`): code syntax and avatar accents, not a competing product action color.

### Neutral

- **Canvas** (`#f5f7fb`): page and inset-control background.
- **Surface** (`#ffffff`): cards, active segmented controls and fields.
- **Rail** (`#eef3ff`): navigation surface.
- **Border** (`#e3e8f2`): dividers, field strokes and row boundaries.
- **Ink** (`#1b2333`) and **Muted Ink** (`#7b869c`): primary and supporting text.

### Named Rules

**The Semantic Color Rule.** Blue means action or live selection; green, amber and red retain their success, attention and error meanings across cards, cells and controls.

## Typography

**Display Font:** none; Token does not use a decorative display face.

**Body Font:** system sans (`-apple-system`, BlinkMacSystemFont, Segoe UI, Inter, Roboto, sans-serif)
**Label/Mono Font:** system sans for labels; `ui-monospace`, SFMono-Regular, SF Mono, Menlo, Consolas for code and numeric work

**Character:** Neutral system typography keeps the dense application fast and familiar. Hierarchy comes from compact size, weight, casing and alignment rather than oversized display copy.

### Hierarchy

- **Headline** (750, `26px`, `1.5`): conventional page titles outside the lesson shell.
- **Title** (700–750, `14–15px`, `1.5`): task titles and primary card content.
- **Body** (400, `13.5–15px`, `1.5–1.6`): conditions, notes and general application copy.
- **Label** (700–750, `11–12px`, `0.06em`, uppercase where sectional): compact section headings, table headers and status labels.
- **Code** (400, `13.5px`, `1.62`): editor lines; the same mono family also carries answers, timers and test data.

### Named Rules

**The Scan Before Read Rule.** Use weight, color and compact labels to expose state before adding explanatory prose; reserve large type for true page-level hierarchy.

## Layout

The lesson shell begins with a fixed `64px` navigation rail and a sticky, wrapping lesson header. Its desktop working grids are role-specific: individual lessons use `296px / flexible / 272px`, group lessons use `flexible / 316px`, and the student view uses `flexible / 300px`. Columns and stacked cards use a recurring `12px` gap; panels use `13px` internal padding and the working canvas uses `18px` horizontal padding.

The individual tutor, group tutor and student layouts are populated from the real lesson DTO and role-filtered attempt data, not parallel demo models. Tutor views lead with the task list or group matrix and a selected student's work; the student view leads with the selected prompt and their own draft, followed by lesson tasks, links, truthful summary and received tutor hints. Missing links, tasks or attempts render compact empty states rather than fixture content.

At `1480px` tool rows wrap rather than pushing a side panel out of view. At `1180px` the individual layout becomes two columns and its supporting stack moves below. At `900px` all workspaces collapse to one column and the rail becomes a fixed `60px` bottom bar. At `560px`, page padding tightens to `10px`, secondary header detail hides and dense grids become single-column.

## Elevation & Depth

Token uses a hybrid of tonal layering, hairline borders and quiet ambient shadows. Cards sit above the canvas with `0 1px 2px rgba(20,30,60,.05), 0 8px 24px rgba(20,30,60,.06)` in light mode; active navigation alone receives a more explicit blue lift. The sticky lesson header uses a translucent surface and `8px` backdrop blur to preserve context over scrolling content.

### Shadow Vocabulary

- **Panel Ambient** (`0 1px 2px rgba(20,30,60,.05), 0 8px 24px rgba(20,30,60,.06)`): cards and contained work surfaces.
- **Active Navigation** (`0 4px 12px rgba(47,107,255,.28)`): current rail destination only.
- **Segmented Selection** (`0 1px 3px rgba(20,30,60,.14)` in light mode): selected mode within a tonal track.

### Named Rules

**The Quiet Depth Rule.** Establish structure with surface tone and borders first; use visible lift only to reinforce a selected or persistent interactive layer.

## Shapes

The form language is softly rounded and compact. Cards use `14–16px` corners, controls cluster around `9–11px`, tags use `6–7px`, and stage/filter/status pills use `99px`. Circular geometry is reserved for avatars, connectivity dots and badges. Borders are thin and cool; clipped, flush cards contain editors and tables without nested outer rounding.

## Components

### Buttons

- **Shape:** compact rounded rectangle (`9–11px`), with pill geometry only for filters and lesson stages.
- **Primary:** Action Blue with white text; lesson controls use `8px 13px`, while general application actions may use `11px 20px`.
- **Hover / Focus:** incumbent buttons reduce opacity or invert a blue outline variant; fields shift their border to Action Blue. New keyboard-interactive work must retain an explicit visible focus treatment.
- **Ghost:** transparent with a border and muted or blue text; becomes blue-filled only where the incumbent outline variant already behaves that way.

### Chips

- **Style:** compact `6–9px` horizontal padding, tonal fill, bold `11–12px` label.
- **State:** pills represent stages and filters; small-radius tags represent metadata. Selected stages and filters use Action Blue, while semantic chips use their status pair.

### Cards / Containers

- **Corner Style:** `14px` on lesson cards; `16px` is the broader application default.
- **Background:** Surface over Canvas; tonal semantic fills are reserved for status summaries.
- **Shadow Strategy:** Panel Ambient, supported by borders and tonal separation.
- **Internal Padding:** `13px` for the live lesson; `20px` for broader application cards.

### Inputs / Fields

- **Style:** Surface background, Border stroke, `9–11px` radius and compact padding. Code-answer inputs use the mono family.
- **Focus:** border shifts to Action Blue without changing layout.
- **Error / Disabled:** errors use Danger Soft/Danger; disabled prototype actions are visibly reduced in opacity and must not imply server availability.

### Navigation

The lesson rail is icon-dense, `64px` wide and sticky. Destinations occupy `38px` high rounded targets; muted icons become blue-on-soft-blue on hover and white-on-blue when active. Below `900px`, the same navigation becomes a fixed bottom bar. Badges use compact red pills.

### Live Work Surface

The full task prompt sits immediately above the code surface in the main lesson flow and in the group focus workspace. It uses the same card language, but increases the task title to `18px` (`16px` below `900px`) and allows the condition to run to `78ch`, so the editor never starts without its problem context.

The code editor is a flush card region with a monospace `13.5px/1.65` rhythm, `38px` line-number column and semantic syntax colors. It is always directly editable: a transparent textarea owns selection, keyboard input and the blue caret, while an exactly aligned presentation layer renders highlighting. Automatic indentation follows a Python block colon, and `Tab` inserts four spaces.

Execution and validation results belong in the editor footer rather than a detached card. The editor header keeps only Run and Laser. Laser is a transient red teaching gesture drawn over code and faded after the pointer path; double-click opens the contextual hint composer. In group mode, selecting a student or task cell opens a near-full-viewport focus workspace instead of squeezing code into the monitoring sidebar.

These interactions are production-connected. Execution remains local to the in-page Skulpt runtime and does not affect learning metrics. Student draft edits persist as progress; tutor edits use a role-checked coaching command that changes code only. Keystrokes travel once per animation frame as transient `code_live` updates while debounced writes preserve the database source of truth. Structural invalidations refresh the lesson DTO automatically. Laser trails stream as start, point-batch and end events so the student sees the tutor's stroke while it is being drawn. Laser and hint gestures remain transient rather than database records. The student surface never exposes the Laser control; it only renders a tutor trail addressed to that student and task.

Tutor lesson surfaces include a compact homework composer alongside the lesson summary. It inherits the current individual student or group, lists the lesson tasks as explicit checkboxes, requires a title and deadline, prevents duplicate submission while pending and leaves a durable success message after the lesson DTO refreshes. Completing a lesson returns the tutor to Today; opening the generic lesson route never resurrects an already completed lesson.

**The Statistics Truth Rule.** Only student activity and answer/submission flows may change active time, tries or correctness. A failed automatic check becomes an evaluated error immediately, while the task remains open for another attempt. Tutor coaching, local Run, hints and laser gestures must never increment or rewrite those statistics.

### Group Progress Grid

The grid is a dense status matrix with stable identity columns and `30px` rounded cells. Each cell combines a symbol or compact time with the semantic color pair, so color is never the sole carrier of state. Horizontal scrolling preserves the table below its `720px` content minimum.

## Do's and Don'ts

### Do:

- **Do** keep lesson state, task context and live work visible within one spatial system.
- **Do** use the `12px` workspace rhythm and compact `9–14px` corner family for new lesson surfaces.
- **Do** pair status color with text, a symbol or a numeric value.
- **Do** preserve both light and dark semantic contrast when introducing a token.
- **Do** wrap dense toolbars before they can displace fixed-width supporting columns.
- **Do** place the expanded task prompt above every full-size editing context, including the group focus overlay.
- **Do** derive individual, group and student content from the lesson DTO and role-filtered attempt data, including honest empty states.

### Don't:

- **Don't** use status green, amber or red as arbitrary decoration or competing primary actions.
- **Don't** introduce oversized editorial typography into the live lesson workspace.
- **Don't** add heavy shadows where a tonal surface and border already establish grouping.
- **Don't** let tutor coaching, local execution or realtime gestures increment student time, tries or correctness.
- **Don't** expose tutor-only coaching controls in the student toolbar.
- **Don't** let coaching mutate attempt fields other than code, even when the tutor is editing the student's live draft.
- **Don't** treat one-off demo names, dates, timers, counts or KPI values as design tokens or product truth.

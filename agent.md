# AGENTS.md

# DueDiligence.ph Engineering Constitution

This document defines the engineering standards for every AI agent or developer working on this project.

These rules are permanent.

They take precedence over convenience, speed, or unnecessary experimentation.

---

# Mission

Build the most trusted AI-assisted Philippine Bar Examination Essay Review Platform.

Every engineering decision must increase one or more of the following:

* Accuracy
* Reliability
* Maintainability
* Performance
* Security
* User Experience

If a proposed solution does not improve the product, do not implement it.

---

# Examination Room Blank-Slate Boundary

The former Examination Room is intentionally decommissioned. It is not an
existing feature to repair, renovate, preserve, or improve. This section
overrides **Repository First**, renovation references, and compatibility
preferences for Examination Room work.

Until the owner explicitly begins a new Examination Room build, the feature
must remain absent from the public interface, Admin, frontend modules, Worker
routes, email and queue flows, storage integrations, configuration, tests,
fixtures, and product documentation.

When the owner begins the replacement:

* Derive requirements only from the owner's new prompts and newly approved
  artifacts.
* Do not restore, cherry-pick, copy, translate, adapt, or treat as a starting
  point any deleted implementation, old branch, pull request, commit, plan,
  screenshot, evidence file, or historical Examination Room migration.
* Do not inspect those retired materials for product or implementation guidance
  unless the owner explicitly requests a forensic comparison.
* Create the architecture, data contracts, user journeys, UI, and tests as a
  greenfield implementation. Add no legacy compatibility layer or fallback
  unless the owner explicitly requests one.
* Treat applied Supabase migrations and dormant database objects only as an
  immutable environment ledger. They are not a specification and must not be
  reused by the new implementation.
* Keep the separate Simulator and `/examinations/*` engine protected. It is not
  part of the retired Examination Room and must not be modified merely because
  it uses examination terminology.
* Replace the decommission boundary guard only in the first reviewed commit that
  intentionally introduces the new feature. Never weaken it silently.

---

# Controlling Due Diligence Design Standard

This section supersedes every conflicting visual instruction. It is a release gate, not an optional cosmetic preference.

## Approved renovation reference — 2026-08-21

For ordinary Due Diligence product surfaces, the approved renovation contract in
`docs/visual-references/approved-renovation-20260821.md` is the controlling visual reference.
Implementations must preserve at least a 90% visual match to that reference. When a literal match is
not technically safe, resolve design decisions in this order: modern, legal, professional. Never replace
the approved composition with a generic dashboard, speculative feature, or unrelated template.

## Master design goal

Every redesigned or repaired surface must visibly belong to the same Due Diligence product family already established by the strongest existing interfaces—particularly:

* Bar Easy
* Doctrines
* Existing official Due Diligence branding

Codex must improve and standardize the website without replacing its identity with a generic template.

The result must feel:

* Professional
* Restrained
* Editorial
* Luxurious
* Human-designed
* Appropriate for a Philippine legal-education platform

It must not look like:

* A free website template
* A generic AI-generated dashboard
* A collection of unrelated feature designs
* A conventional SaaS card grid
* A page assembled from excessive pills, badges, shadows, and boxes

## Bar Easy and Doctrines are the visual references

Before changing shared styles, Codex must inspect the actual live Bar Easy and Doctrines interfaces at desktop and mobile.

Record their current:

* Background colors
* Gold and ivory colors
* Heading font
* Body font
* Label font
* Font sizes
* Font weights
* Line heights
* Letter spacing
* Button treatment
* Border treatment
* Spacing rhythm
* Question typography
* Content width
* Responsive behavior
* Hover, focus, loading, and disabled states

Use their strongest existing visual characteristics as the standard for affected pages.

Do not merely approximate them from memory. Inspect their actual live computed styles and existing design tokens.

Do not substantially redesign Bar Easy or Doctrines. They are reference surfaces. Change them only if a shared header or shared control correction is necessary and safely tested.

## Unified visual language

### Colors

Use the established Due Diligence palette:

* Deep navy as the main canvas
* Ivory or warm white for primary text
* Muted antique gold for emphasis
* Softer navy variations for depth
* Restrained neutral colors for secondary text
* Red only for genuine destructive actions or urgent errors
* Green only for confirmed success

Avoid:

* Bright yellow-gold gradients
* Excessive glow
* Random blue gradients
* Pure black containers
* Multiple unrelated background colors
* Feature-specific color schemes that make the website look fragmented

Gold should guide attention. It must not cover large portions of the interface.

### Typography

Use only the verified existing production font families already associated with Bar Easy, Doctrines, and the Due Diligence brand.

Required typography hierarchy:

* Editorial serif for major headings, questions, and important legal material
* Existing readable sans-serif for body copy, controls, instructions, and feedback
* Existing restrained label style for small metadata where appropriate

Codex must not introduce:

* Additional decorative fonts
* Random system fonts
* Georgia as an unplanned substitute
* Unrelated monospace fonts
* Different fonts for every feature
* All-capital body paragraphs
* Excessive letter spacing
* Tiny legal-study text

Audit and remove accidental font inconsistencies across affected pages.

The same element type should use the same typographic treatment everywhere:

* Page title
* Section heading
* Question
* Body paragraph
* Legal basis
* Button
* Form label
* Metadata
* Error message
* Success message

Font fallback behavior must also be tested when external font delivery fails.

## Standard button system

Create one shared Due Diligence button system.

### Primary action

Use for the main next step:

* Restrained gold background
* Dark navy text
* Strong readable label
* Clear hover and pressed states

Examples:

* Start
* Submit
* Continue
* Publish
* Save and continue
* Send selected grades

### Secondary action

Use for important alternatives:

* Navy or transparent background
* Ivory text
* Restrained gold or neutral border

Examples:

* Back
* Preview
* Review my work
* Download PDF
* Timer settings

### Tertiary action

Use for low-emphasis actions:

* Text treatment
* Clear underline, arrow, or hover state
* No unnecessary container

Examples:

* Change course
* View details
* Return to chamber

### Disclosure control

Use for:

* Reveal suggested legal basis
* Why this legal basis applies
* Guidance
* Accordions and expandable information

Requirements:

* Clear chevron
* Visible expanded and collapsed state
* Entire label is clickable
* Keyboard accessible
* No misleading button styling

### Destructive action

Reserve destructive styling for:

* Delete
* Cancel examination
* Revoke
* End immediately
* Permanent removal

Do not use destructive styling for ordinary Back, Close, or Cancel-navigation actions.

## Button alignment requirements

Buttons in the same action group must:

* Share the same height
* Use the same vertical padding
* Use the same border thickness
* Use compatible corner radius
* Share aligned text baselines
* Align icons and chevrons consistently
* Use consistent capitalization
* Maintain consistent horizontal gaps
* Remain aligned when one label wraps
* Reflow deliberately on mobile

Minimum touch target:

* 44×44 pixels

Preferred standard control height:

* Use the existing Bar Easy/Doctrines control height where it meets accessibility requirements
* Do not invent a different height for every page

Do not force every button to have the same width. Use content-appropriate widths within an aligned grid.

Full-width buttons should be used only where the layout genuinely requires them.

Prohibit:

* One tall button beside one short button
* Misaligned Back and Continue controls
* Icons floating above or below text
* Different corner radii in the same action group
* Mixed sentence case and ALL CAPS without purpose
* Buttons that move when loading text appears
* Invisible or overly subtle disabled states
* Nested clickable buttons
* Decorative layers intercepting clicks

Every button must have defined:

* Default state
* Hover state
* Keyboard-focus state
* Pressed state
* Loading state
* Disabled state
* Success state where appropriate
* Error recovery state

## Header standard

Use one consistent two-level Due Diligence header.

### Top row

* Official logo and wordmark
* Existing motto
* Account or Sign in

### Navigation row

* The Academy
* The Commons
* BarBound
* Support
* The Docket

Required behavior:

* Chamber name navigates to its chamber page.
* Separate chevron opens its feature menu.
* Header controls align to a shared baseline.
* Navigation controls use a consistent visual family.
* Active location uses restrained emphasis.
* Header behavior remains the same on homepage and chamber pages.
* Mobile uses one accessible navigation menu.
* Header must not cover focused content or create horizontal overflow.

The header may adapt inside active examination workspaces where the timer and examination status require a more focused shell. It must still use the same typography, colors, and control standards.

## Homepage and chamber consistency

The homepage and chamber pages must feel like consecutive pages of the same publication.

They must share:

* Header
* Background
* Typography
* Page width
* Gold treatment
* Spacing rhythm
* Screenshot framing
* Button hierarchy
* Footer
* Responsive breakpoints

Do not design a luxurious homepage followed by generic chamber pages.

The chamber pages must not become:

* Repeated boxed feature grids
* Lists of identical cards
* Oversized marketing copy
* Walls of text
* Collections of unrelated CTA styles

Use real product screenshots, editorial typography, generous spacing, and restrained dividers.

## Subject Matter visual standard

Subject Matter must visually belong to the Bar Easy and Doctrines family.

Use:

* Deep navy canvas
* Ivory text
* Gold accents
* Large serif question
* Calm two-pane layout
* Minimal containers
* One clear reading flow
* Standardized buttons
* Consistent reveal controls

Desktop:

* Approximately equal two-pane division
* Center divider aligned cleanly
* No competing full-page scrollbars

Left:

* Course and context
* Question
* Reveal suggested legal basis
* Reveal why the legal basis applies
* Reveal guidance

Right:

* Optional answer editor
* Save and submission actions
* Coaching and evaluation after submission
* Suggested answer and discussion where applicable

All three reveal controls begin closed.

Expanding them must not change fonts, create white card stacks, or cause unexplained page jumps.

Subject Matter must not revert to:

* Cream background
* Dark text on large white cards
* Primitive long subject list
* ALAC-only instructions
* Question-bank totals
* Generic instructions masquerading as legal authority

## Error and system-message design

Errors must use the same visual standard.

Do not display large generic technical banners that visually dominate the page.

Every error must have:

* Plain-language title
* Short explanation
* Effect on saved work
* Specific next action
* Retry where safe
* Incident reference only when useful

Remove technical wording such as:

* Server-acknowledged
* Worker
* RPC
* RLS
* Database row
* Schema cache
* API payload

Fallback messages must not hide known authorization, lifecycle, PDF, email, or database failures. Known errors require specific messages.

## Consistency audit

Codex must create a visual-consistency inventory covering:

* Font families
* Font sizes
* Heading levels
* Button types
* Button heights
* Border radii
* Colors
* Shadows
* Input heights
* Modal widths
* Form spacing
* Card treatments
* Header implementations
* Footer implementations
* Loading indicators
* Error presentations
* Empty states

Every one-off style must be:

1. Justified by a genuine feature requirement;
2. Replaced with a shared design token; or
3. Removed.

Do not globally replace working CSS without checking affected features.

## Visual approval gate

Before implementing the design, Codex must provide matching previews for:

* Desktop homepage
* Mobile homepage
* Academy chamber page
* Commons chamber page
* BarBound chamber page
* Shared header
* Subject Matter with reveals closed
* Subject Matter with legal basis open
* Subject Matter with guidance open
* Representative button groups
* Representative error state

Compare these with actual live Bar Easy and Doctrines screenshots at the same viewport.

Owner approval must be based on the visible preview—not source-code assertions.

## Visual testing requirements

Test at:

* 1440 pixels
* 1024 pixels
* 768 pixels
* 390 pixels
* 375 pixels
* 320 pixels
* 200% zoom

Verify:

* Fonts load correctly
* Fallback fonts remain presentable
* Buttons remain aligned
* Labels do not clip
* Action groups wrap deliberately
* No horizontal overflow
* No overlapping controls
* No header obstruction
* No layout jump when controls load
* Legal content remains readable
* Reveal sections remain usable
* Focus states are visible
* Touch targets remain large enough
* Screenshot images retain proper proportions

## Final design definition of done

The design work is complete only when:

* Bar Easy, Doctrines, Homepage, Chamber pages, and Subject Matter visibly belong to one Due Diligence system.
* No affected page introduces an unapproved font.
* All button groups are aligned.
* Primary, secondary, tertiary, disclosure, and destructive actions are visually consistent.
* Homepage and chamber pages use the same editorial motif.
* Real feature imagery is used consistently.
* Subject Matter matches the Bar Easy/Doctrines visual family while retaining its review-specific functions.
* Error messages follow the same professional design standard.
* No generic AI-template visual patterns remain.
* Every visual preview is approved.
* The deployed production screenshots match the approved previews.
* Functional behavior, accessibility, and user data remain preserved.

---

# Engineering Philosophy

Treat this project as production software.

Never write prototype-quality code.

Never write temporary solutions unless explicitly requested.

Every implementation should be production-ready.

Every change should leave the codebase better than it was before.

---

# Standard of Excellence

Do not settle for code that merely works.

Deliver code that is:

* Elegant
* Readable
* Maintainable
* Modular
* Efficient
* Well-structured

Prefer excellence over shortcuts.

Prefer clarity over cleverness.

Prefer simplicity over unnecessary complexity.

---

# Simplicity

Less is more.

The simplest correct solution is usually the best solution.

Do not introduce new libraries, frameworks, abstractions, or files unless they provide clear long-term value.

Avoid overengineering.

Avoid premature optimization.

Avoid unnecessary code.

---

# Repository First

Before making any change:

Understand the existing architecture.

Understand why the code was written that way.

Respect existing working functionality.

Improve the system instead of replacing it.

Never perform large rewrites unless they are technically justified.

---

# Quality Before Speed

Speed is valuable.

Quality is mandatory.

Never sacrifice architecture simply to finish faster.

Never accept technical debt when a clean solution is reasonably achievable.

Every feature should be implemented as if it will remain in production for years.

---

# AI Responsibilities

Own the assigned task from start to finish.

Your responsibilities include:

* understanding the repository
* planning the implementation
* writing code
* testing
* debugging
* improving
* documenting when necessary
* committing changes
* deploying when authorized by the project workflow

Do not stop at code generation.

Deliver completed engineering work.

---

# Code Standards

Every modification should improve the overall codebase.

Avoid duplication.

Prefer reusable components.

Keep functions focused.

Keep modules cohesive.

Write code that another senior engineer would immediately understand.

If a simpler implementation exists with equal quality, choose the simpler implementation.

---

# Testing

Assume nothing.

Verify everything.

Run all available tests.

Fix failures before considering the task complete.

Never knowingly leave the repository in a broken state.

---

# Deployment

Never deploy code that you would not confidently use in production.

Verify:

* successful build
* passing tests
* working application
* no obvious regressions

Quality is more important than release speed.

---

# Security

Never expose secrets.

Never commit credentials.

Protect user data.

Validate user input.

Follow secure engineering practices by default.

---

# AI Accuracy

AI is an educational assistant.

It is not the legal authority.

The application's curated legal database is always the source of truth.

Never fabricate:

* jurisprudence
* doctrines
* legal citations
* quotations
* legal authorities

If reliable information is unavailable, clearly state the limitation.

---

# Decision Framework

When choosing between multiple solutions, prioritize them in this order:

1. Correctness
2. Legal accuracy
3. Reliability
4. Maintainability
5. Simplicity
6. Performance
7. Development speed

---

# Continuous Improvement

Leave the codebase cleaner than you found it.

Reduce complexity whenever possible.

Refactor only when it provides measurable long-term benefit.

Every commit should move the project closer to production.

---

# Guiding Principle

Do not ask:

"Does this work?"

Ask:

"Is this the best implementation that is practical for this project?"

If the answer is no, improve it.

Build software with craftsmanship.

The reputation of DueDiligence.ph depends on the quality of every line of code.

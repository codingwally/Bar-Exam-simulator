# Due Diligence Visual-Consistency Inventory

This inventory is the design-review checklist required before a shared-style implementation. The target column is controlling; the current-state notes are evidence from the 2026-08-15 live Bar Easy and Doctrines audit plus the production styles that render those surfaces.

| Category | Current reference evidence | Controlling target | Gate status |
|---|---|---|---|
| Font families | Playfair Display for headings/questions; Inter for body and fields; IBM Plex Mono for labels and many buttons | Playfair Display and Inter are primary; existing label face is limited to small metadata | Preview required |
| Font sizes | 57.6px desktop title; 36px mobile title; 36px desktop legal prompt; 25px mobile legal prompt; 16px body | Reuse this hierarchy with responsive clamps and no tiny legal text | Baseline recorded |
| Heading levels | Clear H1 page title and H2 legal prompt/doctrine | Preserve semantic order and consistent visual treatment | Baseline recorded |
| Button types | Gold primary, translucent secondary, chips, header controls | Shared primary, secondary, tertiary, disclosure, and destructive families | Preview required |
| Button heights | 46px study actions; 40–44px header; chips 32px or 44px when wrapped | 44px minimum target; aligned heights within each action group | Preview required |
| Border radii | 6px actions/fields, 999px chips/header pills | 6–8px standard; pills only for filters/status/compact navigation | Preview required |
| Colors | Deep navy family, ivory text, muted slate, antique gold; some bright gradients | Preserve navy/ivory/gold; remove bright yellow gradients and unrelated feature palettes | Preview required |
| Shadows | Mostly none; restrained field inset and primary-action shadow | Use shadows sparingly and consistently | Baseline recorded |
| Input heights | 52px minimum; 190px textarea | Reuse accessible field geometry and visible focus/invalid/read-only states | Baseline recorded |
| Modal widths | Not represented by Bar Easy/Doctrines default state | Derive from shared content width and task complexity; no one-off modal systems | Needs representative preview |
| Form spacing | 8px internal field gap; 20px field margin; 22px action separation | Reuse a small documented spacing scale | Baseline recorded |
| Card treatments | Minimal two-pane border and divider; no white card stack | Prefer editorial sections and dividers over repeated cards | Baseline recorded |
| Header implementations | Shared two-row desktop header; one mobile Menu control at ≤900px | One shared header across homepage/chambers; focused variant only during exams | Preview required |
| Footer implementations | Shared dark footer with legal notice and public links | One shared footer, matching page width and typography | Preview required |
| Loading indicators | Protected-content status copy; not visually captured in final state | Calm inline status with saved-work effect and next action | Needs representative preview |
| Error presentations | Not represented by default reference state | Plain-language title, short explanation, saved-work effect, action, safe retry | Needs representative preview |
| Empty states | Right pane explains what appears after submission | Reuse concise, contextual empty-state copy without dominant banners | Baseline recorded |
| Responsive behavior | 1360px shell; mobile 15–20px gutters; stacked panes; no 390px overflow | Verify at 1440/1024/768/390/375/320 and 200% zoom | Full test pending implementation |

## One-off style decision rule

Every style encountered during implementation must be classified as one of:

1. Required by a genuine feature constraint and documented here;
2. Mapped to an approved shared token or component state; or
3. Removed.

No global CSS replacement is authorized by this inventory. Changes must be scoped, previewed, and regression-tested surface by surface.

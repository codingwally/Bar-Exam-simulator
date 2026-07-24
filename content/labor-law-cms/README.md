# Due Diligence — Labor Law CMS

This folder is a Google Sheets-ready editorial workspace for the Phase 1 Labor Law corpus.

## What this is

- A **30-question draft template** for Labor Law and Social Legislation.
- A source-controlled representation of the columns that must exist in the Google Sheet.
- An import source for the validation command in `scripts/validate-labor-cms.mjs`.

It is **not** a published question bank. Every row is deliberately marked `DRAFT` or
`UNVERIFIED` until a qualified legal reviewer approves its source, authority, doctrine,
suggested answer, and rubric.

## Create the Google Sheet

1. Create a private Google Sheet named `Due Diligence — Labor Law Editorial CMS`.
2. Import each CSV in this folder as a separate tab, keeping the filename as the tab name.
3. Do not publish the sheet to the web and do not store student information in it.
4. Grant edit access only to the editorial team. The import process should use a dedicated
   service account or manual export—not a public CSV URL.
5. Keep the CSV exports in sync with the reviewed Sheet before releasing content.

## Editorial publication rule

A question is eligible for release only when all of the following are present:

- an official or otherwise documented source URL;
- an explicit source type (`OFFICIAL_BAR` or `ADAPTED`);
- a reviewer-approved suggested answer with a rights/source note;
- at least one verified authority and linked doctrine;
- all four ALAC rubric components totalling 100 points; and
- a reviewer, ISO date, and `APPROVED` status.

Run the release gate before importing content:

```text
node scripts/validate-labor-cms.mjs --mode=release
```

The current template passes only the structural check:

```text
node scripts/validate-labor-cms.mjs --mode=template
```

## Relationships

```text
Questions → Suggested_Answers
Questions → Question_Authorities → Authorities → Doctrine_Cards
Questions → Question_Rubrics → Authorities
Questions → Topics_Keywords
Questions → Review_Queue / Change_Log
```

Use `question_id` and `authority_id` exactly as written; they are stable identifiers used
by the import process and future grading audit trail.

# Examination Room 2.0 official source register

Accessed 2026-08-09 (Asia/Manila). These sources informed engineering controls and release gates. They are not a legal opinion or a claim that the beta is compliant, conformant, certified, or suitable for institutional use.

## Philippine privacy and data protection

| Authority | Official URL | Engineering use |
|---|---|---|
| Republic Act No. 10173, Data Privacy Act of 2012 | https://privacy.gov.ph/data-privacy-act/ | Data minimization, transparency, proportionality, security, data-subject rights, accountability. Lawful basis and controller/processor allocation remain DPO/counsel decisions. |
| Implementing Rules and Regulations of RA 10173 | https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/ | Organizational, physical, and technical measures; lifecycle and data-subject handling. |
| NPC circulars/advisories index | https://privacy.gov.ph/pips-and-pics/advisories-circulars/ | Current-issuance verification and amendment/repeal check. |
| NPC Circular No. 2022-04 | https://privacy.gov.ph/wp-content/uploads/2023/05/Circular-2022-04.pdf | Registration/notification assessment gate; the product owner/DPO must determine applicability. |
| NPC Circular No. 2023-04, Guidelines on Consent | https://privacy.gov.ph/wp-content/uploads/2023/11/NPC-Circular-No.-2023-04_Guidelines-on-Consent_07Nov2023.pdf | Do not treat consent as a generic fallback for required examination processing; where consent is used, keep it specific, informed and freely given. |
| NPC Circular No. 2023-06, Security of Personal Data in the Government and Private Sector | https://privacy.gov.ph/wp-content/uploads/2024/03/NPC-Circular-Repeal-16-01-Signed.pdf | Privacy-by-design/default, security governance, PIA, access, storage, business-continuity and incident controls; it replaces the narrower 2016 government-only circular. |
| NPC Circular No. 2023-07, Guidelines on Legitimate Interest | https://privacy.gov.ph/wp-content/uploads/2024/01/NPC-Circular-No.-2023-07_Guidelines-on-Legitimate-Interest_13-December-2023.pdf | Purpose, necessity and balancing analysis where a PIC proposes legitimate interest; lawful basis remains a DPO/counsel decision. |
| 2023 NPC issuance compendium | https://privacy.gov.ph/wp-content/uploads/2024/05/2023-compendium-2.pdf | Cross-check of the 2023 circular texts and issuance context. |
| NPC Advisory No. 2023-01, deceptive design patterns | https://privacy.gov.ph/wp-content/uploads/2023/11/NPC-Advisory-No.-2023-01-Guidelines-on-Deceptive-Design-Patterns_7Nov23.pdf | Separate optional marketing choice; plain, non-coercive exam notices and confirmation. |
| NPC Advisory No. 2024-04, AI processing | https://privacy.gov.ph/wp-content/uploads/2025/02/Advisory-2024.12.19-Guidelines-on-Artificial-Intelligence-w-SGD.pdf | AI grading is disabled pending necessity, provider, retention, transparency, evaluation, and human-review decisions. |
| NPC Circular No. 2024-02, CCTV systems | https://privacy.gov.ph/wp-content/uploads/2024/08/NPC-Circular-No.-2024-02-CCTV-Systems.pdf | Camera collection remains off; a new image pipeline needs a PIA, notice, scope, retention, access, deletion, and alternative design. |
| NPC Circular No. 2025-01, Body-Worn Cameras and alternative recording devices | https://privacy.gov.ph/wp-content/uploads/2025/05/SGD-NPC-Circular-No.-2025-01-Body-Worn-Cameras.pdf | Current proportionality, notice, security, access and retention reference for recording technologies; continuous webcam/audio is excluded from this beta. |
| NPC Advisory No. 2025-02, Privacy Engineering in Systems Life Cycle Processes | https://privacy.gov.ph/wp-content/uploads/2025/12/NPC_Advisory2025-02.pdf | Current privacy-engineering lifecycle guidance; supports the audit, minimization, fail-closed gates and pre-deployment PIA review. |

## Identity, authentication, and session security

| Authority | Official URL | Engineering use |
|---|---|---|
| NIST SP 800-63B-4, Authentication and Authenticator Management | https://pages.nist.gov/800-63-4/sp800-63b.html | Examiner/admin assurance, recovery, replay resistance, and authentication release gates. |
| NIST SP 800-63B-4, Session Management | https://pages.nist.gov/800-63-4/sp800-63b/session/ | Server session epoch, takeover invalidation, reauthentication, and timeout principles. |
| OWASP ASVS | https://owasp.org/www-project-application-security-verification-standard/ | Verification checklist for authentication, access control, input, files, logging, and data protection. Targeting the standard is not a certification claim. |
| OWASP Session Management Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html | Session identifiers, renewal/invalidation, fixation/replay, and sensitive transition controls. |
| OWASP File Upload Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html | Allowlisting, signature validation, generated storage names, private storage, resource ceilings, parser isolation, and scanning gaps. |

## Accessibility and browser behavior

| Authority | Official URL | Engineering use |
|---|---|---|
| W3C WCAG 2.2 | https://www.w3.org/TR/WCAG22/ | Target Level AA design/testing: keyboard, focus, status messages, reflow, target size, review/correction, timing and authentication. No conformance claim until audited. |
| W3C Indexed Database API 3.0 | https://www.w3.org/TR/IndexedDB/ | Transactional local answer journal and queue. Local storage is still best effort and is never described as permanent. |
| WHATWG Storage Standard | https://storage.spec.whatwg.org/ | Persistence/eviction behavior and storage-key constraints. |
| WHATWG Fullscreen API | https://fullscreen.spec.whatwg.org/ | Fullscreen is a user-agent feature, not operating-system lockdown; policy must allow accommodations. |
| W3C Page Visibility Level 2 | https://www.w3.org/TR/page-visibility-2/ | Visibility events are client-reported signals, not proof of misconduct. |

## Platform controls

| Authority | Official URL | Engineering use |
|---|---|---|
| Supabase Row Level Security guide | https://supabase.com/docs/guides/database/postgres/row-level-security | Forced RLS, browser grant revocation, and policy review. Because the Worker uses a server credential, every narrow RPC must independently authorize the actor and scope. |
| Supabase Auth MFA guide | https://supabase.com/docs/guides/auth/auth-mfa | Examiner/admin step-up design. Deployed AAL2 support remains an institutional release blocker until verified end to end. |
| Supabase Storage access control | https://supabase.com/docs/guides/storage/security/access-control | Private question-source bucket and server-mediated access. |
| Supabase Storage file limits | https://supabase.com/docs/guides/storage/uploads/file-limits | File-size/platform-limit alignment. Application/parser limits remain stricter where necessary. |
| Supabase changelog, breaking changes | https://supabase.com/changelog?types=breaking-change | Migration/deployment review: avoid extension version pinning, verify Data API exposure behavior, keep server secret keys out of browser builds. |

## Required owner/DPO/counsel decisions

Implementation alone cannot decide:

- the lawful basis for each required examination-processing purpose;
- the institution/Due Diligence PIC/PIP allocation and contractual instructions;
- registration and DPO/DPS obligations under current NPC rules;
- retention periods for rosters, answers, grades, incidents, source files, emails, Google backups, audit evidence, and disputes;
- legal holds, data-subject request handling, breach response and cross-border/subprocessor positions;
- whether any future camera or AI grading processing is necessary and proportionate;
- whether institutional records, accreditation, school policy, or professional rules impose additional duties.

Until those decisions and implementation evidence exist, the beta must not be described as “privacy compliant,” “secure,” “immutable,” “WCAG conformant,” “offline-proof,” or “lockdown capable.”

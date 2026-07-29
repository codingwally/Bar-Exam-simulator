-- Generated only from Google Sheet rows independently verified as Approved/Yes.
-- Source: 1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A / LEB Y1-Y2 Exam Bank
-- Ranges: A25:U34, A45:U54
-- This seed does not create a complete 20-question Midterm or Final.

begin;

insert into public.examination_questions (
  source_key, source_type, owner_user_id, subject, topic, bar_year,
  question_number, difficulty, prompt_text, model_answer, legal_basis,
  doctrine, application_text, conclusion_text,
  jurisprudence, citation, governing_provision, source_urls, source_metadata,
  review_status, publication_ready, content_hash, source_updated_at, approved_at
)
values
  (
    'LEB-Y1T1-JD401-20260729-Q01', 'google_sheet', null, 'Criminal Law I',
    'LEB Model Year 1 • Term 1 • JD401 • Mistake of fact', '2026'::integer, '1',
    'Foundational', 'At midnight, Tomas hears his locked bedroom door being forced open. He repeatedly asks who is there, receives no answer, and is struck when the door breaks inward. Believing a robber is attacking, he uses a knife and kills the intruder, who turns out to be his roommate playing a reckless prank. Tomas was not negligent. Is he criminally liable?', 'Answer: No. An honest and reasonable mistake of fact, without fault or negligence, negates the criminal intent that would otherwise make the act punishable.

Legal Basis: Revised Penal Code Articles 3 and 11 require the relevant voluntariness and recognize self-defense. United States v. Ah Chong acquitted an accused who acted on reasonable appearances of unlawful aggression without negligence.

Application: Had the circumstances been as Tomas reasonably believed, his defensive act would have been lawful. He demanded identification, faced a forcibly opened door and an apparent blow, and was not careless in forming the belief.

Conclusion: Tomas should be acquitted on mistake of fact in relation to self-defense.',
    'Revised Penal Code, Arts. 3 and 11. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri1910/mar1910/gr_l-5272_1910.html', 'Mistake of fact excuses when the mistake is honest and reasonable, concerns facts, negates criminal intent, and is not caused by the actor’s fault or negligence.', 'Had the circumstances been as Tomas reasonably believed, his defensive act would have been lawful. He demanded identification, faced a forcibly opened door and an apparent blow, and was not careless in forming the belief.', 'Tomas should be acquitted on mistake of fact in relation to self-defense.',
    '["The United States v. Ah Chong"]'::jsonb, 'G.R. No. L-5272, March 19, 1910',
    'Revised Penal Code, Arts. 3 and 11. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri1910/mar1910/gr_l-5272_1910.html', '[{"title":"Lawphil legacy decision fallback","url":"https://lawphil.net/judjuris/juri1910/mar1910/gr_l-5272_1910.html","type":"stored"},{"title":"Revised Penal Code (Act No. 3815)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 01/JD401/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, 'b78a41029306b70917b2b5e24f8499617996aeb35e0f99706e8f62fe61f3a570',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y1T1-JD401-20260729-Q02', 'google_sheet', null, 'Criminal Law I',
    'LEB Model Year 1 • Term 1 • JD401 • Mistake of fact caused by negligence', '2026'::integer, '2',
    'Intermediate', 'Police officers are ordered to arrest an armed fugitive. Without confirming identity or making any attempt to arrest, they shoot a sleeping man whom an informer merely points out; the victim is innocent. Can the officers invoke mistake of fact?', 'Answer: No. The officers cannot invoke mistake of fact to escape liability.

Legal Basis: Articles 3, 11(5), 14(16), 69, and 248 of the Revised Penal Code; People of the Philippines v. Antonio Z. Oanis and Alberto Galanta, G.R. No. 47722, July 27, 1943 (Moran, J.).

Application: Even if the sleeping man had been the fugitive, the arrest order did not authorize his summary killing. He was asleep, unresisting, and could have been identified and arrested without lethal force. The officers intentionally fired without verification, so their error resulted from their own precipitate conduct and does not negate criminal intent. The killing was treacherous and therefore murder. Because they were acting in the performance of a duty but used force that was not a necessary consequence of that duty, the incomplete justifying circumstance may reduce the penalty under Article 69.

Conclusion: The officers are liable for murder, subject to the incomplete fulfillment-of-duty circumstance if proved; mistake of fact does not acquit them.',
    'Revised Penal Code, Arts. 3, 11(5), 14(16), 69, 248: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | People v. Oanis official legacy text: https://lawphil.net/judjuris/juri1943/jul1943/gr_47722_1943.html', 'Mistake of fact excuses only an act that would be lawful if the facts were as believed and when the mistake is without fault or negligence. Police may not kill an unresisting sleeping suspect; an intentional treacherous killing is murder, although incomplete fulfillment of duty may mitigate under Article 69.', 'Even if the sleeping man had been the fugitive, the arrest order did not authorize his summary killing. He was asleep, unresisting, and could have been identified and arrested without lethal force. The officers intentionally fired without verification, so their error resulted from their own precipitate conduct and does not negate criminal intent. The killing was treacherous and therefore murder. Because they were acting in the performance of a duty but used force that was not a necessary consequence of that duty, the incomplete justifying circumstance may reduce the penalty under Article 69.', 'The officers are liable for murder, subject to the incomplete fulfillment-of-duty circumstance if proved; mistake of fact does not acquit them.',
    '["People of the Philippines v. Antonio Z. Oanis and Alberto Galanta"]'::jsonb, 'G.R. No. 47722, July 27, 1943',
    'Revised Penal Code, Arts. 3, 11(5), 14(16), 69, 248: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | People v. Oanis official legacy text: https://lawphil.net/judjuris/juri1943/jul1943/gr_47722_1943.html', '[{"title":"Lawphil legacy decision fallback","url":"https://lawphil.net/judjuris/juri1943/jul1943/gr_47722_1943.html","type":"stored"},{"title":"Revised Penal Code (Act No. 3815)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 02/JD401/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, 'f59ee38b0caec2c76a2b0898505ef54e819ee7e6fa65774872a2c4dac4ae0823',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y1T1-JD401-20260729-Q03', 'google_sheet', null, 'Criminal Law I',
    'LEB Model Year 1 • Term 1 • JD401 • Impossible crime by physical impossibility', '2026'::integer, '3',
    'Intermediate', 'Intent on killing Mina, Carlo fires several shots into the bed where he believes she is sleeping. Mina is abroad and no one is in the room. Carlo has performed every act he planned. Is the offense attempted murder or an impossible crime?', 'Answer: It is an impossible crime on the stated facts.

Legal Basis: Revised Penal Code Article 4(2), in relation to Article 59, covers acts that would be offenses against persons or property but cannot produce the intended crime because accomplishment is inherently impossible or the means are inadequate or ineffectual. Intod v. Court of Appeals applied this rule when the intended victim was absent from the place fired upon.

Application: Carlo acted with evil intent and completed his planned acts, but killing Mina there was physically impossible because she was absent. The facts do not show an intervening cause after a possible attempt against a present victim.

Conclusion: Carlo is liable for an impossible crime.',
    'Revised Penal Code, Arts. 4(2) and 59. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri1992/oct1992/gr_103119_1992.html', 'Where an intended offense against persons or property cannot be produced because of inherent physical or legal impossibility, liability may be for an impossible crime rather than an attempt.', 'Carlo acted with evil intent and completed his planned acts, but killing Mina there was physically impossible because she was absent. The facts do not show an intervening cause after a possible attempt against a present victim.', 'Carlo is liable for an impossible crime.',
    '["Sulpicio Intod v. Honorable Court of Appeals and People of the Philippines"]'::jsonb, 'G.R. No. 103119, October 21, 1992',
    'Revised Penal Code, Arts. 4(2) and 59. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri1992/oct1992/gr_103119_1992.html', '[{"title":"Lawphil legacy decision fallback","url":"https://lawphil.net/judjuris/juri1992/oct1992/gr_103119_1992.html","type":"stored"},{"title":"Revised Penal Code (Act No. 3815)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 03/JD401/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '3a047c9dc283e2f39cd6d06c94b814b34f6c17c16113f6277e15bb86050cd30f',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y1T1-JD401-20260729-Q04', 'google_sheet', null, 'Criminal Law I',
    'LEB Model Year 1 • Term 1 • JD401 • Attempted versus consummated rape', '2026'::integer, '4',
    'Intermediate', 'In 2024, an accused forces a 17-year-old victim to the floor, removes the victim’s clothing, and presses his flaccid penis against the skin above the labia. The victim’s mother intervenes. The evidence proves neither penetration of the vulval cleft nor penile contact with the labia. Is rape consummated?', 'Answer: No. On the stated facts, rape is not consummated; the offense is attempted rape.

Legal Basis: Articles 6, 266-A(1)(a), and 266-B of the Revised Penal Code, as amended; People of the Philippines v. Efren Agao y Añonuevo, G.R. No. 248049, October 4, 2022 (Caguioa, J., En Banc).

Application: Consummated rape requires the slightest penile penetration into the vulval cleft, understood as penetration of the cleft of the labia majora, by a penis capable of penetration. Mere grazing or surface contact above the labia is insufficient. The forcing, disrobing, and positioning are overt acts directly commencing rape, and the mother’s intervention is an external cause that prevented completion.

Conclusion: The accused is liable for attempted, not consummated, rape.',
    'Revised Penal Code, Arts. 6, 266-A, 266-B: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | R.A. No. 11648: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/94255 | People v. Agao: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68651', 'Under People v. Agao, consummation requires the slightest penetration into the vulval cleft or cleft of the labia majora by a penis capable of penetration; mere surface touching or grazing is not consummated rape. Overt acts stopped by an external cause constitute an attempt.', 'Consummated rape requires the slightest penile penetration into the vulval cleft, understood as penetration of the cleft of the labia majora, by a penis capable of penetration. Mere grazing or surface contact above the labia is insufficient. The forcing, disrobing, and positioning are overt acts directly commencing rape, and the mother’s intervention is an external cause that prevented completion.', 'The accused is liable for attempted, not consummated, rape.',
    '["People of the Philippines v. Efren Agao y Añonuevo"]'::jsonb, 'G.R. No. 248049, October 4, 2022',
    'Revised Penal Code, Arts. 6, 266-A, 266-B: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | R.A. No. 11648: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/94255 | People v. Agao: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68651', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68651","type":"stored"},{"title":"Revised Penal Code (Act No. 3815)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426","type":"stored"},{"title":"R.A. No. 11648","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/94255","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 04/JD401/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '276ca2e3a802e565f4719b992f11a13787ff9a44b79ed247364f0b865675a7a7',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y1T1-JD401-20260729-Q05', 'google_sheet', null, 'Criminal Law I',
    'LEB Model Year 1 • Term 1 • JD401 • No frustrated theft', '2026'::integer, '5',
    'Foundational', 'A shopper conceals a watch in a bag and passes the store’s checkout without paying. A guard stops him before he leaves the building and recovers the watch. Is he guilty only of frustrated theft because he never enjoyed free disposal?', 'Answer: No. Theft was consummated upon unlawful taking with intent to gain; free disposal is not an additional element.

Legal Basis: Revised Penal Code Articles 6 and 308 define the stages of felonies and theft. Valenzuela v. People held that theft has no frustrated stage because completion occurs when the offender takes personal property without consent and with intent to gain.

Application: The shopper acquired control of the watch and passed the payment point without consent and with intent to gain. Recovery moments later does not undo consummation.

Conclusion: He is liable for consummated theft.',
    'Revised Penal Code, Arts. 6 and 308. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri2007/jun2007/gr_160188_2007.html', 'Theft is consummated upon unlawful taking with intent to gain; the ability freely to dispose of the property is not an element.', 'The shopper acquired control of the watch and passed the payment point without consent and with intent to gain. Recovery moments later does not undo consummation.', 'He is liable for consummated theft.',
    '["Aristotel Valenzuela y Natividad v. People of the Philippines and Court of Appeals"]'::jsonb, 'G.R. No. 160188, June 21, 2007',
    'Revised Penal Code, Arts. 6 and 308. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri2007/jun2007/gr_160188_2007.html', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/41676","type":"stored"},{"title":"Revised Penal Code (Act No. 3815)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 05/JD401/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '0b634956e487d502935f4f97e527e7220f8bfb67964603d316b08e9509413f0a',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y1T1-JD401-20260729-Q06', 'google_sheet', null, 'Criminal Law I',
    'LEB Model Year 1 • Term 1 • JD401 • Unlawful aggression in self-defense', '2026'::integer, '6',
    'Advanced', 'After years of abuse, Bea kills her sleeping husband. At trial she proves battered-woman syndrome but shows no actual or imminent attack when she struck him. Before the statutory defense under R.A. No. 9262 is considered, can she claim complete self-defense under Article 11 of the Revised Penal Code?', 'Answer: No. Complete self-defense under Article 11 requires unlawful aggression at the time of the defensive act.

Legal Basis: Revised Penal Code Article 11(1) makes unlawful aggression indispensable. People v. Genosa held that battered-woman syndrome did not establish complete self-defense where the husband was not attacking when killed, although the evidence supported mitigating circumstances under the law then applied. R.A. No. 9262 now separately addresses battered-woman syndrome under its own terms.

Application: The long abuse is highly relevant, but the stated facts omit an actual or imminent attack at the decisive moment. Thus Article 11 complete self-defense is unavailable.

Conclusion: Bea cannot be fully justified under Article 11; any defense or mitigation under R.A. No. 9262 must be separately proved.',
    'Revised Penal Code, Arts. 11 and 13; R.A. No. 9262, Sec. 26. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri2004/jan2004/gr_135981_2004.html', 'Unlawful aggression is indispensable to ordinary self-defense; battered-woman syndrome has a separate statutory treatment under R.A. No. 9262.', 'The long abuse is highly relevant, but the stated facts omit an actual or imminent attack at the decisive moment. Thus Article 11 complete self-defense is unavailable.', 'Bea cannot be fully justified under Article 11; any defense or mitigation under R.A. No. 9262 must be separately proved.',
    '["People of the Philippines v. Marivic Genosa"]'::jsonb, 'G.R. No. 135981, January 15, 2004',
    'Revised Penal Code, Arts. 11 and 13; R.A. No. 9262, Sec. 26. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri2004/jan2004/gr_135981_2004.html', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/46828","type":"stored"},{"title":"Revised Penal Code (Act No. 3815)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 06/JD401/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, 'a4a8d64f64cdb7444583d091321a34e5026dd25f0914052fb290db5a3c686d93',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y1T1-JD401-20260729-Q07', 'google_sheet', null, 'Criminal Law I',
    'LEB Model Year 1 • Term 1 • JD401 • Proximate cause and efficient intervening cause', '2026'::integer, '7',
    'Advanced', 'During a quarrel, Nilo inflicts a small hand wound on Oscar. The wound is medically cleaned and nearly healed. Two weeks later Oscar works barefoot and barehanded in a heavily contaminated field, contracts tetanus from an uncertain source, and dies. Is Nilo automatically liable for homicide?', 'Answer: No. Liability depends on proof beyond reasonable doubt that Nilo’s wound was the proximate cause of death, without an efficient intervening cause.

Legal Basis: Revised Penal Code Article 4(1) makes a person liable for the natural and logical consequences of a felony. Urbano v. Intermediate Appellate Court reversed a homicide conviction where the evidence did not sufficiently connect the earlier wound to the later tetanus death and an intervening source was plausible.

Application: The wound had been treated and was healing; the later exposure creates a serious causal gap. If medical evidence cannot establish that the original injury caused the fatal infection, criminal causation is not proved.

Conclusion: Nilo cannot be convicted of homicide on causation alone under these facts.',
    'Revised Penal Code, Article 4(1): https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | Alexander D. Urbano v. Intermediate Appellate Court and People of the Philippines: https://lawphil.net/judjuris/juri1988/jan1988/gr_l-72964_1988.html', 'An offender answers for the natural and logical consequences of a felony, but the prosecution must prove proximate causation beyond reasonable doubt; an efficient intervening cause may break the chain.', 'The wound had been treated and was healing; the later exposure creates a serious causal gap. If medical evidence cannot establish that the original injury caused the fatal infection, criminal causation is not proved.', 'Nilo cannot be convicted of homicide on causation alone under these facts.',
    '["Alexander D. Urbano v. Intermediate Appellate Court and People of the Philippines"]'::jsonb, 'G.R. No. L-72964, January 7, 1988',
    'Revised Penal Code, Article 4(1): https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | Alexander D. Urbano v. Intermediate Appellate Court and People of the Philippines: https://lawphil.net/judjuris/juri1988/jan1988/gr_l-72964_1988.html', '[{"title":"Lawphil legacy decision fallback","url":"https://lawphil.net/judjuris/juri1988/jan1988/gr_l-72964_1988.html","type":"stored"},{"title":"Revised Penal Code (Act No. 3815)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 07/JD401/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '03542c334ce39270e837e861c6fc8f139886bfd4e0a4544cb3b46a88b75a4541',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y1T1-JD401-20260729-Q08', 'google_sheet', null, 'Criminal Law I',
    'LEB Model Year 1 • Term 1 • JD401 • Conspiracy proved by coordinated acts', '2026'::integer, '8',
    'Advanced', 'In 2024, ten fraternity officers secretly transport a neophyte to a resort for initiation. Two guard the entrance, several administer blows, and two later carry the unconscious neophyte to a hospital and give a false account. No written agreement is found. May coordinated criminal participation be established?', 'Answer: Yes, if the prosecution proves each accused’s statutory participation and common design beyond reasonable doubt.

Legal Basis: Section 14 of R.A. No. 11053; Article 8 of the Revised Penal Code; Devie Ann Isaga Fuertes v. Senate of the Philippines, et al., G.R. No. 208162, January 7, 2020 (Leonen, J., En Banc); Dandy L. Dungo and Gregorio A. Sibal, Jr. v. People of the Philippines, G.R. No. 209464, July 1, 2015 (Mendoza, J.).

Application: The blows, guarding, transport, concealment, and coordinated false account are affirmative acts from which a concerted design and individual participation may be inferred; liability is not being based on a written agreement or bare presence alone. Under the current R.A. No. 11053, Section 14 separately defines liability for actual planning or participation and creates a disputable presumption from presence unless the person prevented or promptly reported the hazing without peril. Fuertes upheld the statutory presumption. Dungo illustrates proof by an unbroken chain of coordinated acts, but it construed the former R.A. No. 8049 and is used only to that limited extent.

Conclusion: Criminal participation and conspiracy may be inferred from the coordinated acts, but guilt and the applicable Section 14 category must still be proved individually beyond reasonable doubt.',
    'R.A. No. 11053, Sec. 14: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/85055 | Revised Penal Code, Art. 8: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | Fuertes: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/66134 | Dungo: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/61091', 'Current R.A. No. 11053 governs post-2018 hazing. Section 14 defines liability by role and treats presence as prima facie evidence subject to statutory rebuttal; coordinated affirmative acts may independently establish common design and participation beyond reasonable doubt. Dungo is limited to its former-law and circumstantial-evidence context.', 'The blows, guarding, transport, concealment, and coordinated false account are affirmative acts from which a concerted design and individual participation may be inferred; liability is not being based on a written agreement or bare presence alone. Under the current R.A. No. 11053, Section 14 separately defines liability for actual planning or participation and creates a disputable presumption from presence unless the person prevented or promptly reported the hazing without peril. Fuertes upheld the statutory presumption. Dungo illustrates proof by an unbroken chain of coordinated acts, but it construed the former R.A. No. 8049 and is used only to that limited extent.', 'Criminal participation and conspiracy may be inferred from the coordinated acts, but guilt and the applicable Section 14 category must still be proved individually beyond reasonable doubt.',
    '["Devie Ann Isaga Fuertes v. Senate of the Philippines, House of Representatives, Department of Justice, Department of Interior and Local Government, Department of Budget and Management, Department of Finance, People of the Philippines through the Office of the Solicitor General, Office of the City Prosecutor of Tayabas City, the Presiding Judge of Branch 30, Regional Trial Court of Lucena City, and Heirs of Chester Paolo Abracia; Dandy L. Dungo and Gregorio A. Sibal, Jr. v. People of the Philippines"]'::jsonb, 'G.R. No. 208162, January 7, 2020; G.R. No. 209464, July 1, 2015',
    'R.A. No. 11053, Sec. 14: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/85055 | Revised Penal Code, Art. 8: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | Fuertes: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/66134 | Dungo: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/61091', '[{"title":"Supreme Court E-Library—Fuertes","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/66134","type":"stored"},{"title":"Supreme Court E-Library—Dungo","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/61091","type":"stored"},{"title":"R.A. No. 11053","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/85055","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 08/JD401/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '42b655a60fbf5fc360bf3129639a25f19579b5cf5915e0296bd70499efb61557',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y1T1-JD401-20260729-Q09', 'google_sheet', null, 'Criminal Law I',
    'LEB Model Year 1 • Term 1 • JD401 • Error in personae and transferred intent', '2026'::integer, '9',
    'Intermediate', 'Gardo throws a grenade at the President intending to kill him. The President is unhurt, but a bystander dies. Gardo argues that he never intended to kill the bystander. Is the unintended victim’s death attributable to him?', 'Answer: Yes. A felon is liable for the natural consequences of the intentional act even when the actual victim differs from the intended victim.

Legal Basis: Revised Penal Code Article 4(1) embodies the rule that criminal liability attaches although the wrongful act differs from that intended. People v. Guillen held the bomber liable for the death caused by the explosive thrown with homicidal intent despite failure to kill the intended target.

Application: Gardo deliberately used a lethal explosive in a crowd. The bystander’s death is a direct consequence of the same felonious act, and error in personae does not erase liability.

Conclusion: He is liable for the resulting death and the legally proper complex or additional offense, as charged and proved.',
    'Revised Penal Code, Arts. 4(1) and 48. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri1950/jan1950/gr_l-1477_1950.html', 'Intent follows the felonious act: error in the identity of the victim does not relieve the offender from liability for the death directly caused.', 'Gardo deliberately used a lethal explosive in a crowd. The bystander’s death is a direct consequence of the same felonious act, and error in personae does not erase liability.', 'He is liable for the resulting death and the legally proper complex or additional offense, as charged and proved.',
    '["People of the Philippines v. Julio Guillen"]'::jsonb, 'G.R. No. L-1477, January 18, 1950',
    'Revised Penal Code, Arts. 4(1) and 48. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri1950/jan1950/gr_l-1477_1950.html', '[{"title":"Lawphil legacy decision fallback","url":"https://lawphil.net/judjuris/juri1950/jan1950/gr_l-1477_1950.html","type":"stored"},{"title":"Revised Penal Code (Act No. 3815)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 09/JD401/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, 'b3d6f43aa2bc572aecf523598742c3571ee824f3ec9c81e43fe0ff2514e9b5d1',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y1T1-JD401-20260729-Q10', 'google_sheet', null, 'Criminal Law I',
    'LEB Model Year 1 • Term 1 • JD401 • Desistance after overt acts', '2026'::integer, '10',
    'Advanced', 'Milo points a loaded pistol at Ana from close range, cocks it, and begins to squeeze the trigger. He then freely changes his mind, lowers the gun, apologizes, and leaves; no person, weapon failure, or outside event prevented the shot. Is he liable for attempted homicide?', 'Answer: Ordinarily no, because the noncompletion resulted from his own spontaneous desistance, although he remains liable for any other offense already consummated.

Legal Basis: Revised Penal Code Article 6 excludes from an attempted felony a failure to complete the acts of execution caused by the offender’s own spontaneous desistance. Peñaranda v. People applied this rule and explained that voluntary abandonment removes liability for the intended attempted felony but not for physical injuries or another crime already produced.

Application: Milo stopped solely by his own free decision before firing. No external cause thwarted him. Thus an essential element of attempted homicide is absent. Any grave threat, alarm, or firearms offense must be assessed separately under its own elements.

Conclusion: Attempted homicide does not lie on the stated facts, without prejudice to an independently consummated offense.',
    'Revised Penal Code, Art. 6. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri2021/dec2021/gr_214426_2021.html', 'Spontaneous desistance before completion of the intended felony prevents liability for the attempted felony, but not for another offense already consummated.', 'Milo stopped solely by his own free decision before firing. No external cause thwarted him. Thus an essential element of attempted homicide is absent. Any grave threat, alarm, or firearms offense must be assessed separately under its own elements.', 'Attempted homicide does not lie on the stated facts, without prejudice to an independently consummated offense.',
    '["Rolen Peñaranda v. People of the Philippines"]'::jsonb, 'G.R. No. 214426, December 2, 2021',
    'Revised Penal Code, Art. 6. Revised Penal Code: https://lawphil.net/statutes/acts/act1930/act_3815_1930.html. Decision: https://lawphil.net/judjuris/juri2021/dec2021/gr_214426_2021.html', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/67958","type":"stored"},{"title":"Revised Penal Code (Act No. 3815)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 10/JD401/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '09bb136f4911498c91d333881eceedce10083b1db6fec066a52c644b740f40b7',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y2T1-JD501-20260729-Q01', 'google_sheet', null, 'Persons and Family Law',
    'LEB Model Year 2 • Term 1 • JD501 • Correction of sex entry for intersex person', '2026'::integer, '1',
    'Advanced', 'Alex was registered female at birth but was later medically diagnosed with congenital adrenal hyperplasia and naturally developed predominantly male characteristics. Alex, now an adult, has consistently identified and lived as male and seeks correction of the name and sex entries in the birth certificate. May the court grant the petition?', 'Answer: Yes, upon competent proof of the intersex condition and the person’s mature choice under the circumstances recognized by jurisprudence.

Legal Basis: Rules 103 and 108 govern changes of name and substantial civil-registry corrections through adversarial proceedings. Republic v. Cagandahan allowed correction for a person with congenital adrenal hyperplasia, recognizing the individual’s natural biological development and adult choice.

Application: Alex’s request is not based solely on preference or cosmetic alteration; it rests on an intersex condition and naturally developed male characteristics. Proper notice, parties, and medical evidence remain required.

Conclusion: The court may grant the requested corrections after a compliant adversarial proceeding.',
    'Rules of Court, Rules 103 and 108; Civil Code provisions on civil registry. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2008/sep2008/gr_166676_2008.html', 'A substantial correction of sex and name may be allowed for an intersex person whose natural biological development and mature choice are established in an adversarial proceeding.', 'Alex’s request is not based solely on preference or cosmetic alteration; it rests on an intersex condition and naturally developed male characteristics. Proper notice, parties, and medical evidence remain required.', 'The court may grant the requested corrections after a compliant adversarial proceeding.',
    '["Republic of the Philippines v. Jennifer B. Cagandahan"]'::jsonb, 'G.R. No. 166676, September 12, 2008',
    'Rules of Court, Rules 103 and 108; Civil Code provisions on civil registry. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2008/sep2008/gr_166676_2008.html', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/46790","type":"stored"},{"title":"Family Code (E.O. No. 209)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 01/JD501/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '80885f3613d1e0b79d083c2f43a254cc1f2730c166640c4fd72223deb99bc96f',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y2T1-JD501-20260729-Q02', 'google_sheet', null, 'Persons and Family Law',
    'LEB Model Year 2 • Term 1 • JD501 • Change of sex entry after sex reassignment', '2026'::integer, '2',
    'Advanced', 'Bianca was born biologically male, later underwent sex-reassignment surgery abroad, and petitions under Rule 108 to change the birth-certificate sex entry to female and the first name to a feminine name. No clerical error or intersex condition is alleged. Should the petition be granted under existing Philippine law?', 'Answer: No. Existing civil-registry statutes do not authorize a change of the recorded sex on that ground alone.

Legal Basis: Republic Act No. 9048, as amended, and Rule 108 govern corrections in the civil registry. Silverio v. Republic held that sex-reassignment surgery does not by itself authorize changing the sex entry fixed by the facts at birth, absent enabling legislation.

Application: Bianca alleges neither an erroneous original entry nor an intersex condition like that in Cagandahan. The requested substantive change cannot be supplied through judicial legislation.

Conclusion: The petition should be denied under current law, without passing on what legislation may later allow.',
    'R.A. No. 9048, as amended by R.A. No. 10172; Rules of Court, Rule 108. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2007/oct2007/gr_174689_2007.html', 'Absent an error at birth, an intersex condition, or statutory authority, sex-reassignment surgery alone does not authorize alteration of the sex entry in the birth certificate.', 'Bianca alleges neither an erroneous original entry nor an intersex condition like that in Cagandahan. The requested substantive change cannot be supplied through judicial legislation.', 'The petition should be denied under current law, without passing on what legislation may later allow.',
    '["Rommel Jacinto Dantes Silverio v. Republic of the Philippines"]'::jsonb, 'G.R. No. 174689, October 22, 2007',
    'R.A. No. 9048, as amended by R.A. No. 10172; Rules of Court, Rule 108. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2007/oct2007/gr_174689_2007.html', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/44532","type":"stored"},{"title":"Family Code (E.O. No. 209)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 02/JD501/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '0284262b726c8f6880fb5598686edbb09e8e1a84e215a93e9d4cd5ec1838691c',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y2T1-JD501-20260729-Q03', 'google_sheet', null, 'Persons and Family Law',
    'LEB Model Year 2 • Term 1 • JD501 • Article 26(2) divorce obtained by Filipino spouse', '2026'::integer, '3',
    'Advanced', 'Lara, a Filipino, marries Ken, a Japanese national. While still Filipino, Lara initiates and obtains a valid Japanese divorce that capacitated Ken to remarry. Lara asks a Philippine court to recognize the divorce and declare her capacitated to remarry. Must the foreign spouse have initiated the divorce?', 'Answer: No. What matters is that a valid foreign divorce was obtained and capacitated the foreign spouse to remarry, not which spouse initiated it.

Legal Basis: Family Code Article 26(2) addresses mixed marriages. Republic v. Manalo held that the provision may apply even when the Filipino spouse initiated the foreign divorce, to avoid the anomalous result of the foreign spouse being free while the Filipino remains bound.

Application: The divorce is valid under Japanese law and restored Ken’s capacity to remarry. Lara must still prove the foreign law and decree as facts in the Philippine proceeding.

Conclusion: Recognition is legally possible despite Lara’s having initiated the divorce.',
    'Family Code, Art. 26(2); Rules of Court on proof of foreign law and judgments. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2018/apr2018/gr_221029_2018.html', 'Article 26(2) may benefit the Filipino spouse regardless of who initiated the valid foreign divorce, if the foreign spouse is thereby capacitated to remarry.', 'The divorce is valid under Japanese law and restored Ken’s capacity to remarry. Lara must still prove the foreign law and decree as facts in the Philippine proceeding.', 'Recognition is legally possible despite Lara’s having initiated the divorce.',
    '["Republic of the Philippines v. Marelyn Tanedo Manalo"]'::jsonb, 'G.R. No. 221029, April 24, 2018',
    'Family Code, Art. 26(2); Rules of Court on proof of foreign law and judgments. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2018/apr2018/gr_221029_2018.html', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/64093","type":"stored"},{"title":"Family Code (E.O. No. 209)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 03/JD501/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '26f67d9be4efdbdf5750045094299cd93d3ccfef6e85a39fa347cd3b684881b5',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y2T1-JD501-20260729-Q04', 'google_sheet', null, 'Persons and Family Law',
    'LEB Model Year 2 • Term 1 • JD501 • Psychological incapacity after Tan-Andal', '2026'::integer, '4',
    'Advanced', 'Before marriage, Paolo repeatedly exploited family members, displayed enduring irresponsibility, and refused any reciprocal obligation. During marriage, the same durable pattern made him incapable—not merely unwilling—of supporting or respecting his spouse and child. Relatives who knew him before marriage testify consistently, but no psychiatrist examined him. Can psychological incapacity be proved?', 'Answer: Yes. Expert diagnosis or personal psychiatric examination is not indispensable if clear and convincing evidence proves a grave, enduring personality structure that existed at marriage and made compliance with essential marital obligations impossible.

Legal Basis: Family Code Article 36 governs psychological incapacity. Tan-Andal v. Andal clarified that it is a legal, not strictly medical, concept; ordinary witnesses may prove durable dysfunctionality, with gravity, juridical antecedence, and legal incurability understood under the refined standard.

Application: The pre-marriage pattern, continuing dysfunction, and inability to perform Articles 68–71 obligations may satisfy juridical antecedence and gravity. The court must distinguish incapacity from refusal, neglect, or ordinary incompatibility.

Conclusion: The petition may succeed if the total evidence is clear and convincing.',
    'Family Code, Arts. 36 and 68-71. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2021/may2021/gr_196359_2021.html', 'Psychological incapacity is a legal concept proved by clear and convincing evidence of durable, antecedent dysfunction that makes essential marital compliance impossible; expert testimony is not mandatory.', 'The pre-marriage pattern, continuing dysfunction, and inability to perform Articles 68–71 obligations may satisfy juridical antecedence and gravity. The court must distinguish incapacity from refusal, neglect, or ordinary incompatibility.', 'The petition may succeed if the total evidence is clear and convincing.',
    '["Rosanna L. Tan-Andal v. Mario Victor M. Andal"]'::jsonb, 'G.R. No. 196359, May 11, 2021',
    'Family Code, Arts. 36 and 68-71. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2021/may2021/gr_196359_2021.html', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68507","type":"stored"},{"title":"Family Code (E.O. No. 209)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 04/JD501/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, 'f257fab3d639ad71375100bb7267b31275989b491d7e668b6a11bc3de6d88f66',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y2T1-JD501-20260729-Q05', 'google_sheet', null, 'Persons and Family Law',
    'LEB Model Year 2 • Term 1 • JD501 • Article 26 divorce after change of citizenship', '2026'::integer, '5',
    'Intermediate', 'Both spouses are Filipino when they marry. Years later, Mira becomes a Canadian citizen and obtains a valid Canadian divorce that allows her to remarry. Her husband Noel remains Filipino. May Noel invoke Article 26(2) in the Philippines?', 'Answer: Yes. Article 26(2) can apply when one spouse later becomes a foreign citizen and thereafter obtains a valid divorce that capacitates that spouse to remarry.

Legal Basis: Family Code Article 26(2) prevents the absurdity of a Filipino remaining married to a former spouse who is free to remarry under national law. Republic v. Orbecido III identified the requisites for applying the provision to a marriage initially between Filipinos.

Application: Mira was already Canadian when the divorce was obtained, the divorce is valid under Canadian law, and it capacitated her to remarry. Noel must prove those foreign-law facts.

Conclusion: Noel may seek recognition and capacity to remarry under Article 26(2).',
    'Family Code, Art. 26(2). Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2005/oct2005/gr_154380_2005.html', 'Article 26(2) applies where one spouse becomes a foreign citizen and validly obtains a divorce abroad that capacitates the foreign spouse to remarry, upon proper proof of foreign law and decree.', 'Mira was already Canadian when the divorce was obtained, the divorce is valid under Canadian law, and it capacitated her to remarry. Noel must prove those foreign-law facts.', 'Noel may seek recognition and capacity to remarry under Article 26(2).',
    '["Republic of the Philippines v. Cipriano Orbecido III"]'::jsonb, 'G.R. No. 154380, October 5, 2005',
    'Family Code, Art. 26(2). Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2005/oct2005/gr_154380_2005.html', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/41840","type":"stored"},{"title":"Family Code (E.O. No. 209)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 05/JD501/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '9728c393b153b29dd40d22685bc6289ea809b8a0d8eff380c02132598afc4d3b',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y2T1-JD501-20260729-Q06', 'google_sheet', null, 'Persons and Family Law',
    'LEB Model Year 2 • Term 1 • JD501 • Effect of foreign divorce on alien spouse’s claims', '2026'::integer, '6',
    'Intermediate', 'A Filipino wife and her American husband validly divorce in the United States. The husband, capacitated to remarry under his national law, later sues in the Philippines to control the former wife’s business as her husband and to assert spousal management rights. May he do so?', 'Answer: No. Having obtained a valid divorce binding on him under his national law, the foreign spouse cannot continue asserting rights that depend on the subsistence of the marriage.

Legal Basis: Civil Code Article 15 applies nationality principles to status, while Article 26 of the Family Code addresses mixed marriages. Van Dorn v. Romillo, Jr. held that the alien former husband was estopped from claiming marital rights after a valid foreign divorce.

Application: The American husband is no longer married under the law governing his status and cannot selectively invoke a dissolved marital relationship to control the Filipino former wife’s property or business.

Conclusion: His claims based solely on continuing husband status should be dismissed.',
    'Civil Code, Art. 15; Family Code, Art. 26. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri1985/oct1985/gr_l-68470_1985.html', 'A foreign spouse bound by a valid foreign divorce cannot continue to assert Philippine marital rights against the Filipino former spouse.', 'The American husband is no longer married under the law governing his status and cannot selectively invoke a dissolved marital relationship to control the Filipino former wife’s property or business.', 'His claims based solely on continuing husband status should be dismissed.',
    '["Alice Reyes Van Dorn v. Hon. Manuel V. Romillo, Jr., as Presiding Judge of Branch CX, Regional Trial Court of the National Capital Judicial Region, Pasay City, and Richard Upton"]'::jsonb, 'G.R. No. L-68470, October 8, 1985',
    'Civil Code, Art. 15; Family Code, Art. 26. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri1985/oct1985/gr_l-68470_1985.html', '[{"title":"Lawphil legacy decision fallback","url":"https://lawphil.net/judjuris/juri1985/oct1985/gr_l-68470_1985.html","type":"stored"},{"title":"Family Code (E.O. No. 209)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 06/JD501/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '3e7815e1338735c1d5f69fd49a438165f63d44005823c7836f625826945ded4b',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y2T1-JD501-20260729-Q07', 'google_sheet', null, 'Persons and Family Law',
    'LEB Model Year 2 • Term 1 • JD501 • Proof of foreign divorce and foreign law', '2026'::integer, '7',
    'Foundational', 'Dina presents only an unauthenticated photocopy of a foreign divorce decree and asks a Philippine court to declare her marriage dissolved. She offers no competent proof of the foreign divorce law or its effect on her spouse’s capacity to remarry. Is the showing sufficient?', 'Answer: No. A foreign judgment and the foreign law under which it was rendered must be alleged and proved as facts in the manner required by the Rules.

Legal Basis: Family Code Article 26(2) is not self-proving as to foreign law. Garcia v. Recio requires competent proof of both the foreign divorce decree and the foreign spouse’s national law showing the decree’s validity and effect.

Application: An unauthenticated photocopy and silence about foreign law do not establish authenticity, validity, or capacity to remarry. Philippine courts do not take judicial notice of foreign law.

Conclusion: The petition must fail without proper proof, without prejudice to a properly supported action.',
    'Family Code, Art. 26(2); Rules of Court, Rules 39 and 132 on foreign judgments and official records. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2001/oct2001/gr_138322_2001.html', 'Foreign law and a foreign divorce decree are questions of fact that must be competently pleaded and proved; courts do not take judicial notice of them.', 'An unauthenticated photocopy and silence about foreign law do not establish authenticity, validity, or capacity to remarry. Philippine courts do not take judicial notice of foreign law.', 'The petition must fail without proper proof, without prejudice to a properly supported action.',
    '["Grace J. Garcia, a.k.a. Grace J. Garcia-Recio v. Rederick A. Recio"]'::jsonb, 'G.R. No. 138322, October 2, 2001',
    'Family Code, Art. 26(2); Rules of Court, Rules 39 and 132 on foreign judgments and official records. Family Code: https://lawphil.net/executive/execord/eo1987/eo_209_1987.html. Civil Code: https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html. Decision: https://lawphil.net/judjuris/juri2001/oct2001/gr_138322_2001.html', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/52783","type":"stored"},{"title":"Family Code (E.O. No. 209)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 07/JD501/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '84c5eb7a5ebdeccd1a16a6432faf2fa856c34116662aa81f06a13ef1ac0ed9f2',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y2T1-JD501-20260729-Q08', 'google_sheet', null, 'Persons and Family Law',
    'LEB Model Year 2 • Term 1 • JD501 • Absence of a marriage ceremony and bigamy', '2026'::integer, '8',
    'Advanced', 'Two Filipinos sign a marriage contract, but no solemnizing officer appears and no marriage ceremony is held. One later marries another person while the first document remains unchallenged. Is the later spouse guilty of bigamy solely because no prior judgment declared the first marriage void?', 'Answer: No, if the absence of any marriage ceremony is proved.

Legal Basis: Articles 3, 4, and 40 of the Family Code; Article 349 of the Revised Penal Code; Lucio Morigo y Cacho v. People of the Philippines, G.R. No. 145226, February 6, 2004 (Quisumbing, J.); Luisito G. Pulido v. People of the Philippines, G.R. No. 220149, July 27, 2021 (Hernando, J., En Banc).

Application: A signed marriage contract does not substitute for the parties’ appearance before a solemnizing officer and their personal declaration that they take each other as spouses. Without a ceremony, no first marriage came into existence. Morigo therefore found the first element of bigamy absent. Pulido independently confirms the current criminal-law rule that a marriage void ab initio may be raised as a defense to bigamy even without a judicial declaration obtained before the second marriage; Article 40 continues to govern civil capacity to remarry.

Conclusion: Bigamy is not established because the prosecution cannot prove a valid or subsisting first marriage.',
    'Family Code, Arts. 3, 4, 40: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173 | Revised Penal Code, Art. 349: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | Morigo: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/46464 | Pulido: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/67720', 'No marriage comes into existence without the required ceremony and personal declarations before a solemnizing officer. Under Pulido, a void-ab-initio marriage is a defense to bigamy regardless of when its nullity is judicially declared, while Article 40 remains relevant to civil capacity to remarry.', 'A signed marriage contract does not substitute for the parties’ appearance before a solemnizing officer and their personal declaration that they take each other as spouses. Without a ceremony, no first marriage came into existence. Morigo therefore found the first element of bigamy absent. Pulido independently confirms the current criminal-law rule that a marriage void ab initio may be raised as a defense to bigamy even without a judicial declaration obtained before the second marriage; Article 40 continues to govern civil capacity to remarry.', 'Bigamy is not established because the prosecution cannot prove a valid or subsisting first marriage.',
    '["Lucio Morigo y Cacho v. People of the Philippines; Luisito G. Pulido v. People of the Philippines"]'::jsonb, 'G.R. No. 145226, February 6, 2004; G.R. No. 220149, July 27, 2021',
    'Family Code, Arts. 3, 4, 40: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173 | Revised Penal Code, Art. 349: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | Morigo: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/46464 | Pulido: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/67720', '[{"title":"Supreme Court E-Library—Morigo","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/46464","type":"stored"},{"title":"Supreme Court E-Library—Pulido","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/67720","type":"stored"},{"title":"Family Code (E.O. No. 209)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 08/JD501/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, 'e9b89c55b1ecc1e89d799ed1e985fef4601bb2cd535fa5a33678ae59520f9598',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y2T1-JD501-20260729-Q09', 'google_sheet', null, 'Persons and Family Law',
    'LEB Model Year 2 • Term 1 • JD501 • Later declaration of nullity and bigamy', '2026'::integer, '9',
    'Advanced', 'A person contracts a second marriage while a first marriage, celebrated with all formal requisites, remains undissolved. During the ensuing bigamy case, a final judgment declares the first marriage void ab initio under Article 36 of the Family Code. May that judgment defeat criminal liability?', 'Answer: Yes, provided the accused proves that the first marriage was void ab initio; a bare allegation of nullity is not enough.

Legal Basis: Articles 36 and 40 of the Family Code; Article 349 of the Revised Penal Code; Luisito G. Pulido v. People of the Philippines, G.R. No. 220149, July 27, 2021 (Hernando, J., En Banc).

Application: Pulido abandoned the former rule that a judicial declaration of absolute nullity obtained only after the second marriage could not be used as a bigamy defense. A void-ab-initio first marriage is treated as nonexistent for the first element of bigamy, regardless of when the declaration is secured. Article 40 nevertheless remains controlling for civil purposes and requires a final judgment before a party may validly remarry.

Conclusion: The final judgment of nullity may defeat the bigamy charge if its effect and the first marriage’s void character are properly proved.',
    'Family Code, Arts. 36, 40: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173 | Revised Penal Code, Art. 349: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | Pulido: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/67720', 'Pulido holds that a void-ab-initio first or subsequent marriage is a defense to bigamy regardless of when the judicial declaration of nullity is obtained. Article 40 still requires a final judgment for civil capacity to remarry.', 'Pulido abandoned the former rule that a judicial declaration of absolute nullity obtained only after the second marriage could not be used as a bigamy defense. A void-ab-initio first marriage is treated as nonexistent for the first element of bigamy, regardless of when the declaration is secured. Article 40 nevertheless remains controlling for civil purposes and requires a final judgment before a party may validly remarry.', 'The final judgment of nullity may defeat the bigamy charge if its effect and the first marriage’s void character are properly proved.',
    '["Luisito G. Pulido v. People of the Philippines"]'::jsonb, 'G.R. No. 220149, July 27, 2021',
    'Family Code, Arts. 36, 40: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173 | Revised Penal Code, Art. 349: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426 | Pulido: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/67720', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/67720","type":"stored"},{"title":"Family Code (E.O. No. 209)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173","type":"stored"},{"title":"Revised Penal Code (Act No. 3815)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 09/JD501/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, 'f248ea55f57f865034e5418c6188ef65f8b77d410744e458e52b84ec8ffc71c9',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  ),
  (
    'LEB-Y2T1-JD501-20260729-Q10', 'google_sheet', null, 'Persons and Family Law',
    'LEB Model Year 2 • Term 1 • JD501 • Absence versus irregularity of marriage license', '2026'::integer, '10',
    'Intermediate', 'A marriage contract recites a marriage-license number, but the local civil registrar issues an authenticated certification after a records search that no license was issued to the spouses and that the cited number belonged to another couple. No suspicious circumstance undermines the certification, and a spouse also testifies that the parties never applied for a license. Is the proof sufficient to overcome the presumption of marriage validity?', 'Answer: Yes. Taken together, the certification and corroborating evidence are sufficient to prove absence of a valid marriage license.

Legal Basis: Articles 3(2), 4, and 35(3) of the Family Code; Section 28, Rule 132 of the Rules of Court; Lovelle S. Cariaga v. Republic of the Philippines and Henry G. Cariaga, G.R. No. 248643, December 7, 2021 (Caguioa, J.).

Application: A marriage license is a formal requisite, and its absence renders the marriage void unless a statutory exemption applies. Cariaga directs courts to assess a civil registrar’s certification holistically rather than demand talismanic wording. Here, the cited number belonged to another couple, the parties had no license application, the certification is authentic and untainted by suspicion, and the testimony corroborates non-issuance. The presumption of validity is therefore overcome.

Conclusion: The marriage is void ab initio for absence of a valid marriage license.',
    'Family Code, Arts. 3(2), 4, 35(3): https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173 | Rules of Court, Rule 132, Sec. 28 | Cariaga: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/67964', 'Proof of no marriage license is assessed holistically. An authentic civil-registrar certification, read with the attendant records and corroborating testimony and unaccompanied by suspicious circumstances, may overcome the presumption of marriage validity.', 'A marriage license is a formal requisite, and its absence renders the marriage void unless a statutory exemption applies. Cariaga directs courts to assess a civil registrar’s certification holistically rather than demand talismanic wording. Here, the cited number belonged to another couple, the parties had no license application, the certification is authentic and untainted by suspicion, and the testimony corroborates non-issuance. The presumption of validity is therefore overcome.', 'The marriage is void ab initio for absence of a valid marriage license.',
    '["Lovelle S. Cariaga v. Republic of the Philippines and Henry G. Cariaga"]'::jsonb, 'G.R. No. 248643, December 7, 2021',
    'Family Code, Arts. 3(2), 4, 35(3): https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173 | Rules of Court, Rule 132, Sec. 28 | Cariaga: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/67964', '[{"title":"Supreme Court E-Library decision","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/67964","type":"stored"},{"title":"Family Code (E.O. No. 209)","url":"https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173","type":"stored"}]'::jsonb, '{"editorialStatus":"Approved","publicationReady":"Yes","version":"1","author":"Wally Esteban","lastUpdated":"2026-07-29","notes":"Item 10/JD501/2026-07-29; original QuAMTO-style doctrine only, no copied wording; checks completed (current provision, complete caption, exact docket/date, ponente, holding/disposition, later treatment, primary URL, uniqueness, ALAC/schema); controlled system test; publisher retains final release responsibility.","reservedT":"0","reservedU":"0"}'::jsonb,
    'approved', true, '967192db9778b043389be3320f476af077d78d575a610614db73af9ff829bb36',
    '2026-07-29T00:00:00Z'::timestamptz,
    '2026-07-29T00:00:00Z'::timestamptz
  )
on conflict on constraint examination_questions_source_scope_unique
do update set
  subject = excluded.subject,
  topic = excluded.topic,
  bar_year = excluded.bar_year,
  question_number = excluded.question_number,
  difficulty = excluded.difficulty,
  prompt_text = excluded.prompt_text,
  model_answer = excluded.model_answer,
  legal_basis = excluded.legal_basis,
  doctrine = excluded.doctrine,
  application_text = excluded.application_text,
  conclusion_text = excluded.conclusion_text,
  jurisprudence = excluded.jurisprudence,
  citation = excluded.citation,
  governing_provision = excluded.governing_provision,
  source_urls = excluded.source_urls,
  source_metadata = excluded.source_metadata,
  review_status = excluded.review_status,
  publication_ready = excluded.publication_ready,
  content_hash = excluded.content_hash,
  source_updated_at = excluded.source_updated_at,
  approved_at = excluded.approved_at,
  updated_at = now()
where public.examination_questions.content_hash is distinct from excluded.content_hash
  or public.examination_questions.bar_year is distinct from excluded.bar_year
  or public.examination_questions.question_number is distinct from excluded.question_number
  or public.examination_questions.difficulty is distinct from excluded.difficulty
  or public.examination_questions.doctrine is distinct from excluded.doctrine
  or public.examination_questions.source_metadata is distinct from excluded.source_metadata;

commit;

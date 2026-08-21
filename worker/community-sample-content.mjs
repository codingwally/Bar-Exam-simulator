const SAMPLE_VERSION = 'home-community-taglish-2026-08-21';

const DISCUSSIONS = Object.freeze([
  ['Working student abroad, kaya ba talaga?', 'Nasa abroad ako ngayon and iniisip kong mag-law school habang may full-time work. Sa mga naka-try na, ano yung hindi obvious na dapat i-check—class hours, attendance, recit setup, or time-zone difference?', 'student_support', 'law_school_life', null, 'Applicant'],
  ['Case digests ko humahaba nang humahaba', 'Every time gumagawa ako ng digest, parang nire-rewrite ko na rin buong decision. Pag finals, wala na akong ma-review nang mabilis. Ano yung personal rule niyo for material facts?', 'request_study_help', 'philippine_legal_education', 'Remedial Law', '1L'],
  ['Paano kayo hindi nagba-blackout sa recit?', 'Gets ko yung case habang nagbabasa pero pag binago lang nang konti yung tanong, nawawala lahat sa utak ko. May routine ba kayong talagang nakatulong?', 'student_support', 'student_support', null, '1L'],
  ['Codal muna or commentary agad?', 'Limited lang study time ko. Mas okay ba na codal muna, or sabayan agad ng annotations at cases? Minsan kasi nalilimutan ko yung exact text ng law.', 'ask_community', 'philippine_legal_education', 'Civil Law', '2L'],
  ['ALAC pero parang robot basahin', 'Trying to follow ALAC, pero minsan ang sagot ko tunog template. Paano niyo napapanatiling obvious yung structure without sounding like four disconnected paragraphs?', 'request_study_help', 'bar_examination', null, 'Review'],
  ['Working students, anong schedule ang tumagal sa inyo?', 'Ang dami kong study plan na maganda lang for one week. Mas realistic ba fixed subject blocks, short daily sessions, or weekend-heavy?', 'student_support', 'law_school_life', null, '2L'],
  ['Separate opinions: paano hindi maghalo?', 'Pag may majority, concurrence, at dissent, minsan yung pinaka-memorable na line hindi pala controlling. Paano niyo inaayos notes?', 'discuss_legal_issue', 'philippine_jurisprudence', 'Political Law', '3L'],
  ['Alam ko ang elements pero sablay sa application', 'Kaya kong ilista yung elements, pero pag essay na parang checklist pa rin. Anong drill ang effective para ma-connect bawat element sa exact facts?', 'request_study_help', 'bar_examination', 'Criminal Law', '3L'],
  ['First timed mock ko, naubos oras sa Q1', 'Nag-outline ako nang sobrang tagal sa first question kaya minadali ko lahat ng kasunod. Mini-outline pa rin ba per item or direct answer agad?', 'ask_community', 'bar_examination', null, 'Review'],
  ['Bagsak sa midterm—paano kayo nag-reset?', 'Hindi lang mababa score ko; parang mali talaga yung study method ko. Ano uunahin niyo: content gaps, writing, or time management?', 'student_support', 'student_support', null, '2L'],
  ['May doctrine-first case index ba kayo?', 'Chronological yung case list ko pero ang hirap mag-retrieve during review. Iniisip kong ayusin by doctrine + trigger facts + result.', 'share_resource', 'philippine_jurisprudence', null, '3L'],
  ['Paano niyo vine-verify kung updated ang Rules?', 'May old reviewers akong useful pa rin, pero ayokong makabisado yung superseded rule. Ano yung mabilis pero reliable na verification habit?', 'ask_community', 'philippine_legal_education', 'Remedial Law', 'Review'],
  ['Handwritten notes na hindi puro kopya', 'Mas naaalala ko kapag sulat-kamay, pero sobrang bagal kung lahat isusulat. Ano lang yung nilalagay niyo sa notebook?', 'request_study_help', 'law_school_life', null, '1L'],
  ['Tax concepts na pare-pareho sa utak ko', 'Gets ko sila habang binabasa, pero pag hypo na nagkakapalit yung similar terms at consequences. May comparison format ba kayong gamit?', 'request_study_help', 'philippine_legal_education', 'Taxation Law', '3L'],
  ['Mahabang Bar problem: paano hanapin ang tunay na issue?', 'Kapag sobrang daming facts, lahat parang important. Ano yung mental filter niyo para makita yung trigger at yung background lang?', 'ask_community', 'bar_examination', null, 'Review'],
  ['Study group na hindi nauuwi sa chikahan', 'Gusto ko ng accountability at discussion, pero ayoko rin ng meeting na puro update kung gaano kami ka-behind. Anong ground rules gumana?', 'student_support', 'law_school_life', null, '2L'],
  ['Flashcards ko mini-digest na', 'Nilalagay ko rule, elements, exceptions, case, at facts sa isang card—ending, hindi na siya flashcard. Ano yung minimum info?', 'request_study_help', 'philippine_legal_education', null, '2L'],
  ['Nasasagot ko Part A, nakakalimutan ko Part B', 'Okay yung main issue ko pero may qualification pala sa second part na hindi ko nasagot. May quick checking habit ba kayo before submit?', 'request_study_help', 'bar_examination', null, 'Review'],
  ['Tambak na readings—ano inuuna niyo?', 'Halo-halo na backlog ko: assigned cases, unfinished digests, reviewer, at background readings. Paano kayo nagti-triage?', 'student_support', 'law_school_life', null, '1L'],
  ['Legal Ethics hypo: duty muna or facts muna?', 'Sa ethics questions, maliit na detail lang minsan ang nagbabago ng sagot. Inuuna niyo ba duty or minamap muna facts and parties?', 'ask_community', 'bar_examination', 'Legal Ethics', 'Review'],
  ['Commercial Law mas gets ko kapag transaction flow', 'Mas naaalala ko kapag sinusundan yung transaction from formation to enforcement kaysa hiwa-hiwalay na provisions. May gumagawa rin ba nito?', 'discuss_legal_issue', 'philippine_legal_education', 'Mercantile Law', '3L'],
  ['Exam month: paano matulog nang walang guilt?', 'Kapag maaga akong tumigil, feeling ko may dapat pa akong binasa. Pero kapag puyat, wala rin akong maalala kinabukasan. Anong routine gumana?', 'student_support', 'student_support', null, 'Review'],
  ['Last 60 seconds checklist bago mag-submit', 'Ano yung pinakamabilis na final check niyo sa Bar-style answer? Yung kasya sa last minute pero mahuhuli pa rin yung obvious gaps.', 'ask_community', 'bar_examination', null, 'Review'],
]);

const FIRST_COMMENTS = Object.freeze([
  'Same concern ko dati. Gumawa ako ng sample week kasama work hours, commute, at recit prep—not just class schedule. Doon ko nakita kung realistic talaga.',
  'Four lines lang sa quick digest ko: material facts, issue, ruling, doctrine. Kapag hindi needed para maintindihan yung result, nasa full notes lang.',
  'After every case, nagpapatanong ako ng one changed fact sa study buddy. Mas okay siya kaysa ulit-ulitin yung same canned answer.',
  'Codal first for me, kahit quick read. Commentary second, cases third, then balik sa codal para makita kung may qualification na na-miss.',
  'Labels sa outline lang, hindi sa final paragraphs. Direct answer agad, then natural sentences. Kita pa rin yung ALAC flow.',
  'Short daily blocks ang tumagal sa akin. May isang blank catch-up slot every week para hindi sira buong plan pag may overtime.',
  'Top box yung majority holding. Separate box talaga ang concurrence at dissent, marked persuasive, para hindi sila mag-blend.',
  'After every element, next sentence must start with a fact from the problem. Medyo awkward sa una pero natanggal yung checklist answers ko.',
  'Mini-outline lang—issue, rule, two decisive facts. May hard stop din per question bago ako magsulat.',
  'Pinaghihiwalay ko: wrong law, weak application, at time issue. Tapos one correction lang muna per next practice.',
  'Table ko: doctrine, trigger facts, result, official source. Yung trigger-facts column talaga ang useful.',
  'Official source muna before final notes, then nilalagyan ko ng date verified. Old reviewer stays useful pero hindi final authority.',
  'Issue, rule, one factual distinction, at one question na hindi ko pa gets. Yun lang sinusulat ko.',
  'Adjacent rows: definition, requisites, tax consequence, one example. Mas halata yung decisive distinction.',
  'Facts that change an element, exception, status, or deadline lang. Kapag same pa rin analysis pag tinanggal, background lang.',
  'One assigned question each before meeting. Lahat may sariling answer na ite-test, hindi chapter na sabay pa lang babasahin.',
  'One decision point per card. Front: trigger + rule. Back: exception + one short fact pattern.',
  'Minamatch ko bawat lettered sub-question sa isang sentence sa conclusion. Pag walang katapat, may naiwan.',
  'Next class or assessment muna. Background reading goes to a dated later list para hindi siya kunwaring urgent araw-araw.',
  'Duty first, then sino protected, possible ba consent, at anong fact ang gumagawa ng conflict or exception.',
  'Transaction flow works for me too. Hinihiwalay ko lang formal requisites, deadlines, at exceptions as checklists.',
  'Fixed stop time plus 20 minutes recall, no new reading. Mas honest yung next-morning recall kaysa feeling productive dahil puyat.',
  'Four checks: direct answer, accurate rule, decisive facts used, conclusion matches opening. Pag may time pa, grammar.',
]);

const REPLIES = Object.freeze([
  'Good point yung commute or connection buffer. On paper workable yung schedule until idagdag yung ordinary delays.',
  'Try ko yung four-line limit. Exact quotation siguro separate field lang kapag wording talaga ang issue.',
  'Ito yung kulang ko—same case lagi yung nire-recite ko. One changed fact sounds doable.',
  'Yung balik sa codal sa dulo makes sense. Madaling maging broader yung summary kaysa actual provision.',
  'Yes, visible structure without announcing every label. Ito yung balance na hinahanap ko.',
  'Gusto ko yung blank catch-up slot. Mas less guilty kaysa i-move buong calendar pag may urgent work.',
  'Separate persuasive box should help, lalo na kapag mas catchy yung dissent kaysa holding.',
  'Starting the next sentence with a fact is simple enough to use agad. It forces the analysis to earn the conclusion.',
  'Hard stop before writing might solve my Q1 problem. I usually decide the limit too late.',
]);

const PSEUDONYMS = Object.freeze([
  'Quiet Quill', 'Library Lantern', 'Measured Dictum', 'Codal Compass',
  'Patient Precedent', 'Margin Note', 'Casebook Comet', 'Calm Counterpoint',
  'Study Hall Echo', 'Diligent Digest', 'Paper Lantern', 'Careful Citation',
]);

function anonymousAuthor(index) {
  return {
    memberId: null,
    displayName: PSEUDONYMS[index % PSEUDONYMS.length],
    school: null,
    year: null,
    verified: false,
    anonymous: true,
    anonymousBadge: 'Anonymous',
    avatarPath: null,
  };
}

function sampleDate(now, hoursAgo) {
  return new Date(now - (hoursAgo * 60 * 60 * 1000)).toISOString();
}

export function buildCommunitySampleContent(now = Date.now()) {
  const posts = DISCUSSIONS.map((discussion, index) => {
    const [title, body, entryType, category, subject, lawSchoolYear] = discussion;
    const rootComment = {
      commentId: `sample_comment_${String(index + 1).padStart(3, '0')}`,
      parentCommentId: null,
      body: FIRST_COMMENTS[index],
      createdAt: sampleDate(now, (index * 3) + 1.5),
      updatedAt: sampleDate(now, (index * 3) + 1.5),
      edited: false,
      viewerOwns: false,
      anonymous: true,
      author: anonymousAuthor(index + 3),
      sample: true,
      readOnly: true,
    };
    const comments = [rootComment];
    if (index < REPLIES.length) {
      comments.push({
        commentId: `sample_reply_${String(index + 1).padStart(3, '0')}`,
        parentCommentId: rootComment.commentId,
        body: REPLIES[index],
        createdAt: sampleDate(now, (index * 3) + 1),
        updatedAt: sampleDate(now, (index * 3) + 1),
        edited: false,
        viewerOwns: false,
        anonymous: true,
        author: anonymousAuthor(index + 7),
        sample: true,
        readOnly: true,
      });
    }
    return {
      kind: 'entry',
      entryId: `sample_post_${String(index + 1).padStart(3, '0')}`,
      title,
      body,
      sourceUrl: null,
      caseTitle: null,
      entryType,
      subject,
      category,
      lawSchoolYear,
      createdAt: sampleDate(now, (index * 3) + 2),
      updatedAt: sampleDate(now, (index * 3) + 2),
      edited: false,
      commentsLocked: true,
      viewerOwns: false,
      anonymous: true,
      viewerHelpful: false,
      viewerSaved: false,
      author: anonymousAuthor(index),
      circle: null,
      counts: {
        helpful: 2 + ((index * 5) % 17),
        reactions: 2 + ((index * 5) % 17),
        comments: comments.length,
        citations: 0,
      },
      indicators: ['Community sample'],
      images: [],
      imagePath: null,
      practiceQuestionId: null,
      citation: null,
      comments,
      sample: true,
      readOnly: true,
    };
  });
  return {
    version: SAMPLE_VERSION,
    sample: true,
    readOnly: true,
    totals: { posts: posts.length, comments: posts.reduce((sum, post) => sum + post.comments.length, 0) },
    items: posts,
  };
}

export const COMMUNITY_SAMPLE_VERSION = SAMPLE_VERSION;

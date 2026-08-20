const SAMPLE_VERSION = 'home-community-2026-08-21';

const DISCUSSIONS = Object.freeze([
  ['Working abroad while considering law school', 'I work outside the Philippines and want to prepare for a JD without giving up my job. What practical factors helped you compare class schedules, residency requirements, and the reality of attending recitations from another time zone?', 'student_support', 'law_school_life', null, 'Applicant'],
  ['Building a case-digest system that survives finals week', 'My early digests are too long to review quickly. What structure helps you preserve the controlling facts, issue, ruling, and doctrine without rewriting the entire decision?', 'request_study_help', 'philippine_legal_education', 'Remedial Law', '1L'],
  ['Recitation anxiety before the first class', 'I understand the assigned cases while reading, but I freeze when the question changes slightly. What preparation routine helped you answer calmly without memorizing a script?', 'student_support', 'student_support', null, '1L'],
  ['Balancing codal reading and commentary', 'When time is limited, how do you divide study time between the exact statutory text, annotations, and cases? I want a routine that does not lose the wording of the law.', 'ask_community', 'philippine_legal_education', 'Civil Law', '2L'],
  ['Learning ALAC without sounding mechanical', 'How do you keep an essay visibly organized as Answer, Legal Basis, Application, and Conclusion while still writing naturally and addressing a difficult exception?', 'request_study_help', 'bar_examination', null, 'Review'],
  ['A workable schedule for students with full-time jobs', 'For working students, which weekly system has been sustainable: fixed subject blocks, rotating priorities, or shorter daily sessions? I am trying to avoid a plan that collapses after two weeks.', 'student_support', 'law_school_life', null, '2L'],
  ['When a case has several separate opinions', 'How do you study a decision with a majority, concurrence, and dissent without confusing the controlling rule with persuasive reasoning?', 'discuss_legal_issue', 'philippine_jurisprudence', 'Political Law', '3L'],
  ['Remembering elements without losing factual application', 'I can list the elements of an offense, but my essays still read like a checklist. What practice turns each element into a fact-specific application?', 'request_study_help', 'bar_examination', 'Criminal Law', '3L'],
  ['First mock exam under strict time pressure', 'My answer quality drops when I watch the clock. Should I outline every response first, or begin with the direct answer and build the application as I go?', 'ask_community', 'bar_examination', null, 'Review'],
  ['Recovering after a difficult midterm', 'A low score made me question whether my study method works. How do you review a marked exam objectively and turn the comments into a concrete plan for the next assessment?', 'student_support', 'student_support', null, '2L'],
  ['Organizing jurisprudence by doctrine instead of date', 'Has anyone built a doctrine-first index for cases? I want to retrieve authorities by issue while still remembering the factual distinction that made each ruling useful.', 'share_resource', 'philippine_jurisprudence', null, '3L'],
  ['Studying Rules of Court amendments accurately', 'What is your safest method for confirming that a reviewer reflects the current procedural rule before relying on it in an essay?', 'ask_community', 'philippine_legal_education', 'Remedial Law', 'Review'],
  ['Taking useful handwritten notes from digital readings', 'I retain more when I write, but copying too much is slow. What belongs in a handwritten review notebook when the full cases and commentaries stay digital?', 'request_study_help', 'law_school_life', null, '1L'],
  ['Separating tax concepts that use similar language', 'Several tax doctrines sound alike until a problem changes one fact. What comparison format helps you remember the legal consequence of each distinction?', 'request_study_help', 'philippine_legal_education', 'Taxation Law', '3L'],
  ['Finding the narrow issue in a long Bar problem', 'When a question contains many facts, how do you identify which details trigger the controlling doctrine and which are deliberate distractions?', 'ask_community', 'bar_examination', null, 'Review'],
  ['Joining a study group without losing solo study time', 'What expectations make a study group useful? I want discussion and accountability, but not another meeting where everyone only compares how far behind they are.', 'student_support', 'law_school_life', null, '2L'],
  ['Using flashcards for legal doctrines', 'Which information belongs on a doctrine flashcard: the rule alone, elements, exceptions, a case name, or one decisive fact? Mine are becoming miniature case digests.', 'request_study_help', 'philippine_legal_education', null, '2L'],
  ['Practicing conclusions that answer every sub-question', 'I sometimes resolve the main issue but miss a qualification hidden in part B. What review habit catches incomplete conclusions before submission?', 'request_study_help', 'bar_examination', null, 'Review'],
  ['Planning a clean reading backlog', 'My backlog mixes assigned cases, review materials, and unfinished digests. What triage rule helps you decide what must be read in full and what can be scheduled later?', 'student_support', 'law_school_life', null, '1L'],
  ['Preparing for Legal Ethics hypotheticals', 'Ethics questions often turn on small details about duty, consent, or disclosure. How do you map those facts without giving a purely moral answer?', 'ask_community', 'bar_examination', 'Legal Ethics', 'Review'],
  ['Studying commercial law through transactions', 'Has anyone found it easier to review commercial law by following a transaction from formation to enforcement rather than memorizing disconnected provisions?', 'discuss_legal_issue', 'philippine_legal_education', 'Mercantile Law', '3L'],
  ['Rest and retention during examination month', 'How do you protect sleep while still covering daily targets? I am interested in routines that improve recall rather than simply extending study hours.', 'student_support', 'student_support', null, 'Review'],
  ['A final checklist before submitting an essay', 'What is the shortest reliable last-pass checklist for a Bar-style answer? I want to catch a missing direct answer, unsupported rule, weak application, or inconsistent conclusion.', 'ask_community', 'bar_examination', null, 'Review'],
]);

const FIRST_COMMENTS = Object.freeze([
  'Start by comparing the actual class hours and attendance rules with your work schedule. Ask each school for the written policy, then build a sample week before deciding.',
  'I use four lines only: material facts, issue, ruling, and doctrine. Any detail that does not explain the result stays in the full case notes, not the exam digest.',
  'Practice answering one changed factual question aloud after every case. The goal is to explain the rule, not to reproduce the wording of your notes.',
  'Read the codal text first, then use commentary to identify disputes and cases to see how the rule operates. Return to the text before ending the session.',
  'Keep the labels in your outline, but write complete sentences in the final answer. The structure should guide the reader without becoming a template recital.',
  'Short daily blocks have been more durable for me than saving everything for weekends. I keep one catch-up block empty so a missed day does not break the plan.',
  'Write the majority rule at the top of your notes. Put concurring and dissenting points in a separate box labelled persuasive so they cannot merge during review.',
  'After listing an element, force yourself to begin the next sentence with a fact from the problem. That small rule stopped my answers from becoming abstract lists.',
  'A very short issue-and-rule outline helps. I budget the time first, then write the direct answer immediately so the conclusion cannot disappear at the end.',
  'Turn every comment into one observable correction, such as stating the rule more precisely or linking a named fact to each element. Retest that correction on a new problem.',
  'A simple table with doctrine, trigger facts, result, and official source works well. The trigger-fact column keeps similar rules from blending together.',
  'Check the current Supreme Court source or official publication before relying on a secondary reviewer. Mark the date you verified the rule in your notes.',
  'I handwrite only the issue, governing rule, one factual distinction, and a question I still cannot answer. Everything else remains searchable in the digital copy.',
  'Put the similar terms in adjacent rows and compare definition, requisites, taxpayer consequence, and one example. The differences become easier to retrieve.',
  'Underline facts that change a legal element, exception, status, or deadline. If deleting a fact would not affect the analysis, it is probably background.',
  'Agree on the assigned question and output before meeting. A group works better when everyone arrives with an answer to test, not a chapter to read together.',
  'One card per decision point works better than one card per case. I keep the exception on the reverse with one short factual example.',
  'Before submitting, match each numbered question to a numbered sentence in your conclusion. That makes an unanswered subpart visible immediately.',
  'Separate urgent assigned reading from valuable background reading. Finish the items tied to the next class or assessment, then schedule the rest deliberately.',
  'Identify the professional duty first, then ask who is protected, whether consent is possible, and which fact creates the conflict or exception.',
  'Following the transaction is useful because each provision has a role in the sequence. I still keep a separate list of formal requisites and exceptions.',
  'I set a fixed stopping time and use the last twenty minutes for recall instead of new reading. The next morning usually shows what actually remained.',
  'My final pass is four questions: Did I answer directly? Is the rule accurate? Did I use the decisive facts? Does the conclusion match the opening answer?',
]);

const REPLIES = Object.freeze([
  'That sample-week idea is useful. I would also include the commute or connection buffer, because the timetable can look workable until ordinary delays are added.',
  'The four-line limit is a good safeguard. I keep a separate quotation field only when the exact wording is likely to matter.',
  'Changing one fact is the part I was missing. It tests understanding without needing another full case.',
  'Returning to the codal text at the end also catches when commentary has summarized a qualification too broadly.',
  'This makes sense: visible structure for the examiner, natural prose for readability.',
  'An empty catch-up block also seems less discouraging than moving the entire week every time work becomes busy.',
  'Labelling persuasive material separately should help, especially when the dissent is easier to remember than the holding.',
  'Beginning with a fact is a practical rule I can apply immediately. It forces the analysis to earn the conclusion.',
  'A time budget before the outline may solve my tendency to over-answer the first question.',
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

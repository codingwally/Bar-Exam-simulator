-- Human-sounding Taglish starter discussions for the authenticated Home feed.
-- These are ordinary, commentable forum records. The stable seed keys make the
-- migration repeatable without exposing founder identities in client payloads.

begin;

alter table public.forum_posts
  add column if not exists starter_content_key text;

alter table public.forum_comments
  add column if not exists starter_content_key text;

create unique index if not exists forum_posts_starter_content_key_uidx
  on public.forum_posts (starter_content_key)
  where starter_content_key is not null;

create unique index if not exists forum_comments_starter_content_key_uidx
  on public.forum_comments (starter_content_key)
  where starter_content_key is not null;

comment on column public.forum_posts.starter_content_key is
  'Private idempotency key for approved first-party starter discussions.';
comment on column public.forum_comments.starter_content_key is
  'Private idempotency key for approved first-party starter comments.';

revoke all on public.forum_posts from public, anon, authenticated;
revoke all on public.forum_comments from public, anon, authenticated;

do $seed$
declare
  v_authors uuid[];
  v_author uuid;
  v_post_id uuid;
  v_comment_id uuid;
  v_parent_id uuid;
  v_post record;
  v_comment record;
begin
  select array_agg(user_id order by role desc, user_id)
    into v_authors
  from public.user_roles
  where role in ('admin', 'super_admin');

  if coalesce(array_length(v_authors, 1), 0) = 0 then
    raise exception 'HOME_STARTER_AUTHOR_REQUIRED';
  end if;

  for v_post in
    select *
    from jsonb_to_recordset($posts$[
      {"ordinal":1,"key":"home-20260821-post-001","title":"Working student abroad, kaya ba talaga?","body":"Nasa abroad ako ngayon and iniisip kong mag-law school habang may full-time work. Sa mga naka-try na, ano yung hindi obvious na dapat i-check—class hours, attendance, recit setup, or time-zone difference? Ayokong mag-enroll tapos saka ko malalaman na hindi pala sustainable.","entry_type":"student_support","category":"law_school_life","subject":null,"year":"Applicant","hours":2},
      {"ordinal":2,"key":"home-20260821-post-002","title":"Case digests ko humahaba nang humahaba","body":"Every time gumagawa ako ng digest, parang nire-rewrite ko na rin buong decision. Pag finals, wala na akong ma-review nang mabilis. Ano yung personal rule niyo para malaman kung material fact talaga or pwede nang iwan sa full notes?","entry_type":"request_study_help","category":"philippine_legal_education","subject":"Remedial Law","year":"1L","hours":5},
      {"ordinal":3,"key":"home-20260821-post-003","title":"Paano kayo hindi nagba-blackout sa recit?","body":"Gets ko yung case habang nagbabasa pero pag binago lang nang konti yung tanong, nawawala lahat sa utak ko. Hindi ko rin gustong mag-memorize ng script. May routine ba kayong ginagawa before class na talagang nakatulong?","entry_type":"student_support","category":"student_support","subject":null,"year":"1L","hours":8},
      {"ordinal":4,"key":"home-20260821-post-004","title":"Codal muna or commentary agad?","body":"Limited lang study time ko. Mas okay ba na codal muna hanggang kabisado ang wording, or sabayan agad ng annotations at cases? Napapansin ko kasi na kapag commentary agad, minsan nalilimutan ko yung exact text ng law.","entry_type":"ask_community","category":"philippine_legal_education","subject":"Civil Law","year":"2L","hours":11},
      {"ordinal":5,"key":"home-20260821-post-005","title":"ALAC pero parang robot basahin","body":"Trying to follow ALAC, pero minsan ang sagot ko tunog template at paulit-ulit. Paano niyo napapanatiling obvious yung structure without literally sounding like four disconnected paragraphs?","entry_type":"request_study_help","category":"bar_examination","subject":null,"year":"Review","hours":14},
      {"ordinal":6,"key":"home-20260821-post-006","title":"Working students, anong schedule ang tumagal sa inyo?","body":"Ang dami kong nagawang study plan na maganda lang for one week. Sa mga may full-time job, mas realistic ba fixed subject blocks, short daily sessions, or weekend-heavy? Looking for something na hindi agad guguho pag busy sa work.","entry_type":"student_support","category":"law_school_life","subject":null,"year":"2L","hours":17},
      {"ordinal":7,"key":"home-20260821-post-007","title":"Separate opinions: paano hindi maghalo?","body":"Pag may majority, concurrence, at dissent, minsan yung pinaka-memorable na line hindi pala controlling. Paano niyo inaayos notes para malinaw kung holding, separate reasoning, or persuasive point lang?","entry_type":"discuss_legal_issue","category":"philippine_jurisprudence","subject":"Political Law","year":"3L","hours":20},
      {"ordinal":8,"key":"home-20260821-post-008","title":"Alam ko ang elements pero sablay sa application","body":"Kaya kong ilista yung elements, pero pag essay na parang checklist pa rin at kulang sa analysis. Anong drill ang effective para mapilitang i-connect bawat element sa exact facts?","entry_type":"request_study_help","category":"bar_examination","subject":"Criminal Law","year":"3L","hours":23},
      {"ordinal":9,"key":"home-20260821-post-009","title":"First timed mock ko, naubos oras sa Q1","body":"Nag-outline ako nang sobrang tagal sa first question kaya minadali ko lahat ng kasunod. Sa timed exam ba, gumagawa pa kayo ng mini-outline per item or direct answer agad then saka binubuo application?","entry_type":"ask_community","category":"bar_examination","subject":null,"year":"Review","hours":26},
      {"ordinal":10,"key":"home-20260821-post-010","title":"Bagsak sa midterm—paano kayo nag-reset?","body":"Hindi lang mababa score ko; parang mali talaga yung study method ko. Gusto kong balikan yung exam nang objective, pero hindi ko alam alin ang uunahin: content gaps, writing, or time management. Paano niyo ginagawa yung post-exam review?","entry_type":"student_support","category":"student_support","subject":null,"year":"2L","hours":29},
      {"ordinal":11,"key":"home-20260821-post-011","title":"May doctrine-first case index ba kayo?","body":"Chronological yung case list ko pero ang hirap mag-retrieve during review. Iniisip kong ayusin by doctrine + trigger facts + result. May format ba kayong simple enough para ma-maintain hanggang finals?","entry_type":"share_resource","category":"philippine_jurisprudence","subject":null,"year":"3L","hours":32},
      {"ordinal":12,"key":"home-20260821-post-012","title":"Paano niyo vine-verify kung updated ang Rules?","body":"May old reviewers akong useful pa rin, pero ayokong makabisado yung superseded rule. Ano yung mabilis pero reliable na verification habit bago ko ilagay sa final notes?","entry_type":"ask_community","category":"philippine_legal_education","subject":"Remedial Law","year":"Review","hours":35},
      {"ordinal":13,"key":"home-20260821-post-013","title":"Handwritten notes na hindi puro kopya","body":"Mas naaalala ko kapag sulat-kamay, pero sobrang bagal kung lahat isusulat. Ano lang yung nilalagay niyo sa notebook habang searchable naman digitally yung full cases at commentaries?","entry_type":"request_study_help","category":"law_school_life","subject":null,"year":"1L","hours":38},
      {"ordinal":14,"key":"home-20260821-post-014","title":"Tax concepts na pare-pareho sa utak ko","body":"Gets ko sila habang binabasa, pero pag hypo na nagkakapalit yung similar terms at consequences. May comparison format ba kayong ginagamit para makita agad yung decisive distinction?","entry_type":"request_study_help","category":"philippine_legal_education","subject":"Taxation Law","year":"3L","hours":41},
      {"ordinal":15,"key":"home-20260821-post-015","title":"Mahabang Bar problem: paano hanapin ang tunay na issue?","body":"Kapag sobrang daming facts, lahat parang important. Ano yung mental filter niyo para makita kung alin ang nagti-trigger ng element, exception, status, or deadline at alin ang background lang?","entry_type":"ask_community","category":"bar_examination","subject":null,"year":"Review","hours":44},
      {"ordinal":16,"key":"home-20260821-post-016","title":"Study group na hindi nauuwi sa chikahan","body":"Gusto ko ng accountability at discussion, pero ayoko rin ng meeting na puro update kung gaano kami ka-behind. Anong ground rules yung gumana sa group niyo?","entry_type":"student_support","category":"law_school_life","subject":null,"year":"2L","hours":47},
      {"ordinal":17,"key":"home-20260821-post-017","title":"Flashcards ko mini-digest na","body":"Nilalagay ko rule, elements, exceptions, case, at facts sa isang card—ending, hindi na siya flashcard. Ano yung minimum info na worth keeping per card?","entry_type":"request_study_help","category":"philippine_legal_education","subject":null,"year":"2L","hours":50},
      {"ordinal":18,"key":"home-20260821-post-018","title":"Nasasagot ko Part A, nakakalimutan ko Part B","body":"Minsan okay yung main issue ko pero may qualification pala sa second part na hindi ko nasagot. May quick checking habit ba kayo before submit para mahuli yung incomplete conclusion?","entry_type":"request_study_help","category":"bar_examination","subject":null,"year":"Review","hours":53},
      {"ordinal":19,"key":"home-20260821-post-019","title":"Tambak na readings—ano inuuna niyo?","body":"Halo-halo na backlog ko: assigned cases, unfinished digests, reviewer, at background readings. Paano kayo nagti-triage nang hindi feeling na lahat urgent?","entry_type":"student_support","category":"law_school_life","subject":null,"year":"1L","hours":56},
      {"ordinal":20,"key":"home-20260821-post-020","title":"Legal Ethics hypo: duty muna or facts muna?","body":"Sa ethics questions, maliit na detail lang minsan ang nagbabago ng sagot. Inuuna niyo bang i-identify yung duty, or minamap muna lahat ng facts and parties bago mag-rule?","entry_type":"ask_community","category":"bar_examination","subject":"Legal Ethics","year":"Review","hours":59},
      {"ordinal":21,"key":"home-20260821-post-021","title":"Commercial Law mas gets ko kapag transaction flow","body":"Mas naaalala ko kapag sinusundan ko yung transaction from formation hanggang enforcement kaysa hiwa-hiwalay na provisions. May gumagawa rin ba nito? Ano yung dapat hiwalay pa ring checklist?","entry_type":"discuss_legal_issue","category":"philippine_legal_education","subject":"Mercantile Law","year":"3L","hours":62},
      {"ordinal":22,"key":"home-20260821-post-022","title":"Exam month: paano matulog nang walang guilt?","body":"Kapag maaga akong tumigil, feeling ko may dapat pa akong binasa. Pero kapag puyat, wala rin akong maalala kinabukasan. Anong routine yung nakatulong sa recall at hindi lang sa hours logged?","entry_type":"student_support","category":"student_support","subject":null,"year":"Review","hours":65},
      {"ordinal":23,"key":"home-20260821-post-023","title":"Last 60 seconds checklist bago mag-submit","body":"Ano yung pinakamabilis na final check niyo sa Bar-style answer? Yung kasya sa last minute pero mahuhuli pa rin kung walang direct answer, kulang rule, weak application, or salungat yung conclusion.","entry_type":"ask_community","category":"bar_examination","subject":null,"year":"Review","hours":68}
    ]$posts$::jsonb) as p(
      ordinal integer, key text, title text, body text, entry_type text,
      category text, subject text, year text, hours integer
    )
    order by ordinal
  loop
    v_author := v_authors[((v_post.ordinal - 1) % array_length(v_authors, 1)) + 1];

    insert into public.forum_posts (
      author_user_id, body, entry_type, subject, category, law_school_year,
      case_title, publication_status, is_anonymous, starter_content_key,
      created_at, updated_at
    ) values (
      v_author, v_post.body, v_post.entry_type, v_post.subject,
      v_post.category, v_post.year, v_post.title, 'published', true,
      v_post.key, now() - make_interval(hours => v_post.hours),
      now() - make_interval(hours => v_post.hours)
    )
    on conflict (starter_content_key) where starter_content_key is not null
    do nothing;

    select id into v_post_id
    from public.forum_posts
    where starter_content_key = v_post.key;

    perform public.forum_ensure_anonymous_alias(v_post_id, v_author);
  end loop;

  for v_comment in
    select *
    from jsonb_to_recordset($comments$[
      {"ordinal":1,"key":"home-20260821-comment-001","post":1,"parent":null,"body":"Same concern ko dati. Gumawa ako ng sample week kasama work hours, commute, at recit prep—not just class schedule. Doon ko nakita kung realistic talaga.","offset":1,"hours":1},
      {"ordinal":2,"key":"home-20260821-comment-002","post":2,"parent":null,"body":"Four lines lang sa quick digest ko: material facts, issue, ruling, doctrine. Kapag hindi kailangan para maintindihan bakit ganoon ang result, nasa full notes lang siya.","offset":2,"hours":4},
      {"ordinal":3,"key":"home-20260821-comment-003","post":3,"parent":null,"body":"After every case, nagpapatanong ako ng isang changed fact sa study buddy. Mas okay siya kaysa ulit-ulitin yung same canned answer.","offset":3,"hours":7},
      {"ordinal":4,"key":"home-20260821-comment-004","post":4,"parent":null,"body":"Codal first for me, kahit mabilis na read lang. Commentary second, cases third, then balik ulit sa codal para makita kung may qualification akong na-overlook.","offset":1,"hours":10},
      {"ordinal":5,"key":"home-20260821-comment-005","post":5,"parent":null,"body":"Labels sa outline lang, hindi sa bawat final paragraph. Direct answer agad, then natural sentences. Mas readable pero kita pa rin yung ALAC flow.","offset":2,"hours":13},
      {"ordinal":6,"key":"home-20260821-comment-006","post":6,"parent":null,"body":"Short daily blocks ang tumagal sa akin. May isang blank catch-up slot every week para hindi sira buong plan kapag may overtime.","offset":3,"hours":16},
      {"ordinal":7,"key":"home-20260821-comment-007","post":7,"parent":null,"body":"Nilalagay ko sa top box yung majority holding. Separate box talaga ang concurrence at dissent, marked persuasive, para hindi sila mag-blend sa recall.","offset":1,"hours":19},
      {"ordinal":8,"key":"home-20260821-comment-008","post":8,"parent":null,"body":"Rule ko: after every element, next sentence must start with a fact from the problem. Medyo awkward sa una pero natanggal yung abstract checklist answers ko.","offset":2,"hours":22},
      {"ordinal":9,"key":"home-20260821-comment-009","post":9,"parent":null,"body":"Mini-outline lang—issue, rule, two decisive facts. Nagse-set din ako ng hard stop per question bago magsulat para hindi ubos sa first item.","offset":3,"hours":25},
      {"ordinal":10,"key":"home-20260821-comment-010","post":10,"parent":null,"body":"Pinaghihiwalay ko: wrong law, weak application, at time issue. Tapos one correction lang muna per next practice. Mas manageable kaysa ayusin lahat sabay.","offset":1,"hours":28},
      {"ordinal":11,"key":"home-20260821-comment-011","post":11,"parent":null,"body":"Table ko: doctrine, trigger facts, result, official source. Yung trigger-facts column talaga ang useful kapag similar yung cases.","offset":2,"hours":31},
      {"ordinal":12,"key":"home-20260821-comment-012","post":12,"parent":null,"body":"Official source muna bago ko i-finalize notes, then nilalagyan ko ng date verified. Old reviewer stays useful pero hindi siya final authority.","offset":3,"hours":34},
      {"ordinal":13,"key":"home-20260821-comment-013","post":13,"parent":null,"body":"Issue, rule, one factual distinction, at one question na hindi ko pa gets. Yun lang sinusulat ko; the rest searchable na sa digital copy.","offset":1,"hours":37},
      {"ordinal":14,"key":"home-20260821-comment-014","post":14,"parent":null,"body":"Adjacent rows: definition, requisites, tax consequence, one example. Pag side-by-side, mas halata kung anong fact ang talagang nagbabago ng result.","offset":2,"hours":40},
      {"ordinal":15,"key":"home-20260821-comment-015","post":15,"parent":null,"body":"Hinahanap ko yung facts na nagbabago ng element, exception, status, or deadline. Kapag burahin mo yung fact at same pa rin analysis, likely background lang.","offset":3,"hours":43},
      {"ordinal":16,"key":"home-20260821-comment-016","post":16,"parent":null,"body":"One assigned question each before meeting. Lahat dapat may sariling answer na ite-test, hindi chapter na sabay-sabay pa lang babasahin.","offset":1,"hours":46},
      {"ordinal":17,"key":"home-20260821-comment-017","post":17,"parent":null,"body":"One decision point per card. Front: trigger + rule. Back: exception + one short fact pattern. Case name only if useful for recall.","offset":2,"hours":49},
      {"ordinal":18,"key":"home-20260821-comment-018","post":18,"parent":null,"body":"Minamatch ko bawat lettered sub-question sa isang sentence sa conclusion. Pag walang katapat, may naiwan akong issue.","offset":3,"hours":52},
      {"ordinal":19,"key":"home-20260821-comment-019","post":19,"parent":null,"body":"Next class or next assessment muna. Background reading goes to a dated later list para hindi siya kunwaring urgent araw-araw.","offset":1,"hours":55},
      {"ordinal":20,"key":"home-20260821-comment-020","post":20,"parent":null,"body":"Duty first, then sino protected, possible ba consent, at anong fact ang gumagawa ng conflict or exception. Doon nagiging legal analysis, hindi moral reaction.","offset":2,"hours":58},
      {"ordinal":21,"key":"home-20260821-comment-021","post":21,"parent":null,"body":"Transaction flow works for me too. Hinihiwalay ko lang yung formal requisites, deadlines, at exceptions as checklists para hindi mawala sa sequence.","offset":3,"hours":61},
      {"ordinal":22,"key":"home-20260821-comment-022","post":22,"parent":null,"body":"Fixed stop time plus 20 minutes recall, no new reading. Mas honest yung next-morning recall kaysa feeling productive dahil lang puyat.","offset":1,"hours":64},
      {"ordinal":23,"key":"home-20260821-comment-023","post":23,"parent":null,"body":"Mine is four checks: direct answer, accurate rule, decisive facts used, conclusion matches opening. Pag may time pa, saka grammar.","offset":2,"hours":67},
      {"ordinal":24,"key":"home-20260821-reply-001","post":1,"parent":"home-20260821-comment-001","body":"Good point yung commute or connection buffer. On paper workable yung schedule until idagdag yung ordinary delays.","offset":3,"hours":0},
      {"ordinal":25,"key":"home-20260821-reply-002","post":2,"parent":"home-20260821-comment-002","body":"Try ko yung four-line limit. Exact quotation siguro separate field lang kapag wording talaga ang issue.","offset":1,"hours":3},
      {"ordinal":26,"key":"home-20260821-reply-003","post":3,"parent":"home-20260821-comment-003","body":"Ito yung kulang ko—same case lagi yung nire-recite ko. One changed fact sounds doable after each reading.","offset":2,"hours":6},
      {"ordinal":27,"key":"home-20260821-reply-004","post":4,"parent":"home-20260821-comment-004","body":"Yung balik sa codal sa dulo makes sense. Madaling maging broader yung summary kaysa actual provision.","offset":3,"hours":9},
      {"ordinal":28,"key":"home-20260821-reply-005","post":5,"parent":"home-20260821-comment-005","body":"Yes, visible structure without announcing every label. Ito yung balance na hinahanap ko.","offset":1,"hours":12},
      {"ordinal":29,"key":"home-20260821-reply-006","post":6,"parent":"home-20260821-comment-006","body":"Gusto ko yung blank catch-up slot. Mas less guilty kaysa i-move buong calendar every time may urgent work.","offset":2,"hours":15},
      {"ordinal":30,"key":"home-20260821-reply-007","post":7,"parent":"home-20260821-comment-007","body":"Separate persuasive box should help, lalo na kapag mas catchy yung dissent kaysa holding.","offset":3,"hours":18},
      {"ordinal":31,"key":"home-20260821-reply-008","post":8,"parent":"home-20260821-comment-008","body":"Starting the next sentence with a fact is simple enough to use agad. It forces the analysis to earn the conclusion.","offset":1,"hours":21},
      {"ordinal":32,"key":"home-20260821-reply-009","post":9,"parent":"home-20260821-comment-009","body":"Hard stop before writing might solve my Q1 problem. I usually decide the time limit too late.","offset":2,"hours":24}
    ]$comments$::jsonb) as c(
      ordinal integer, key text, post integer, parent text, body text,
      "offset" integer, hours integer
    )
    order by ordinal
  loop
    select id into v_post_id
    from public.forum_posts
    where starter_content_key = format('home-20260821-post-%s', lpad(v_comment.post::text, 3, '0'));

    v_parent_id := null;
    if v_comment.parent is not null then
      select id into v_parent_id
      from public.forum_comments
      where starter_content_key = v_comment.parent;
    end if;

    v_author := v_authors[((v_comment.post + v_comment."offset" - 1) % array_length(v_authors, 1)) + 1];

    insert into public.forum_comments (
      post_id, author_user_id, body, parent_comment_id, is_anonymous,
      starter_content_key, created_at, updated_at
    ) values (
      v_post_id, v_author, v_comment.body, v_parent_id, true,
      v_comment.key, now() - make_interval(hours => v_comment.hours),
      now() - make_interval(hours => v_comment.hours)
    )
    on conflict (starter_content_key) where starter_content_key is not null
    do nothing;

    select id into v_comment_id
    from public.forum_comments
    where starter_content_key = v_comment.key;

    perform public.forum_ensure_anonymous_alias(v_post_id, v_author);
  end loop;
end
$seed$;

commit;

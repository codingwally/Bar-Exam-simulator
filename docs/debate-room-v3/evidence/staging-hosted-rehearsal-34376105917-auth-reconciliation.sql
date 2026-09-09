-- PREPARED FOR ROOT REVIEW; NOT EXECUTED BY THE AUTHOR.
-- Exact ten held fixtures from completed failed run34376105917, sourcec7b3149.
-- Fixture manifest SHA256: 8cba1cc2fb81a0966b24fb3ec10827ebfb39f8e402f7873d27b5e02f3fb03e22
-- Frozen readback checkedAt: 2026-09-09T16:45:50.103795+00:00.
-- Client MUST pin project_id=hlzqmreeoghbldnhlybr. No database GUC is target proof.
-- Root separately completed exact event cleanup via the existing staging helper.
-- All ten global signouts/Auth403/Worker401 fences were observed in the runner.
-- Auth/session/refresh absence is rechecked. No session or refresh DELETE here.
-- One exact-ten Auth DELETE may cascade only 40 frozen default rows and 10 email identities.
-- No Debate/Study/financial/Storage/audit DELETE or DDL. No credentials retrieved.
-- Storage metadata absence is required; physical Storage API bytes absence was NOT verified.
-- Auth/default/identity row locks only; no table-wide Auth/Study/financial locks.
-- Unknown response means read-only reconciliation, never automatic mutation retry.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path='';

do $reconcile$
declare
  v_frozen constant jsonb := $fixtures$[
  {
    "id": "052568a5-63e8-4d0a-bf1b-2aac4c561ec0",
    "runId": "dv3study-33e6b327",
    "createdAt": "2026-09-09T16:22:33.422291+00:00",
    "lastSignInAt": "2026-09-09T16:22:35.807146+00:00",
    "emailConfirmedAt": "2026-09-09T16:22:33.620205+00:00",
    "userMetadataSha256": "3fb681e8e37fefdb0df0a27f56b2cabbcca123191fff0d47b4ee414846910d74",
    "appMetadataSha256": "2073771bed7cfc5e4d75a988b8af0dc9ec5e493a99c3dd72a94843ca6856ae4e",
    "defaultRows": {
      "profiles": {
        "count": 1,
        "sha256": "5662b06307e9d4952746e16ed6047db03b49254c374daf9b657da59f1508efac"
      },
      "user_roles": {
        "count": 1,
        "sha256": "edd8fcbaca452320399adb7a2164c2d98c4c48056bbc09b8bd95427e94d12ee7"
      },
      "forum_profile_settings": {
        "count": 1,
        "sha256": "50f9adb52d514e31bd3dd798ca3f404cfcb80d789dca764cb328ec5d96f6057e"
      },
      "internal_test_accounts": {
        "count": 1,
        "sha256": "da6e0ae8a12539ee8f0d1b7fb11ef47071c722cc35fd87993f6147411df12878"
      }
    },
    "identity": {
      "id": "786b2c13-0878-454b-a601-4b11dec01790",
      "provider": "email",
      "createdAt": "2026-09-09T16:22:33.502878+00:00",
      "rowSha256": "67b8ce9106f2e8b1bab120ba0cea68ecbbe2da1ca6985b0dcf9bfb9d3c466789",
      "updatedAt": "2026-09-09T16:22:33.502878+00:00",
      "providerId": "052568a5-63e8-4d0a-bf1b-2aac4c561ec0",
      "subMatches": true,
      "emailMatches": true,
      "lastSignInAt": "2026-09-09T16:22:33.502807+00:00"
    }
  },
  {
    "id": "0a0f678d-2bc6-4a62-8ef9-752868c211b3",
    "runId": "dv3study-0bdc8d2f",
    "createdAt": "2026-09-09T16:22:43.246746+00:00",
    "lastSignInAt": "2026-09-09T16:22:44.341652+00:00",
    "emailConfirmedAt": "2026-09-09T16:22:43.290473+00:00",
    "userMetadataSha256": "3fb681e8e37fefdb0df0a27f56b2cabbcca123191fff0d47b4ee414846910d74",
    "appMetadataSha256": "3f8eb043a01a658de4d2bb57c764cf673e6a8cd1e18bc678de86922e80442e09",
    "defaultRows": {
      "profiles": {
        "count": 1,
        "sha256": "4357a059cd7759738598acb3ffbfd60f6cb69ed40cbaf20b32ffd956ba624b7e"
      },
      "user_roles": {
        "count": 1,
        "sha256": "5ee558fbff2806ef8221c66d44afb3df83c4260b4d0356f43134373ef1b18cc7"
      },
      "forum_profile_settings": {
        "count": 1,
        "sha256": "48ba0a4991779296fadbe20f01d4fa47dd6836950e135e3bdafffa4b9c6216d4"
      },
      "internal_test_accounts": {
        "count": 1,
        "sha256": "5a4719b0940ed9b00adc131c4190c6cd2ff1649ec6eea9b4106d9e761d4dda66"
      }
    },
    "identity": {
      "id": "9e3b2bb5-154b-49e1-852e-3dc71feae6b0",
      "provider": "email",
      "createdAt": "2026-09-09T16:22:43.279169+00:00",
      "rowSha256": "9d9a98cedb5a0fed7ebe2022f2c18ddcffecebcb2c5188512a5ef788af704ac0",
      "updatedAt": "2026-09-09T16:22:43.279169+00:00",
      "providerId": "0a0f678d-2bc6-4a62-8ef9-752868c211b3",
      "subMatches": true,
      "emailMatches": true,
      "lastSignInAt": "2026-09-09T16:22:43.278429+00:00"
    }
  },
  {
    "id": "2dd58d9e-8b72-4ac1-9725-6c43796f935e",
    "runId": "dv3study-8e1788b7",
    "createdAt": "2026-09-09T16:22:47.706554+00:00",
    "lastSignInAt": "2026-09-09T16:22:48.741739+00:00",
    "emailConfirmedAt": "2026-09-09T16:22:47.711664+00:00",
    "userMetadataSha256": "3fb681e8e37fefdb0df0a27f56b2cabbcca123191fff0d47b4ee414846910d74",
    "appMetadataSha256": "3a5de9c03f1b17a354d558c584f9293e684641739dc2dee7b9ad6e3f6cb0040a",
    "defaultRows": {
      "profiles": {
        "count": 1,
        "sha256": "cd78cb0aa69a951db99f36003b2d20594758de49bf898d15c0ff230643becb4a"
      },
      "user_roles": {
        "count": 1,
        "sha256": "48dd87e6e794102bd7e0ae9bd4e2119cc3c35e6388e69acd7b78203f60a1ffd2"
      },
      "forum_profile_settings": {
        "count": 1,
        "sha256": "3bcb265f6c50e5edc3773609b4cf6587c47a4135cd5b935444b95c19427c4ea9"
      },
      "internal_test_accounts": {
        "count": 1,
        "sha256": "0ced6e1ca68eb500cabf7dd053ebfc606724be013de3db68c17cf122815646fa"
      }
    },
    "identity": {
      "id": "a3d4688b-d5a3-4a67-900f-6b67556e26f7",
      "provider": "email",
      "createdAt": "2026-09-09T16:22:47.708925+00:00",
      "rowSha256": "1af1d89b52fd6f943022e0074b5a323c8056442d1a891c412f593c5f05d741d5",
      "updatedAt": "2026-09-09T16:22:47.708925+00:00",
      "providerId": "2dd58d9e-8b72-4ac1-9725-6c43796f935e",
      "subMatches": true,
      "emailMatches": true,
      "lastSignInAt": "2026-09-09T16:22:47.708864+00:00"
    }
  },
  {
    "id": "48201e93-dcbd-4f91-8924-c834bbe4a74a",
    "runId": "dv3study-3afc064e",
    "createdAt": "2026-09-09T16:23:00.010658+00:00",
    "lastSignInAt": "2026-09-09T16:23:01.00341+00:00",
    "emailConfirmedAt": "2026-09-09T16:23:00.014531+00:00",
    "userMetadataSha256": "3fb681e8e37fefdb0df0a27f56b2cabbcca123191fff0d47b4ee414846910d74",
    "appMetadataSha256": "8d700a5827ff56d6e70fa7fa14d6aba2bca48975a95b57f4ef7170a1bfdfa276",
    "defaultRows": {
      "profiles": {
        "count": 1,
        "sha256": "477260da735fc9b33ffe3ebb3817279d250d906e4af3d394e5f84d3715ba8f36"
      },
      "user_roles": {
        "count": 1,
        "sha256": "3dd43d55e0cb915421874a292139f02ea62f58feb22cf127eb4b4bfde95d748d"
      },
      "forum_profile_settings": {
        "count": 1,
        "sha256": "10c4c96f59dffda49a06bce4f385210d2e3b7372ad5c9d0a02832996c1012234"
      },
      "internal_test_accounts": {
        "count": 1,
        "sha256": "92055bf224b2a591fda87bf3d0ac1f4b020e73157f5ce254d2e952003dc84461"
      }
    },
    "identity": {
      "id": "ee2c07fb-7684-465b-8b9b-2bb042312be1",
      "provider": "email",
      "createdAt": "2026-09-09T16:23:00.012454+00:00",
      "rowSha256": "4d6f285f35ae86c5bf515f0c2aa3f2f5bcca93fb642c3278300a9ca318e9fb90",
      "updatedAt": "2026-09-09T16:23:00.012454+00:00",
      "providerId": "48201e93-dcbd-4f91-8924-c834bbe4a74a",
      "subMatches": true,
      "emailMatches": true,
      "lastSignInAt": "2026-09-09T16:23:00.0124+00:00"
    }
  },
  {
    "id": "4aa1ca52-6929-47e5-b95e-943353602d94",
    "runId": "dv3study-d4359ed6",
    "createdAt": "2026-09-09T16:22:51.594295+00:00",
    "lastSignInAt": "2026-09-09T16:22:52.617513+00:00",
    "emailConfirmedAt": "2026-09-09T16:22:51.599873+00:00",
    "userMetadataSha256": "3fb681e8e37fefdb0df0a27f56b2cabbcca123191fff0d47b4ee414846910d74",
    "appMetadataSha256": "d97522a0880a70475e190a005aebfff517cb5a2a1f754a9f20c98f99ffebefa4",
    "defaultRows": {
      "profiles": {
        "count": 1,
        "sha256": "15d0eea89eacaa3bf7c7b23a5e0cc90e53ed8899b004c1466b5b4330281f7747"
      },
      "user_roles": {
        "count": 1,
        "sha256": "fead38d021e092635604cb74b1ca0b1deea19d92b0a7fcc5011730149abcf4af"
      },
      "forum_profile_settings": {
        "count": 1,
        "sha256": "f7831e448c51507eda315d2baa03d4522116f3b45b080dbb99090d72b5101957"
      },
      "internal_test_accounts": {
        "count": 1,
        "sha256": "8039e3d7bd97425781f1be983e81bb4fd55cec1923e729360258470c1fb64e5b"
      }
    },
    "identity": {
      "id": "6341f982-34db-482e-a4f5-b8222bcd5a88",
      "provider": "email",
      "createdAt": "2026-09-09T16:22:51.596535+00:00",
      "rowSha256": "0a3d4509ff6bfeb62fdf239df77ce7510b8c65acbb080872d371a59375e91e26",
      "updatedAt": "2026-09-09T16:22:51.596535+00:00",
      "providerId": "4aa1ca52-6929-47e5-b95e-943353602d94",
      "subMatches": true,
      "emailMatches": true,
      "lastSignInAt": "2026-09-09T16:22:51.596479+00:00"
    }
  },
  {
    "id": "5336877d-75eb-4e13-b04d-d3d15dac4b4a",
    "runId": "dv3study-3e27e4b4",
    "createdAt": "2026-09-09T16:23:06.172573+00:00",
    "lastSignInAt": "2026-09-09T16:23:07.161953+00:00",
    "emailConfirmedAt": "2026-09-09T16:23:06.17696+00:00",
    "userMetadataSha256": "3fb681e8e37fefdb0df0a27f56b2cabbcca123191fff0d47b4ee414846910d74",
    "appMetadataSha256": "f3b6f8834738bf059b5966cfeb46c3b1ae0e0210f06cee8e0fde5e00a849ec3b",
    "defaultRows": {
      "profiles": {
        "count": 1,
        "sha256": "08437ce97c113fabbe395ff048058af91e2221939e72fcf047bffb3de90edfea"
      },
      "user_roles": {
        "count": 1,
        "sha256": "f4d76ad16e2a2f43b4b8e18c49e9a3a447427309b8d3c16d2e463887d050968c"
      },
      "forum_profile_settings": {
        "count": 1,
        "sha256": "a7eec75d61e4299d822e7210dc159e734f839c102c2db75dd9cc72880ac36a58"
      },
      "internal_test_accounts": {
        "count": 1,
        "sha256": "0dbae72fa162b8289553c120f6a44dead45a870ddf3455e85338e391cfcede9a"
      }
    },
    "identity": {
      "id": "bcdad900-d923-4c34-ad9d-2ad9cee83290",
      "provider": "email",
      "createdAt": "2026-09-09T16:23:06.174432+00:00",
      "rowSha256": "05a9b95c6e1bf9f618b8d44ee1d5107548e8239681ac2232aff85085ece385c7",
      "updatedAt": "2026-09-09T16:23:06.174432+00:00",
      "providerId": "5336877d-75eb-4e13-b04d-d3d15dac4b4a",
      "subMatches": true,
      "emailMatches": true,
      "lastSignInAt": "2026-09-09T16:23:06.17437+00:00"
    }
  },
  {
    "id": "6f7991dc-0d48-4dab-9f5a-5a32c75025b0",
    "runId": "dv3study-db757506",
    "createdAt": "2026-09-09T16:22:39.168391+00:00",
    "lastSignInAt": "2026-09-09T16:22:40.729017+00:00",
    "emailConfirmedAt": "2026-09-09T16:22:39.173421+00:00",
    "userMetadataSha256": "3fb681e8e37fefdb0df0a27f56b2cabbcca123191fff0d47b4ee414846910d74",
    "appMetadataSha256": "dc47c163476f4eff519ee17ee2c1e876d50d084c81721a05698a9b9a10c350e0",
    "defaultRows": {
      "profiles": {
        "count": 1,
        "sha256": "958b1756cc573ed9f936cbd29503c9bb66f7874e935b404f7831674cdd24d92c"
      },
      "user_roles": {
        "count": 1,
        "sha256": "6760b1e039a29a96b8c5b1e1e307d70c422d18d16840432d59518d53ca2ac23f"
      },
      "forum_profile_settings": {
        "count": 1,
        "sha256": "29a474a8e855f14c3c8074f9faad0b6ace6302a34dcbd887dcdf7b02513d198d"
      },
      "internal_test_accounts": {
        "count": 1,
        "sha256": "16cab82a63fb2a9a984bf557da533c7266f8569ceb3a108dc0ca0981f8abddea"
      }
    },
    "identity": {
      "id": "8a60438a-d5bf-4807-9cde-a1a6fab4f853",
      "provider": "email",
      "createdAt": "2026-09-09T16:22:39.170912+00:00",
      "rowSha256": "ee6600d7ff61ef20feb91601c0c369c4cacd2851b7986d73afe644247e3a67e6",
      "updatedAt": "2026-09-09T16:22:39.170912+00:00",
      "providerId": "6f7991dc-0d48-4dab-9f5a-5a32c75025b0",
      "subMatches": true,
      "emailMatches": true,
      "lastSignInAt": "2026-09-09T16:22:39.170803+00:00"
    }
  },
  {
    "id": "7988bcd4-44ec-4243-bd77-c826cc54e8bf",
    "runId": "dv3study-d665116f",
    "createdAt": "2026-09-09T16:22:57.444294+00:00",
    "lastSignInAt": "2026-09-09T16:22:58.479851+00:00",
    "emailConfirmedAt": "2026-09-09T16:22:57.449218+00:00",
    "userMetadataSha256": "3fb681e8e37fefdb0df0a27f56b2cabbcca123191fff0d47b4ee414846910d74",
    "appMetadataSha256": "d7c7a1209f9185ca4c98b73557620df1844aaa29dd924cd58d7bef4c96887df2",
    "defaultRows": {
      "profiles": {
        "count": 1,
        "sha256": "5d6c644d33f6c4e86cb63d86a53446337a0b516a7d23c92256287e393be5c130"
      },
      "user_roles": {
        "count": 1,
        "sha256": "3eca8248b381d98c7071621f9537051cdd7e5a810d5d03dad95965258ffc12db"
      },
      "forum_profile_settings": {
        "count": 1,
        "sha256": "f775e2d2cedb0f6df0e4a99298c7542acd8fae2b0b2e236ac09f6445ffffeb69"
      },
      "internal_test_accounts": {
        "count": 1,
        "sha256": "bcd4152b309fb7ffcc308e05d22e4c7cd78bd290fbaf006873002b0619ca8f19"
      }
    },
    "identity": {
      "id": "d6dea789-c8fa-490d-a88b-eaaa5df533e0",
      "provider": "email",
      "createdAt": "2026-09-09T16:22:57.447028+00:00",
      "rowSha256": "d5ff38779769fa8de92d682b91b4fece931a9d200eab132c79b138153f95daf2",
      "updatedAt": "2026-09-09T16:22:57.447028+00:00",
      "providerId": "7988bcd4-44ec-4243-bd77-c826cc54e8bf",
      "subMatches": true,
      "emailMatches": true,
      "lastSignInAt": "2026-09-09T16:22:57.446959+00:00"
    }
  },
  {
    "id": "d69d69a0-5ac6-451e-8e2f-8ae12ff77b50",
    "runId": "dv3study-b3cbf24e",
    "createdAt": "2026-09-09T16:22:54.148581+00:00",
    "lastSignInAt": "2026-09-09T16:22:55.169936+00:00",
    "emailConfirmedAt": "2026-09-09T16:22:54.15323+00:00",
    "userMetadataSha256": "3fb681e8e37fefdb0df0a27f56b2cabbcca123191fff0d47b4ee414846910d74",
    "appMetadataSha256": "9d0c7851307e1f3df2eae059deba9a76786ffda576184b4da57a78dcf44ae828",
    "defaultRows": {
      "profiles": {
        "count": 1,
        "sha256": "adba480efa3407ef3408acf091cbc2ae08ffe8a857cc1022e3c9b2d52becd450"
      },
      "user_roles": {
        "count": 1,
        "sha256": "612a9667db66192ef73c4ca7aa03576d569e16b90c0407a504229507adb36d2d"
      },
      "forum_profile_settings": {
        "count": 1,
        "sha256": "ecfc38339b5ed10d215c3258c3f20f54b4d7a64d2ef6c6db9e681db9b10566f8"
      },
      "internal_test_accounts": {
        "count": 1,
        "sha256": "cf10953f2c69e9204c3a730773c1da6e62816794f011be5043b12c8acaea9405"
      }
    },
    "identity": {
      "id": "0c4b7208-480c-46ea-a206-9e63913d3cec",
      "provider": "email",
      "createdAt": "2026-09-09T16:22:54.150852+00:00",
      "rowSha256": "717960d225a5218272250b854d8d67e63b760db7ed787564e9d0fa8b7ae8a144",
      "updatedAt": "2026-09-09T16:22:54.150852+00:00",
      "providerId": "d69d69a0-5ac6-451e-8e2f-8ae12ff77b50",
      "subMatches": true,
      "emailMatches": true,
      "lastSignInAt": "2026-09-09T16:22:54.150794+00:00"
    }
  },
  {
    "id": "f4dd58af-e436-4511-8347-7762ebf6af1f",
    "runId": "dv3study-4c503cb5",
    "createdAt": "2026-09-09T16:23:03.211501+00:00",
    "lastSignInAt": "2026-09-09T16:23:04.222956+00:00",
    "emailConfirmedAt": "2026-09-09T16:23:03.216089+00:00",
    "userMetadataSha256": "3fb681e8e37fefdb0df0a27f56b2cabbcca123191fff0d47b4ee414846910d74",
    "appMetadataSha256": "5af282b6c0e4dd9e281da77e23893b4e44b69ad66ea490eea2bbe349a1f92c19",
    "defaultRows": {
      "profiles": {
        "count": 1,
        "sha256": "0ae58828bb48278c449d166ba9438b1328d436f59469c7aafaf3f0183ce4f867"
      },
      "user_roles": {
        "count": 1,
        "sha256": "1363fb5dd0e8ebd1dfeaf4ee24da4bd81217538e13c852e5303b1844b76a5eb1"
      },
      "forum_profile_settings": {
        "count": 1,
        "sha256": "a7cfddcef02b6707765193b77f88c62e2e209c1dc0d47a08d961e610de2b90fc"
      },
      "internal_test_accounts": {
        "count": 1,
        "sha256": "6c0366af6054b3d00b06d4539dbcc5b1922632f4c883db22decb55a7a63508ed"
      }
    },
    "identity": {
      "id": "fe29368b-e7e9-4abf-8b8b-43458f02d65c",
      "provider": "email",
      "createdAt": "2026-09-09T16:23:03.213507+00:00",
      "rowSha256": "1eb887aad9b5e7c0fa7b5c5be68c513f76153b4513a11725bfca077a74963226",
      "updatedAt": "2026-09-09T16:23:03.213507+00:00",
      "providerId": "f4dd58af-e436-4511-8347-7762ebf6af1f",
      "subMatches": true,
      "emailMatches": true,
      "lastSignInAt": "2026-09-09T16:23:03.213442+00:00"
    }
  }
]$fixtures$::jsonb;
  v_event constant text := 'de-5af7a09268b36d28911ac2beb236aeec';
  v_ids uuid[]; v_text_ids text[]; v_run_ids text[];
  v_fixture jsonb; v_identity jsonb; v_id uuid; v_run text; v_user record;
  v_scope record; v_count bigint; v_scopes integer := 0; v_expected integer;
  v_removed integer; v_hash text; v_audit_before bigint;
  v_affected constant regclass[] := array[
    'auth.users'::regclass,'auth.identities'::regclass,'public.profiles'::regclass,
    'public.forum_profile_settings'::regclass,'public.user_roles'::regclass,
    'private.internal_test_accounts'::regclass];
begin
  if current_user<>'postgres' then raise exception 'RECONCILE_OPERATOR_MISMATCH'; end if;
  select array_agg((value->>'id')::uuid order by value->>'id'),
    array_agg(value->>'id' order by value->>'id'),array_agg(value->>'runId' order by value->>'id')
    into v_ids,v_text_ids,v_run_ids from jsonb_array_elements(v_frozen);
  if cardinality(v_ids)<>10 or (select count(distinct x) from unnest(v_ids) x)<>10 then
    raise exception 'RECONCILE_MANIFEST_SHAPE'; end if;

  -- Lock exact Auth rows in UUID order, then all expected cascaded rows.
  for v_fixture in select value from jsonb_array_elements(v_frozen) order by value->>'id' loop
    v_id := (v_fixture->>'id')::uuid; v_run := v_fixture->>'runId';
    select id,email,created_at,last_sign_in_at,aud,role,is_super_admin,is_anonymous,
      is_sso_user,deleted_at,email_confirmed_at,raw_user_meta_data,raw_app_meta_data
      into v_user from auth.users where id=v_id for update;
    if not found or v_user.email is distinct from 'dd-study-room-student-'||v_run||'@example.com'
      or v_user.created_at is distinct from (v_fixture->>'createdAt')::timestamptz
      or v_user.last_sign_in_at is distinct from (v_fixture->>'lastSignInAt')::timestamptz
      or v_user.email_confirmed_at is distinct from (v_fixture->>'emailConfirmedAt')::timestamptz
      or v_user.aud is distinct from 'authenticated' or v_user.role is distinct from 'authenticated'
      or coalesce(v_user.is_super_admin,false) or coalesce(v_user.is_anonymous,false) or coalesce(v_user.is_sso_user,false)
      or v_user.deleted_at is not null or v_user.email_confirmed_at is null
      or v_user.raw_user_meta_data->>'full_name' is distinct from 'Synthetic Study Room student'
      or encode(sha256(convert_to(v_user.raw_user_meta_data::text,'UTF8')),'hex') is distinct from v_fixture->>'userMetadataSha256'
      or encode(sha256(convert_to(v_user.raw_app_meta_data::text,'UTF8')),'hex') is distinct from v_fixture->>'appMetadataSha256'
      or v_user.raw_app_meta_data is distinct from jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
        'astra_staging_study_room_fixture',jsonb_build_object('version',1,'runId',v_run,'label','student')) then
      raise exception 'RECONCILE_AUTH_OWNERSHIP_DRIFT';
    end if;

    for v_scope in select * from (values
      ('public','profiles','id'),('public','forum_profile_settings','user_id'),
      ('public','user_roles','user_id'),('private','internal_test_accounts','user_id')
    ) expected(schema_name,table_name,column_name) loop
      execute format('select count(*) from %I.%I where %I=$1',
        v_scope.schema_name,v_scope.table_name,v_scope.column_name) into v_count using v_id;
      if v_count<>1 then raise exception 'RECONCILE_DEFAULT_ROW_COUNT_DRIFT'; end if;
      execute format('select encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'') from %I.%I t where %I=$1 for update',
        v_scope.schema_name,v_scope.table_name,v_scope.column_name) into v_hash using v_id;
      if v_hash is distinct from v_fixture->'defaultRows'->v_scope.table_name->>'sha256' then
        raise exception 'RECONCILE_DEFAULT_ROW_DRIFT';
      end if;
    end loop;

    v_identity := v_fixture->'identity';
    if (select count(*) from auth.identities where user_id=v_id)<>1 then raise exception 'RECONCILE_IDENTITY_COUNT_DRIFT'; end if;
    select encode(sha256(convert_to(to_jsonb(i)::text,'UTF8')),'hex') into v_hash
      from auth.identities i where user_id=v_id and id=(v_identity->>'id')::uuid
        and provider='email' and provider_id=v_id::text and identity_data->>'sub'=v_id::text
        and identity_data->>'email'=v_user.email
        and created_at=(v_identity->>'createdAt')::timestamptz
        and updated_at=(v_identity->>'updatedAt')::timestamptz
        and last_sign_in_at=(v_identity->>'lastSignInAt')::timestamptz for update;
    if not found or v_hash is distinct from v_identity->>'rowSha256' then raise exception 'RECONCILE_IDENTITY_DRIFT'; end if;
    perform 1 from private.internal_test_accounts where user_id=v_id and email_at_classification=v_user.email
      and classification_source='astra_study_room_staging_v1:'||v_run||':student' for update;
    if not found then raise exception 'RECONCILE_CLASSIFICATION_DRIFT'; end if;
    perform 1 from public.user_roles where user_id=v_id and role::text='student' and assigned_by is null for update;
    if not found then raise exception 'RECONCILE_ROLE_DRIFT'; end if;
  end loop;

  if exists(select 1 from auth.sessions where user_id=any(v_ids))
    or exists(select 1 from auth.refresh_tokens where user_id=any(v_text_ids)) then
    raise exception 'RECONCILE_SESSION_OR_REFRESH_REAPPEARED'; end if;
  if exists(select 1 from public.user_roles where assigned_by=any(v_ids)) then raise exception 'RECONCILE_ROLE_DRIFT'; end if;

  -- Exact event and all actor scopes must remain absent after the separate cleanup.
  if exists(select 1 from public.debate_v3_events where id=v_event or owner_id=any(v_text_ids))
    or exists(select 1 from public.debate_v3_receipts where event_id=v_event or actor_id=any(v_text_ids))
    or exists(select 1 from public.debate_v3_audit where event_id=v_event or actor_id=any(v_text_ids))
    or exists(select 1 from public.debate_v3_match_versions where event_id=v_event)
    or exists(select 1 from public.debate_v3_ballots where event_id=v_event or judge_id=any(v_text_ids))
    or exists(select 1 from public.debate_v3_votes where event_id=v_event or actor_id=any(v_text_ids))
    or exists(select 1 from public.debate_v3_outbox where event_id=v_event or actor_id=any(v_text_ids))
    or exists(select 1 from public.debate_v3_uploads where event_id=v_event or actor_id=any(v_text_ids))
    or exists(select 1 from public.debate_v3_rate_limits where actor_id=any(v_text_ids)) then
    raise exception 'RECONCILE_COMPETITION_CLEANUP_REQUIRED'; end if;

  -- All 257 direct Auth FK scopes must contain exactly the 50 frozen cascade rows.
  for v_scope in
    select n.nspname schema_name,c.relname table_name,a.attname column_name,fk.confdeltype,
      cardinality(fk.conkey) source_columns,cardinality(fk.confkey) target_columns
    from pg_constraint fk join pg_class c on c.oid=fk.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum=fk.conkey[1]
    where fk.contype='f' and fk.confrelid='auth.users'::regclass order by n.nspname,c.relname,a.attname
  loop
    v_scopes := v_scopes+1;
    if v_scope.source_columns<>1 or v_scope.target_columns<>1 then raise exception 'RECONCILE_FK_SHAPE_DRIFT'; end if;
    v_expected := case when (v_scope.schema_name,v_scope.table_name,v_scope.column_name) in
      (('auth','identities','user_id'),('public','profiles','id'),('public','forum_profile_settings','user_id'),
       ('public','user_roles','user_id'),('private','internal_test_accounts','user_id')) then 10 else 0 end;
    execute format('select count(*) from %I.%I where %I=any($1)',v_scope.schema_name,v_scope.table_name,v_scope.column_name)
      into v_count using v_ids;
    if v_count<>v_expected or (v_expected>0 and v_scope.confdeltype<>'c') then
      raise exception 'RECONCILE_UNEXPECTED_AUTH_REFERENCE'; end if;
  end loop;
  if v_scopes<>257 then raise exception 'RECONCILE_AUTH_FK_CATALOG_DRIFT'; end if;
  if (select count(*) from pg_constraint where contype='f' and confrelid='auth.sessions'::regclass)<>2
    or not exists(select 1 from pg_constraint where conname='refresh_tokens_session_id_fkey' and conrelid='auth.refresh_tokens'::regclass and confrelid='auth.sessions'::regclass and confdeltype='c')
    or not exists(select 1 from pg_constraint where conname='mfa_amr_claims_session_id_fkey' and conrelid='auth.mfa_amr_claims'::regclass and confrelid='auth.sessions'::regclass and confdeltype='c')
    or exists(select 1 from pg_constraint where contype='f' and confrelid=any(array[
      'auth.identities'::regclass,'auth.refresh_tokens'::regclass,'auth.mfa_amr_claims'::regclass,
      'public.profiles'::regclass,'public.forum_profile_settings'::regclass,
      'public.user_roles'::regclass,'private.internal_test_accounts'::regclass])) then
    raise exception 'RECONCILE_TRANSITIVE_CASCADE_DRIFT'; end if;
  if exists(select 1 from pg_trigger where tgrelid=any(v_affected) and not tgisinternal and (tgtype&8)<>0)
    or exists(select 1 from pg_rewrite where ev_class=any(v_affected) and ev_type in ('2','3','4')) then
    raise exception 'RECONCILE_DELETE_HOOK_DRIFT'; end if;

  -- Exact UUID references and room JSON are read as counts, never customer contents.
  v_scopes := 0;
  for v_scope in
    select n.nspname schema_name,c.relname table_name,a.attname column_name,a.atttypid
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where n.nspname in ('public','private','storage','auth') and c.relkind in ('r','p')
      and (a.atttypid='uuid'::regtype or (a.atttypid in ('text'::regtype,'varchar'::regtype)
        and a.attname in ('user_id','owner_id','actor_id','judge_id','identity')))
      and not exists(select 1 from pg_constraint fk where fk.contype='f' and fk.conrelid=c.oid
        and a.attnum=any(fk.conkey) and fk.confrelid='auth.users'::regclass)
      and not (n.nspname='auth' and c.relname in ('users','identities','sessions','refresh_tokens','mfa_amr_claims'))
    order by n.nspname,c.relname,a.attname
  loop
    v_scopes := v_scopes+1;
    execute format('select count(*) from %I.%I where %I=any($1::%s[])',
      v_scope.schema_name,v_scope.table_name,v_scope.column_name,
      case when v_scope.atttypid='uuid'::regtype then 'uuid' else 'text' end) into v_count using v_text_ids;
    if v_count<>0 then raise exception 'RECONCILE_NON_FK_REFERENCE'; end if;
  end loop;
  for v_scope in select table_schema schema_name,table_name,column_name from information_schema.columns
    where ((table_schema='private' and table_name like 'study_room_%') or (table_schema='public' and table_name like 'debate_v3_%')) and data_type='jsonb'
  loop
    v_scopes := v_scopes+1;
    execute format('select count(*) from %I.%I where exists(select 1 from unnest($1::text[]) needle where position(needle in %I::text)>0)',
      v_scope.schema_name,v_scope.table_name,v_scope.column_name) into v_count using v_text_ids;
    if v_count<>0 then raise exception 'RECONCILE_ROOM_JSON_REFERENCE'; end if;
  end loop;
  if v_scopes<>481 then raise exception 'RECONCILE_NON_FK_CATALOG_DRIFT'; end if;

  if exists(select 1 from storage.objects where position(v_event in name)>0
      or exists(select 1 from unnest(v_text_ids||v_run_ids) needle where position(needle in name)>0))
    or exists(select 1 from storage.s3_multipart_uploads where position(v_event in key)>0
      or exists(select 1 from unnest(v_text_ids||v_run_ids) needle where position(needle in key)>0))
    or exists(select 1 from storage.s3_multipart_uploads_parts where position(v_event in key)>0
      or exists(select 1 from unnest(v_text_ids||v_run_ids) needle where position(needle in key)>0)) then
    raise exception 'RECONCILE_STORAGE_PATH_REFERENCE'; end if;
  select count(*) into v_audit_before from auth.audit_log_entries
    where exists(select 1 from unnest(v_text_ids) needle where position(needle in payload::text)>0);
  if v_audit_before<>0 then raise exception 'RECONCILE_AUTH_AUDIT_DRIFT'; end if;

  -- Final session check, then the sole mutation while all frozen rows remain locked.
  if exists(select 1 from auth.sessions where user_id=any(v_ids))
    or exists(select 1 from auth.refresh_tokens where user_id=any(v_text_ids)) then
    raise exception 'RECONCILE_SESSION_OR_REFRESH_REAPPEARED'; end if;
  delete from auth.users u using jsonb_array_elements(v_frozen) f
    where u.id=(f.value->>'id')::uuid
      and u.created_at=(f.value->>'createdAt')::timestamptz
      and u.last_sign_in_at=(f.value->>'lastSignInAt')::timestamptz
      and u.email_confirmed_at=(f.value->>'emailConfirmedAt')::timestamptz
      and u.email='dd-study-room-student-'||(f.value->>'runId')||'@example.com'
      and encode(sha256(convert_to(u.raw_user_meta_data::text,'UTF8')),'hex')=f.value->>'userMetadataSha256'
      and encode(sha256(convert_to(u.raw_app_meta_data::text,'UTF8')),'hex')=f.value->>'appMetadataSha256';
  get diagnostics v_removed=row_count;
  if v_removed<>10 or exists(select 1 from auth.users where id=any(v_ids))
    or exists(select 1 from auth.identities where user_id=any(v_ids))
    or exists(select 1 from auth.sessions where user_id=any(v_ids))
    or exists(select 1 from auth.refresh_tokens where user_id=any(v_text_ids))
    or exists(select 1 from public.profiles where id=any(v_ids))
    or exists(select 1 from public.forum_profile_settings where user_id=any(v_ids))
    or exists(select 1 from public.user_roles where user_id=any(v_ids))
    or exists(select 1 from private.internal_test_accounts where user_id=any(v_ids))
    or (select count(*) from auth.audit_log_entries where exists(select 1 from unnest(v_text_ids) needle where position(needle in payload::text)>0))<>v_audit_before then
    raise exception 'RECONCILE_AUTH_DELETE_OR_AUDIT_PRESERVATION'; end if;
end;
$reconcile$;
commit;

-- Root must independently read back all 11 run IDs and exact event scopes afterward.
-- This source receipt does not itself assert execution or successful cleanup.


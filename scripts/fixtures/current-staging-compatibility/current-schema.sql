-- GENERATED from the current, metadata-only staging captures. Never run against a hosted database.

-- Fixture contains no customer data and is not a migration or Supabase backup.

\set ON_ERROR_STOP on

BEGIN;

DO $fixture_guard$ BEGIN
  IF current_database() <> 'duediligence_compatibility_fixture'
     OR session_user <> 'fixture_bootstrap' OR current_user <> 'fixture_bootstrap'
     OR current_setting('duediligence.compatibility_fixture', true) IS DISTINCT FROM 'isolated-current-capture-20261018'
     OR current_setting('server_version_num') <> '170006'
     OR current_setting('server_encoding') <> 'UTF8'
     OR current_setting('default_transaction_isolation') <> 'read committed'
  THEN RAISE EXCEPTION 'Disposable current-schema fixture guard failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('examination_room_v1', 'auth', 'extensions'))
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('postgres','anon','authenticated','service_role','supabase_admin','supabase_auth_admin','dashboard_user'))
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
  THEN RAISE EXCEPTION 'Fixture requires a fresh isolated PostgreSQL service and database'; END IF;
END $fixture_guard$;

SET LOCAL search_path = pg_catalog;

SET LOCAL client_encoding = 'UTF8';

CREATE ROLE "anon" NOSUPERUSER INHERIT NOBYPASSRLS NOLOGIN;

CREATE ROLE "authenticated" NOSUPERUSER INHERIT NOBYPASSRLS NOLOGIN;

CREATE ROLE "postgres" NOSUPERUSER INHERIT BYPASSRLS LOGIN;

CREATE ROLE "service_role" NOSUPERUSER INHERIT BYPASSRLS NOLOGIN;

CREATE ROLE "supabase_admin" NOLOGIN NOSUPERUSER INHERIT NOBYPASSRLS; -- Synthetic ACL support role; runtime flags were not captured.

CREATE ROLE "supabase_auth_admin" NOLOGIN NOSUPERUSER INHERIT NOBYPASSRLS; -- Synthetic ACL support role; runtime flags were not captured.

CREATE ROLE "dashboard_user" NOLOGIN NOSUPERUSER INHERIT NOBYPASSRLS; -- Synthetic ACL support role; runtime flags were not captured.

ALTER DATABASE "duediligence_compatibility_fixture" OWNER TO "postgres";

CREATE SCHEMA "auth" AUTHORIZATION "supabase_admin";

REVOKE ALL ON SCHEMA "auth" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT USAGE, CREATE ON SCHEMA "auth" TO "supabase_admin";

GRANT USAGE ON SCHEMA "auth" TO "anon";

GRANT USAGE ON SCHEMA "auth" TO "authenticated";

GRANT USAGE ON SCHEMA "auth" TO "service_role";

GRANT USAGE, CREATE ON SCHEMA "auth" TO "supabase_auth_admin";

GRANT USAGE, CREATE ON SCHEMA "auth" TO "dashboard_user";

GRANT USAGE ON SCHEMA "auth" TO "postgres";

CREATE SCHEMA "examination_room_v1" AUTHORIZATION "postgres";

REVOKE ALL ON SCHEMA "examination_room_v1" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT USAGE, CREATE ON SCHEMA "examination_room_v1" TO "postgres";

GRANT USAGE ON SCHEMA "examination_room_v1" TO "service_role";

CREATE SCHEMA "extensions" AUTHORIZATION "postgres";

REVOKE ALL ON SCHEMA "extensions" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT USAGE, CREATE ON SCHEMA "extensions" TO "postgres";

GRANT USAGE ON SCHEMA "extensions" TO "anon";

GRANT USAGE ON SCHEMA "extensions" TO "authenticated";

GRANT USAGE ON SCHEMA "extensions" TO "service_role";

GRANT USAGE, CREATE ON SCHEMA "extensions" TO "dashboard_user";

ALTER SCHEMA "public" OWNER TO "pg_database_owner";

REVOKE ALL ON SCHEMA "public" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT USAGE, CREATE ON SCHEMA "public" TO "pg_database_owner";

GRANT USAGE ON SCHEMA "public" TO PUBLIC;

GRANT USAGE ON SCHEMA "public" TO "postgres";

GRANT USAGE ON SCHEMA "public" TO "anon";

GRANT USAGE ON SCHEMA "public" TO "authenticated";

GRANT USAGE ON SCHEMA "public" TO "service_role";

CREATE EXTENSION pgcrypto WITH SCHEMA extensions VERSION '1.3';

DO $extension_guard$ BEGIN
  IF (SELECT extversion FROM pg_extension WHERE extname='plpgsql') IS DISTINCT FROM '1.0'
     OR (SELECT extversion FROM pg_extension WHERE extname='pgcrypto') IS DISTINCT FROM '1.3'
  THEN RAISE EXCEPTION 'Unexpected fixture extension version'; END IF;
END $extension_guard$;

-- External dependency tables are minimal synthetic projections, not copies of Auth/Profile tables.

CREATE TABLE "auth"."users" (
  "id" uuid,
  "email" character varying(255),
  "raw_user_meta_data" jsonb
);

ALTER TABLE "auth"."users" OWNER TO "postgres";

REVOKE ALL ON TABLE "auth"."users" FROM PUBLIC;

CREATE TABLE "public"."profiles" (
  "id" uuid,
  "display_name" text,
  "school" text,
  "law_school_id" text,
  "law_school_other" text
);

ALTER TABLE "public"."profiles" OWNER TO "postgres";

REVOKE ALL ON TABLE "public"."profiles" FROM PUBLIC;

CREATE TABLE "public"."user_roles" (
  "user_id" uuid,
  "role" text
);

ALTER TABLE "public"."user_roles" OWNER TO "postgres";

REVOKE ALL ON TABLE "public"."user_roles" FROM PUBLIC;

-- Current namespace tables: column order, types, defaults and nullability preserved.

CREATE TABLE "examination_room_v1"."answer_revisions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "exam_version_id" uuid NOT NULL,
  "question_id" uuid NOT NULL,
  "revision_number" integer NOT NULL,
  "client_revision_id" uuid NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "answer_format" text NOT NULL,
  "answer_payload" jsonb NOT NULL,
  "answer_sha256" text NOT NULL,
  "is_flagged" boolean DEFAULT false NOT NULL,
  "word_count" integer,
  "source" text NOT NULL,
  "saved_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."answer_revisions" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."audit_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL,
  "exam_id" uuid,
  "session_id" uuid,
  "actor_user_id" uuid,
  "actor_role" text NOT NULL,
  "event_type" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid,
  "correlation_id" uuid NOT NULL,
  "request_hash" text NOT NULL,
  "ip_hash" text,
  "user_agent_hash" text,
  "event_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "previous_event_hash" text,
  "event_hash" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."audit_events" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."email_delivery_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL,
  "exam_id" uuid NOT NULL,
  "activation_id" uuid,
  "request_hash" text NOT NULL,
  "delivery_kind" text NOT NULL,
  "professor_recipient" text,
  "owner_copy_recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provider_status" text NOT NULL,
  "provider_id" text,
  "safe_error_code" text,
  "attempted_by_user_id" uuid NOT NULL,
  "attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."email_delivery_events" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."exam_roster" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "exam_id" uuid NOT NULL,
  "institution_id" uuid NOT NULL,
  "student_identity_id" uuid NOT NULL,
  "grading_alias" text,
  "roster_status" text DEFAULT 'eligible'::text NOT NULL,
  "accommodations" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "added_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."exam_roster" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."exam_versions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "exam_id" uuid NOT NULL,
  "institution_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "title_snapshot" text NOT NULL,
  "instructions" text DEFAULT ''::text NOT NULL,
  "duration_seconds" integer NOT NULL,
  "anonymous_grading_snapshot" boolean DEFAULT false NOT NULL,
  "privacy_notice_version_id" uuid NOT NULL,
  "controls" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "publication_manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "content_sha256" text NOT NULL,
  "publication_status" text DEFAULT 'building'::text NOT NULL,
  "published_by_user_id" uuid,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "admission_mode_snapshot" text DEFAULT 'key_only'::text NOT NULL,
  "allowed_emails_snapshot" text[] DEFAULT '{}'::text[] NOT NULL
);

ALTER TABLE "examination_room_v1"."exam_versions" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."exams" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "anonymous_grading" boolean DEFAULT false NOT NULL,
  "current_published_version_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "admission_mode" text DEFAULT 'key_only'::text NOT NULL,
  "allowed_emails" text[] DEFAULT '{}'::text[] NOT NULL,
  "blocked_at" timestamp with time zone,
  "blocked_by_user_id" uuid,
  "block_reason" text,
  "deleted_at" timestamp with time zone,
  "deleted_by_user_id" uuid,
  "delete_reason" text,
  "lifecycle_prior_status" text
);

ALTER TABLE "examination_room_v1"."exams" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."grade_revision_items" (
  "grade_revision_id" uuid NOT NULL,
  "exam_version_id" uuid NOT NULL,
  "question_id" uuid NOT NULL,
  "score" numeric(12,2) NOT NULL,
  "maximum_score" numeric(12,2) NOT NULL,
  "feedback" text,
  "rubric_marks" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."grade_revision_items" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."grade_revisions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL,
  "exam_version_id" uuid NOT NULL,
  "revision_number" integer NOT NULL,
  "client_revision_id" uuid NOT NULL,
  "manifest_sha256" text NOT NULL,
  "grading_manifest" jsonb NOT NULL,
  "grader_user_id" uuid NOT NULL,
  "source" text NOT NULL,
  "grade_status" text NOT NULL,
  "item_count" integer NOT NULL,
  "total_score" numeric(12,2) NOT NULL,
  "maximum_score" numeric(12,2) NOT NULL,
  "general_feedback" text,
  "private_notes" text,
  "rubric_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."grade_revisions" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."institutions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "institution_code" text NOT NULL,
  "profile_school_id" text NOT NULL,
  "institution_name" text NOT NULL,
  "institution_status" text DEFAULT 'active'::text NOT NULL,
  "bootstrap_request_hash" text NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."institutions" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."media_upload_intents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "client_artifact_id" uuid NOT NULL,
  "request_hash" text NOT NULL,
  "artifact_kind" text NOT NULL,
  "source_mime_type" text NOT NULL,
  "encrypted_size_bytes" bigint NOT NULL,
  "object_sha256" text NOT NULL,
  "captured_from" timestamp with time zone NOT NULL,
  "captured_to" timestamp with time zone NOT NULL,
  "retention_until" timestamp with time zone NOT NULL,
  "provider" text NOT NULL,
  "provider_object_reference" text NOT NULL,
  "wrapped_key_algorithm" text NOT NULL,
  "wrapped_key_version" smallint NOT NULL,
  "wrapped_key_ciphertext" text NOT NULL,
  "wrapped_key_iv" text NOT NULL,
  "wrapped_key_aad_sha256" text NOT NULL,
  "intent_status" text DEFAULT 'prepared'::text NOT NULL,
  "completion_request_hash" text,
  "provider_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "artifact_id" uuid,
  "prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."media_upload_intents" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."owner_identity_corrections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL,
  "exam_id" uuid NOT NULL,
  "student_identity_id" uuid NOT NULL,
  "request_hash" text NOT NULL,
  "before_record" jsonb NOT NULL,
  "after_record" jsonb NOT NULL,
  "reason" text NOT NULL,
  "corrected_by_user_id" uuid NOT NULL,
  "corrected_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."owner_identity_corrections" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."owner_key_envelopes" (
  "activation_id" uuid NOT NULL,
  "exam_id" uuid NOT NULL,
  "institution_id" uuid NOT NULL,
  "envelope_algorithm" text DEFAULT 'aes-256-gcm-v1'::text NOT NULL,
  "key_version" integer DEFAULT 1 NOT NULL,
  "ciphertext_base64" text NOT NULL,
  "iv_base64" text NOT NULL,
  "aad_sha256" text NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."owner_key_envelopes" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."privacy_acceptances" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "notice_version_id" uuid NOT NULL,
  "roster_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "exam_version_id" uuid NOT NULL,
  "client_event_id" uuid NOT NULL,
  "decision" text NOT NULL,
  "prior_acceptance_id" uuid,
  "accepted_features" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "evidence_sha256" text NOT NULL,
  "capture_method" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."privacy_acceptances" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."privacy_notice_versions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL,
  "notice_code" text NOT NULL,
  "version_number" integer NOT NULL,
  "title" text NOT NULL,
  "notice_body" text NOT NULL,
  "body_sha256" text NOT NULL,
  "processing_purposes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "effective_at" timestamp with time zone NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."privacy_notice_versions" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."proctoring_artifacts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "incident_id" uuid,
  "artifact_kind" text NOT NULL,
  "encrypted_object_reference" text NOT NULL,
  "object_sha256" text NOT NULL,
  "encryption_key_reference" text NOT NULL,
  "captured_from" timestamp with time zone NOT NULL,
  "captured_to" timestamp with time zone NOT NULL,
  "retention_until" timestamp with time zone NOT NULL,
  "artifact_status" text DEFAULT 'available'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."proctoring_artifacts" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."proctoring_incidents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "client_event_id" uuid NOT NULL,
  "incident_kind" text NOT NULL,
  "source" text NOT NULL,
  "severity" text DEFAULT 'info'::text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "duration_ms" integer,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "review_status" text DEFAULT 'unreviewed'::text NOT NULL,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamp with time zone,
  "review_notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."proctoring_incidents" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."professor_access_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "email_normalized" text NOT NULL,
  "display_name" text NOT NULL,
  "claimed_school_id" text NOT NULL,
  "claimed_school_name" text NOT NULL,
  "requested_institution_id" uuid NOT NULL,
  "request_status" text DEFAULT 'pending'::text NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamp with time zone,
  "review_reason" text,
  "assigned_institution_id" uuid,
  "approved_membership_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."professor_access_requests" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."questions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "exam_version_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "question_key" text NOT NULL,
  "question_kind" text NOT NULL,
  "prompt" text NOT NULL,
  "points" numeric(10,2) DEFAULT 0 NOT NULL,
  "configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "content_sha256" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."questions" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."recovery_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "exam_id" uuid NOT NULL,
  "exam_version_id" uuid NOT NULL,
  "snapshot_sequence" integer NOT NULL,
  "snapshot_scope" text NOT NULL,
  "request_hash" text NOT NULL,
  "encrypted_object_reference" text,
  "snapshot_sha256" text,
  "encryption_key_reference" text,
  "record_count" bigint NOT NULL,
  "snapshot_status" text DEFAULT 'pending'::text NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retention_until" timestamp with time zone NOT NULL,
  "restored_at" timestamp with time zone,
  "restored_by_user_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_kind" text,
  "source_session_id" uuid,
  "source_submission_id" uuid,
  "source_grade_revision_id" uuid,
  "source_result_release_id" uuid,
  "materialization_attempts" integer DEFAULT 0 NOT NULL,
  "lease_id" uuid,
  "lease_expires_at" timestamp with time zone,
  "next_retry_at" timestamp with time zone,
  "available_at" timestamp with time zone,
  "last_error_code" text,
  "last_error_at" timestamp with time zone,
  "verified_at" timestamp with time zone,
  "restored_record_count" bigint DEFAULT 0 NOT NULL,
  "restore_verification_sha256" text
);

ALTER TABLE "examination_room_v1"."recovery_snapshots" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."result_email_delivery_events" (
  "release_id" uuid NOT NULL,
  "institution_id" uuid NOT NULL,
  "exam_id" uuid NOT NULL,
  "student_session_id" uuid NOT NULL,
  "batch_request_hash" text NOT NULL,
  "recipient_email" text,
  "recipient_name" text NOT NULL,
  "exam_title" text NOT NULL,
  "subject_name" text NOT NULL,
  "total_score" numeric(10,2) NOT NULL,
  "maximum_score" numeric(10,2) NOT NULL,
  "released_at" timestamp with time zone NOT NULL,
  "delivery_status" text NOT NULL,
  "provider_id" text,
  "safe_error_code" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "claim_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "attempted_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."result_releases" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL,
  "grade_revision_id" uuid,
  "release_action" text NOT NULL,
  "supersedes_release_id" uuid,
  "channel" text NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "delivery_reference_hash" text,
  "manifest_sha256" text,
  "release_manifest" jsonb,
  "reason" text,
  "performed_by_user_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "batch_request_hash" text
);

ALTER TABLE "examination_room_v1"."result_releases" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."room_activations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "exam_id" uuid NOT NULL,
  "institution_id" uuid NOT NULL,
  "exam_version_id" uuid NOT NULL,
  "key_hash" text NOT NULL,
  "key_hash_algorithm" text NOT NULL,
  "request_hash" text NOT NULL,
  "activation_status" text DEFAULT 'scheduled'::text NOT NULL,
  "opens_at" timestamp with time zone NOT NULL,
  "closes_at" timestamp with time zone NOT NULL,
  "max_sessions" integer,
  "activated_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deactivated_at" timestamp with time zone,
  "deactivated_by_user_id" uuid,
  "deactivation_reason" text
);

ALTER TABLE "examination_room_v1"."room_activations" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."staff_memberships" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "staff_role" text NOT NULL,
  "display_name" text,
  "email_normalized" text,
  "membership_status" text DEFAULT 'active'::text NOT NULL,
  "grant_reason" text DEFAULT 'Institution examination access approved.'::text NOT NULL,
  "granted_by_user_id" uuid NOT NULL,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_by_user_id" uuid,
  "revoked_at" timestamp with time zone,
  "revocation_reason" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."staff_memberships" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."student_identities" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL,
  "auth_user_id" uuid,
  "external_student_id" text NOT NULL,
  "full_name" text NOT NULL,
  "email_normalized" text,
  "identity_status" text DEFAULT 'active'::text NOT NULL,
  "verified_at" timestamp with time zone,
  "verification_method" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."student_identities" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."student_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "activation_id" uuid NOT NULL,
  "exam_id" uuid NOT NULL,
  "institution_id" uuid NOT NULL,
  "exam_version_id" uuid NOT NULL,
  "roster_id" uuid NOT NULL,
  "session_token_hash" text NOT NULL,
  "consent_request_hash" text NOT NULL,
  "client_instance_id" uuid NOT NULL,
  "session_status" text DEFAULT 'created'::text NOT NULL,
  "identity_verified_at" timestamp with time zone,
  "identity_verification_method" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_heartbeat_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "session_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."student_sessions" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."submission_answers" (
  "submission_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "question_id" uuid NOT NULL,
  "answer_revision_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."submission_answers" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."submission_receipts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL,
  "receipt_code" uuid DEFAULT gen_random_uuid() NOT NULL,
  "receipt_sha256" text NOT NULL,
  "receipt_payload" jsonb NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."submission_receipts" OWNER TO "postgres";

CREATE TABLE "examination_room_v1"."submissions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "exam_version_id" uuid NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "manifest_sha256" text NOT NULL,
  "submission_manifest" jsonb NOT NULL,
  "answer_count" integer NOT NULL,
  "submitted_at_client" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "submission_status" text DEFAULT 'accepted'::text NOT NULL,
  "status_reason" text,
  "status_changed_by_user_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "examination_room_v1"."submissions" OWNER TO "postgres";

-- Exact current functions. Disable body validation only for unordered dependency import.

SET LOCAL check_function_bodies = off;

CREATE OR REPLACE FUNCTION examination_room_v1.api_admin(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_variable
declare
  exam_id uuid;
  exam_version_id uuid;
  exam_owner_id uuid;
  exam_title text;
  professor_name text;
  professor_email text;
  request_hash text;
  event_time timestamptz;
  activation_expires_at timestamptz;
  activation_id uuid;
  activation_status text;
  stored_key_hash text;
  snapshot_id uuid;
  affected_count integer;
  record_count bigint;
  replay jsonb;
  response jsonb;
begin
  if p_operation = 'overview' then
    select jsonb_build_object(
      'ok', true,
      'institutionId', p_institution_id,
      'exams', coalesce(jsonb_agg(jsonb_build_object(
        'examId', e.id,
        'title', e.title,
        'status', e.status,
        'ownerUserId', e.owner_user_id,
        'anonymousGrading', e.anonymous_grading,
        'activation', a.item,
        'sessionCount', (select count(*) from examination_room_v1.student_sessions ss where ss.exam_id = e.id),
        'submissionCount', (
          select count(*)
          from examination_room_v1.submissions sub
          join examination_room_v1.student_sessions ss on ss.id = sub.session_id
          where ss.exam_id = e.id
        ),
        'pendingSnapshotCount', (
          select count(*) from examination_room_v1.recovery_snapshots rs
          where rs.exam_id = e.id and rs.snapshot_status = 'pending'
        )
      ) order by e.updated_at desc), '[]'::jsonb)
    )
    into response
    from examination_room_v1.exams e
    left join lateral (
      select jsonb_build_object(
        'id', ra.id,
        'status', ra.activation_status,
        'opensAt', ra.opens_at,
        'closesAt', ra.closes_at,
        'maxSessions', ra.max_sessions
      ) as item
      from examination_room_v1.room_activations ra
      where ra.exam_id = e.id
      order by ra.created_at desc
      limit 1
    ) a on true
    where e.institution_id = p_institution_id;
    return response;
  end if;

  exam_id := nullif(p_payload ->> 'examId', '')::uuid;
  request_hash := p_payload ->> 'requestHash';
  if exam_id is null then
    return examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'Choose a valid examination.', 404,
      'Return to Admin and choose an available examination.'
    );
  end if;

  select e.current_published_version_id, e.owner_user_id, e.title
  into exam_version_id, exam_owner_id, exam_title
  from examination_room_v1.exams e
  where e.id = exam_id
    and e.institution_id = p_institution_id
  for update;

  if exam_owner_id is null then
    return examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'The examination does not exist in this institution.', 404,
      'Return to Admin and choose an available examination.'
    );
  end if;

  if p_operation in ('activate_exam', 'email_key') then
    if exam_version_id is null then
      return examination_room_v1.api_error(
        'PUBLICATION_REQUIRED', 'Publish the examination before issuing a room key.', 409,
        'Ask the professor to publish the completed examination, then issue the key.'
      );
    end if;

    select
      coalesce(
        nullif(btrim(membership.display_name), ''),
        nullif(btrim(profile.display_name), ''),
        nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
        nullif(pg_catalog.split_part(lower(auth_user.email), '@', 1), ''),
        'Examination creator'
      ),
      coalesce(membership.email_normalized, lower(auth_user.email))
    into professor_name, professor_email
    from auth.users auth_user
    left join public.profiles profile on profile.id = auth_user.id
    left join lateral (
      select row_value.display_name, row_value.email_normalized
      from examination_room_v1.staff_memberships row_value
      where row_value.institution_id = p_institution_id
        and row_value.user_id = exam_owner_id
        and row_value.membership_status = 'active'
      order by (row_value.staff_role = 'professor') desc, row_value.granted_at desc
      limit 1
    ) membership on true
    where auth_user.id = exam_owner_id;

    

    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'admin.' || p_operation);
    if replay is not null then
      if replay ->> 'ok' = 'false' then return replay; end if;
      select a.id, a.activation_status, a.key_hash
      into activation_id, activation_status, stored_key_hash
      from examination_room_v1.room_activations a
      where a.request_hash = request_hash
        and a.institution_id = p_institution_id
        and a.exam_id = exam_id
      for update;

      if activation_id is null then
        return examination_room_v1.api_error(
          'ACTIVATION_REPLAY_INVALID', 'The prior activation receipt cannot be recovered.', 409,
          'Create a new request before issuing another room key.'
        );
      end if;

      if stored_key_hash <> p_payload ->> 'roomKeyHash' then
        return examination_room_v1.api_error(
          'ACTIVATION_REPLAY_REQUIRES_NEW_REQUEST',
          'The prior room-key request is already bound to a different key.',
          409,
          'Use the explicit Rotate key action if the current key must be replaced.'
        );
      end if;
      if activation_status = 'scheduled' then
        update examination_room_v1.room_activations activation
        set activation_status = 'open',
            opens_at = least(activation.opens_at, clock_timestamp()),
            deactivated_at = null,
            deactivated_by_user_id = null,
            deactivation_reason = null
        where activation.id = activation_id
          and activation.activation_status = 'scheduled'
          and activation.closes_at > clock_timestamp();
        select activation.activation_status into activation_status
        from examination_room_v1.room_activations activation
        where activation.id = activation_id;
      end if;
      if activation_status = 'open' then
        replay := jsonb_set(replay, '{activation,status}', to_jsonb('open'::text), true)
          || jsonb_build_object('status', 'open');
      end if;
      return replay;
    end if;

    event_time := clock_timestamp();
    activation_expires_at := case
      when nullif(btrim(p_payload ->> 'closesAt'), '') is null
        then event_time + interval '180 days'
      when (p_payload ->> 'closesAt')::timestamptz <= event_time
        then event_time + interval '180 days'
      else (p_payload ->> 'closesAt')::timestamptz
    end;
    if coalesce((p_payload ->> 'replaceCurrent')::boolean, false) then
      update examination_room_v1.room_activations a
      set activation_status = 'revoked',
          deactivated_at = event_time,
          deactivated_by_user_id = p_actor_user_id,
          deactivation_reason = 'Administrator issued a replacement room key.'
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in ('scheduled', 'open');
    elsif exists (
      select 1
      from examination_room_v1.room_activations a
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in ('scheduled', 'open')
    ) then
      return examination_room_v1.api_error(
        'ACTIVE_KEY_EXISTS', 'This examination already has a current room key.', 409,
        'Use Email key to replace it deliberately, or revoke the current key first.'
      );
    end if;

    activation_id := gen_random_uuid();
    insert into examination_room_v1.room_activations (
      id, exam_id, institution_id, exam_version_id, key_hash, key_hash_algorithm,
      request_hash, activation_status, opens_at, closes_at, max_sessions, activated_by_user_id
    ) values (
      activation_id,
      exam_id,
      p_institution_id,
      exam_version_id,
      p_payload ->> 'roomKeyHash',
      coalesce(p_payload ->> 'keyHashAlgorithm', 'hmac-sha256-v1'),
      request_hash,
      'open',
      event_time,
      activation_expires_at,
      nullif(p_payload ->> 'maxSessions', '')::integer,
      p_actor_user_id
    );

    response := jsonb_build_object(
      'ok', true,
      'activation', jsonb_build_object(
        'id', activation_id,
        'status', 'open',
        'opensAt', event_time,
        'expiresAt', activation_expires_at,
        'maxSessions', p_payload -> 'maxSessions'
      ),
      'professorEmail', professor_email,
      'professorName', coalesce(professor_name, 'Professor'),
      'examTitle', exam_title
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'admin',
      'admin.' || p_operation, 'room_activation', activation_id, request_hash,
      event_time, response, null
    );
    return response;
  end if;

  if p_operation = 'revoke_key' then
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'admin.revoke_key');
    if replay is not null then return replay; end if;
    event_time := coalesce((p_payload ->> 'revokedAt')::timestamptz, clock_timestamp());
    update examination_room_v1.room_activations a
    set activation_status = 'revoked',
        deactivated_at = event_time,
        deactivated_by_user_id = p_actor_user_id,
        deactivation_reason = p_payload ->> 'reason'
    where a.exam_id = exam_id
      and a.institution_id = p_institution_id
      and a.activation_status in ('scheduled', 'open');
    get diagnostics affected_count = row_count;
    response := jsonb_build_object('ok', true, 'examId', exam_id, 'revoked', affected_count);
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'admin',
      'admin.revoke_key', 'exam', exam_id, request_hash, event_time, response, null
    );
    return response;
  end if;

  if p_operation = 'create_snapshot' then
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'admin.create_snapshot');
    if replay is not null then return replay; end if;
    if exam_version_id is null then
      return examination_room_v1.api_error(
        'PUBLICATION_REQUIRED', 'A recovery snapshot requires a published examination version.', 409,
        'Publish the examination before requesting a recovery snapshot.'
      );
    end if;
    event_time := coalesce((p_payload ->> 'requestedAt')::timestamptz, clock_timestamp());
    select
      (select count(*) from examination_room_v1.questions q where q.exam_version_id = exam_version_id)
      + (select count(*) from examination_room_v1.answer_revisions ar join examination_room_v1.student_sessions ss on ss.id = ar.session_id where ss.exam_id = exam_id)
      + (select count(*) from examination_room_v1.grade_revisions gr join examination_room_v1.submissions sub on sub.id = gr.submission_id join examination_room_v1.student_sessions ss on ss.id = sub.session_id where ss.exam_id = exam_id)
    into record_count;

    snapshot_id := gen_random_uuid();
    insert into examination_room_v1.recovery_snapshots (
      id, exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
      record_count, snapshot_status, created_by_user_id, retention_until
    ) values (
      snapshot_id,
      exam_id,
      exam_version_id,
      examination_room_v1.next_snapshot_sequence(exam_id),
      coalesce(p_payload ->> 'scope', 'full_recovery'),
      request_hash,
      record_count,
      'pending',
      p_actor_user_id,
      event_time + interval '365 days'
    );
    response := jsonb_build_object(
      'ok', true,
      'snapshot', jsonb_build_object(
        'id', snapshot_id,
        'status', 'pending',
        'scope', coalesce(p_payload ->> 'scope', 'full_recovery'),
        'recordCount', record_count,
        'requestedAt', event_time
      )
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'admin',
      'admin.create_snapshot', 'recovery_snapshot', snapshot_id, request_hash,
      event_time, response, null
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'The administrator operation is not implemented.', 400,
    'Refresh Admin and try a listed action.'
  );
end;
$function$


ALTER FUNCTION "examination_room_v1"."api_admin"(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."api_admin"(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."api_admin"(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.api_error(p_code text, p_message text, p_status integer DEFAULT 409, p_recovery text DEFAULT 'Refresh the view and try again. Your saved work remains preserved.'::text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'ok', false,
    'errorCode', p_code,
    'message', p_message,
    'error', jsonb_build_object(
      'code', p_code,
      'message', p_message,
      'status', p_status,
      'recovery', p_recovery
    )
  );
$function$


ALTER FUNCTION "examination_room_v1"."api_error"(p_code text, p_message text, p_status integer, p_recovery text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."api_error"(p_code text, p_message text, p_status integer, p_recovery text) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."api_error"(p_code text, p_message text, p_status integer, p_recovery text) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.api_professor(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_variable
declare
  actor_is_admin boolean;
  actor_name text;
  actor_email text;
  exam_id uuid;
  exam_owner_id uuid;
  version_id uuid;
  version_number integer;
  notice_id uuid;
  request_hash text;
  requested_at timestamptz;
  exam_payload jsonb;
  draft_payload jsonb;
  controls_payload jsonb;
  publication_bundle jsonb;
  publication_hash text;
  response jsonb;
  replay jsonb;
  roster_item jsonb;
  student_identity_id uuid;
  roster_row_id uuid;
  use_anonymous_grading boolean;
  question_count integer;
  roster_count integer;
  submission_id uuid;
  student_session_id uuid;
  exam_version_id uuid;
  grading_manifest jsonb;
  release_manifest jsonb;
  expected_result jsonb;
  release_item jsonb;
  score_item jsonb;
  grade_revision_id uuid;
  grade_revision_number integer;
  question_id uuid;
  score_count integer;
  distinct_score_count integer;
  total_score numeric(12, 2);
  maximum_score numeric(12, 2);
  event_time timestamptz;
  room_activation_status text;
begin
  actor_is_admin := examination_room_v1.owner_authorized(p_actor_user_id);

  select
    coalesce(
      nullif(btrim(membership.display_name), ''),
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
      nullif(pg_catalog.split_part(lower(auth_user.email), '@', 1), ''),
      'Examination creator'
    ),
    coalesce(membership.email_normalized, lower(auth_user.email))
  into actor_name, actor_email
  from auth.users auth_user
  left join public.profiles profile on profile.id = auth_user.id
  left join lateral (
    select row_value.display_name, row_value.email_normalized
    from examination_room_v1.staff_memberships row_value
    where row_value.institution_id = p_institution_id
      and row_value.user_id = p_actor_user_id
      and row_value.membership_status = 'active'
    order by (row_value.staff_role = 'admin') desc, row_value.granted_at desc
    limit 1
  ) membership on true
  where auth_user.id = p_actor_user_id;

  if p_operation = 'session' then
    select jsonb_build_object(
      'ok', true,
      'professor', jsonb_build_object(
        'id', p_actor_user_id,
        'authorized', true,
        'displayName', coalesce(actor_name, 'Professor'),
        'email', actor_email,
        'institutionId', p_institution_id,
        'adminTesting', actor_is_admin
      ),
      'exam', coalesce(exams.items -> 0, 'null'::jsonb),
      'exams', exams.items
    )
    into response
    from lateral (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'title', e.title,
          'status', e.status,
          'anonymousGrading', e.anonymous_grading,
          'currentVersionId', e.current_published_version_id,
          'admissionMode', e.admission_mode,
          'allowedEmails', to_jsonb(e.allowed_emails),
          'activation', (
            select jsonb_build_object(
              'id', activation.id,
              'status', activation.activation_status,
              'opensAt', activation.opens_at,
              'closesAt', activation.closes_at,
              'expiresAt', activation.closes_at,
              'maxSessions', activation.max_sessions,
              'createdAt', activation.created_at
            )
            from examination_room_v1.room_activations activation
            where activation.exam_id = e.id
            order by activation.created_at desc, activation.id desc
            limit 1
          ),
          'updatedAt', e.updated_at
        ) order by e.updated_at desc
      ), '[]'::jsonb) as items
      from examination_room_v1.exams e
      where e.institution_id = p_institution_id
        and (actor_is_admin or e.owner_user_id = p_actor_user_id)
    ) exams;
    return response;
  end if;

  if p_operation in ('exam', 'monitor', 'grading', 'grading_context') then
    exam_id := nullif(p_payload ->> 'examId', '')::uuid;
  end if;

  if p_operation = 'release_context' then
    exam_id := nullif(p_payload ->> 'examId', '')::uuid;
  end if;

  if p_operation in ('exam', 'monitor', 'grading', 'grading_context', 'release_context', 'open_room', 'close_room', 'save_grade', 'release_results') then
    if exam_id is null then
      exam_id := nullif(p_payload ->> 'examId', '')::uuid;
    end if;

    select e.owner_user_id
    into exam_owner_id
    from examination_room_v1.exams e
    where e.id = exam_id
      and e.institution_id = p_institution_id;

    if exam_owner_id is null then
      return examination_room_v1.api_error(
        'EXAM_NOT_FOUND', 'The examination does not exist in this institution.', 404,
        'Return to the Examination Room list and choose an available examination.'
      );
    end if;

    if not actor_is_admin and exam_owner_id <> p_actor_user_id then
      return examination_room_v1.api_error(
        'FORBIDDEN', 'Only the examination owner or an administrator may access this examination.', 403,
        'Choose an examination assigned to your account.'
      );
    end if;
  end if;

  if p_operation = 'exam' then
    select coalesce(
      (
        select v.id
        from examination_room_v1.exam_versions v
        where v.exam_id = exam_id
        order by (v.publication_status = 'building') desc, v.version_number desc
        limit 1
      ),
      e.current_published_version_id
    )
    into version_id
    from examination_room_v1.exams e
    where e.id = exam_id;

    select jsonb_build_object(
      'ok', true,
      'exam', jsonb_build_object(
        'id', e.id,
        'examId', e.id,
        'title', e.title,
        'description', e.description,
        'status', e.status,
        'anonymousGrading', e.anonymous_grading,
        'admissionMode', e.admission_mode,
        'allowedEmails', to_jsonb(e.allowed_emails),
        'currentPublishedVersionId', e.current_published_version_id,
        'versionId', v.id,
        'version', v.version_number,
        'publicationStatus', v.publication_status,
        'instructions', v.instructions,
        'durationMinutes', v.duration_seconds / 60,
        'controls', v.controls,
        'questions', coalesce(q.items, '[]'::jsonb),
        'roster', coalesce(r.items, '[]'::jsonb)
      ),
      'publicationManifest', case when v.publication_status = 'published' then v.publication_manifest else null end
    )
    into response
    from examination_room_v1.exams e
    left join examination_room_v1.exam_versions v on v.id = version_id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'questionNumber', q.position,
          'questionKey', q.question_key,
          'questionKind', q.question_kind,
          'type', coalesce(q.configuration ->> 'type', replace(q.question_kind, '_', '-')),
          'prompt', q.prompt,
          'points', q.points,
          'gradingGuidance', coalesce(q.configuration ->> 'gradingGuidance', ''),
          'wordLimit', q.configuration -> 'wordLimit',
          'choices', coalesce(q.configuration -> 'choices', '[]'::jsonb),
          'correctOptionIndex', q.configuration -> 'correctOptionIndex',
          'acceptedAnswers', coalesce(q.configuration -> 'acceptedAnswers', '[]'::jsonb)
        ) order by q.position
      ) as items
      from examination_room_v1.questions q
      where q.exam_version_id = v.id
    ) q on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', er.id,
          'fullName', si.full_name,
          'studentNumber', si.external_student_id,
          'email', si.email_normalized,
          'yearLevel', er.accommodations ->> 'yearLevel',
          'subject', er.accommodations ->> 'subject',
          'extraMinutes', coalesce((er.accommodations ->> 'extraMinutes')::integer, 0),
          'status', er.roster_status,
          'gradingAlias', er.grading_alias
        ) order by si.full_name
      ) as items
      from examination_room_v1.exam_roster er
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      where er.exam_id = e.id
    ) r on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = 'monitor' then
    select jsonb_build_object(
      'ok', true,
      'examId', e.id,
      'title', e.title,
      'status', e.status,
      'activation', a.item,
      'students', coalesce(s.items, '[]'::jsonb)
    )
    into response
    from examination_room_v1.exams e
    left join lateral (
      select jsonb_build_object(
        'id', ra.id,
        'status', ra.activation_status,
        'opensAt', ra.opens_at,
        'closesAt', ra.closes_at,
        'maxSessions', ra.max_sessions
      ) as item
      from examination_room_v1.room_activations ra
      where ra.exam_id = e.id
      order by ra.created_at desc
      limit 1
    ) a on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'sessionId', ss.id,
        'fullName', si.full_name,
        'studentNumber', si.external_student_id,
        'gradingAlias', case when e.anonymous_grading then null else er.grading_alias end,
        'status', ss.session_status,
        'startedAt', ss.started_at,
        'lastHeartbeatAt', ss.last_heartbeat_at,
        'currentQuestion', ss.session_metadata -> 'currentQuestion',
        'connected', coalesce((ss.session_metadata ->> 'connected')::boolean, false),
        'incidentCount', (select count(*) from examination_room_v1.proctoring_incidents pi where pi.session_id = ss.id),
        'submitted', exists (select 1 from examination_room_v1.submissions sub where sub.session_id = ss.id)
      ) order by si.full_name) as items
      from examination_room_v1.exam_roster er
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      left join examination_room_v1.student_sessions ss on ss.roster_id = er.id
      where er.exam_id = e.id
        and ss.id is not null
    ) s on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = 'grading' then
    select jsonb_build_object(
      'ok', true,
      'examId', e.id,
      'title', e.title,
      'students', coalesce(g.items, '[]'::jsonb)
    )
    into response
    from examination_room_v1.exams e
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'sessionId', case
          when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          else ss.id
        end,
        'submissionId', sub.id,
        'displayName', case when e.anonymous_grading then er.grading_alias else si.full_name end,
        'studentNumber', case when e.anonymous_grading then null else si.external_student_id end,
        'submittedAt', sub.received_at,
        'submissionStatus', sub.submission_status,
        'latestGrade', gr.grading_manifest,
        'released', exists (
          select 1 from examination_room_v1.result_releases rr
          where rr.submission_id = sub.id
            and rr.release_action = 'release'
            and not exists (
              select 1 from examination_room_v1.result_releases rv
              where rv.supersedes_release_id = rr.id and rv.release_action = 'revoke'
            )
        )
      ) order by sub.received_at) as items
      from examination_room_v1.submissions sub
      join examination_room_v1.student_sessions ss on ss.id = sub.session_id
      join examination_room_v1.exam_roster er on er.id = ss.roster_id
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      left join lateral (
        select grades.grading_manifest
        from examination_room_v1.grade_revisions grades
        where grades.submission_id = sub.id
        order by grades.revision_number desc
        limit 1
      ) gr on true
      where ss.exam_id = e.id
    ) g on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = 'grading_context' then
    select
      sub.id,
      sub.exam_version_id,
      examination_room_v1.grader_safe_submission_manifest(
        sub.submission_manifest,
        e.anonymous_grading,
        er.grading_alias,
        examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
      ) || jsonb_build_object('idempotencyKey', sub.idempotency_key_hash)
    into submission_id, exam_version_id, draft_payload
    from examination_room_v1.student_sessions ss
    join examination_room_v1.submissions sub on sub.session_id = ss.id
    join examination_room_v1.exams e on e.id = ss.exam_id
    join examination_room_v1.exam_roster er on er.id = ss.roster_id
    where (
        (not e.anonymous_grading and ss.id = (p_payload ->> 'sessionId')::uuid)
        or (
          e.anonymous_grading
          and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (p_payload ->> 'sessionId')::uuid
        )
      )
      and ss.exam_id = exam_id
      and ss.institution_id = p_institution_id;

    if submission_id is null then
      return examination_room_v1.api_error(
        'SUBMISSION_NOT_FOUND', 'The student has not submitted this examination.', 409,
        'Refresh grading after the student submits.'
      );
    end if;

    select q.position
    into question_count
    from examination_room_v1.questions q
    where q.exam_version_id = exam_version_id
      and (
        q.question_key = p_payload ->> 'questionReference'
        or q.position::text = p_payload ->> 'questionReference'
        or 'q-' || q.position::text = p_payload ->> 'questionReference'
      );

    if question_count is null then
      return examination_room_v1.api_error(
        'QUESTION_NOT_FOUND', 'That question is not part of the submitted examination version.', 409,
        'Refresh grading and choose a listed question.'
      );
    end if;

    select jsonb_build_object(
      'ok', true,
      'publicationManifest', v.publication_manifest,
      'submissionManifest', draft_payload,
      'questionNumber', question_count,
      'scores', coalesce(gr.scores, '[]'::jsonb),
      'nextRevision', coalesce(gr.revision_number, 0) + 1,
      'overallFeedback', coalesce(gr.general_feedback, '')
    )
    into response
    from examination_room_v1.exam_versions v
    left join lateral (
      select
        grades.revision_number,
        grades.general_feedback,
        (
          select jsonb_agg(jsonb_build_object(
            'questionNumber', q.position,
            'pointsAwarded', item.score,
            'feedback', coalesce(item.feedback, '')
          ) order by q.position)
          from examination_room_v1.grade_revision_items item
          join examination_room_v1.questions q on q.id = item.question_id
          where item.grade_revision_id = grades.id
        ) as scores
      from examination_room_v1.grade_revisions grades
      where grades.submission_id = submission_id
      order by grades.revision_number desc
      limit 1
    ) gr on true
    where v.id = exam_version_id;
    return response;
  end if;

  if p_operation = 'release_context' then
    if jsonb_typeof(p_payload -> 'sessionIds') <> 'array'
       or jsonb_array_length(p_payload -> 'sessionIds') = 0 then
      return examination_room_v1.api_error(
        'RESULT_RECIPIENT_REQUIRED', 'Select at least one submitted student.', 400,
        'Select the intended students, then release again.'
      );
    end if;

    select jsonb_build_object('ok', true, 'entries', coalesce(jsonb_agg(entry.item order by entry.session_id), '[]'::jsonb))
    into response
    from (
      select
        case
          when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          else ss.id
        end as session_id,
        jsonb_build_object(
          'sessionId', case
            when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
            else ss.id
          end,
          'nextRevision', coalesce(gr.revision_number, 0) + 1,
          'submissionManifest', examination_room_v1.grader_safe_submission_manifest(
            sub.submission_manifest,
            e.anonymous_grading,
            er.grading_alias,
            examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          ) || jsonb_build_object('idempotencyKey', sub.idempotency_key_hash),
          'scores', coalesce(gr.scores, '[]'::jsonb),
          'overallFeedback', coalesce(gr.general_feedback, '')
        ) as item
      from jsonb_array_elements_text(p_payload -> 'sessionIds') requested(session_id)
      join examination_room_v1.student_sessions ss on true
      join examination_room_v1.submissions sub on sub.session_id = ss.id and sub.submission_status = 'accepted'
      join examination_room_v1.exams e on e.id = ss.exam_id
      join examination_room_v1.exam_roster er on er.id = ss.roster_id
      left join lateral (
        select
          grades.revision_number,
          grades.general_feedback,
          (
            select jsonb_agg(jsonb_build_object(
              'questionNumber', q.position,
              'pointsAwarded', item.score,
              'feedback', coalesce(item.feedback, '')
            ) order by q.position)
            from examination_room_v1.grade_revision_items item
            join examination_room_v1.questions q on q.id = item.question_id
            where item.grade_revision_id = grades.id
          ) as scores
        from examination_room_v1.grade_revisions grades
        where grades.submission_id = sub.id
        order by grades.revision_number desc
        limit 1
      ) gr on true
      where ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and (
          (not e.anonymous_grading and ss.id = requested.session_id::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = requested.session_id::uuid
          )
        )
    ) entry;

    if jsonb_array_length(response -> 'entries') <> jsonb_array_length(p_payload -> 'sessionIds') then
      return examination_room_v1.api_error(
        'GRADING_CONTEXT_INVALID', 'One or more selected students does not have an accepted submission.', 409,
        'Refresh grading, review the selected students, then release again.'
      );
    end if;
    return response;
  end if;

  if p_operation in ('save_draft', 'publish') then
    request_hash := p_payload ->> 'requestHash';
    requested_at := coalesce((p_payload ->> 'requestedAt')::timestamptz, clock_timestamp());
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'professor.' || p_operation);
    if replay is not null then
      if p_operation = 'publish' and replay ->> 'ok' = 'true' then
        select v.publication_manifest
        into publication_bundle
        from examination_room_v1.exam_versions v
        where v.id = (replay ->> 'versionId')::uuid
          and v.exam_id = (replay ->> 'examId')::uuid
          and v.institution_id = p_institution_id
          and v.publication_status = 'published';
        replay := replay || jsonb_build_object('publicationManifest', publication_bundle);
      end if;
      return replay;
    end if;

    exam_payload := p_payload -> 'exam';
    draft_payload := p_payload -> 'draft';
    if jsonb_typeof(exam_payload) <> 'object' or jsonb_typeof(draft_payload) <> 'object' then
      return examination_room_v1.api_error(
        'EXAM_PAYLOAD_INVALID', 'The normalized examination draft is missing.', 400,
        'Refresh the creator and save the examination again.'
      );
    end if;

    exam_id := nullif(exam_payload ->> 'examId', '')::uuid;
    if exam_id is null then
      exam_id := gen_random_uuid();
    end if;

    select e.owner_user_id
    into exam_owner_id
    from examination_room_v1.exams e
    where e.id = exam_id
      and e.institution_id = p_institution_id
    for update;

    if exam_owner_id is not null and not actor_is_admin and exam_owner_id <> p_actor_user_id then
      return examination_room_v1.api_error(
        'FORBIDDEN', 'Only the examination owner or an administrator may change this examination.', 403,
        'Choose an examination assigned to your account.'
      );
    end if;

    select n.id
    into notice_id
    from examination_room_v1.privacy_notice_versions n
    where n.institution_id = p_institution_id
      and n.notice_code = lower(exam_payload ->> 'privacyNoticeVersion')
      and n.effective_at <= requested_at
    order by n.version_number desc
    limit 1;

    if notice_id is null then
      return examination_room_v1.api_error(
        'PRIVACY_NOTICE_NOT_CONFIGURED',
        'The selected privacy notice has not been approved for this institution.',
        409,
        'Ask the administrator to publish the exact privacy notice version, then save or publish again.'
      );
    end if;

    if p_operation = 'publish'
       and jsonb_array_length(coalesce(exam_payload -> 'questions', '[]'::jsonb)) = 0 then
      return examination_room_v1.api_error(
        'PUBLICATION_NOT_READY', 'Publishing requires at least one question.', 409,
        'Add at least one complete question, then publish again.'
      );
    end if;
    if p_operation = 'publish'
       and coalesce(exam_payload ->> 'admissionMode', 'key_only') = 'email_allowlist'
       and cardinality(examination_room_v1.normalized_allowed_emails(exam_payload -> 'allowedEmails')) = 0 then
      return examination_room_v1.api_error(
        'ALLOWED_EMAIL_REQUIRED', 'Add at least one email or use key-only admission.', 409,
        'Add one email per line, or choose Anyone with the key, then publish again.'
      );
    end if;

    use_anonymous_grading := coalesce(exam_payload ->> 'identityMode', 'real_names') = 'anonymous_grading';
    controls_payload := jsonb_build_object(
      'subject', coalesce(exam_payload ->> 'subject', ''),
      'yearLevel', coalesce(exam_payload ->> 'yearLevel', ''),
      'jurisdiction', coalesce(exam_payload ->> 'jurisdiction', 'Philippines'),
      'startsAt', exam_payload -> 'startsAt',
      'lateSubmissions', coalesce(exam_payload ->> 'lateSubmissions', 'not_allowed'),
      'navigation', coalesce(exam_payload ->> 'navigation', 'free'),
      'identityMode', coalesce(exam_payload ->> 'identityMode', 'real_names'),
      'integrityTier', coalesce(exam_payload ->> 'integrityTier', 'standard'),
      'cameraRequired', coalesce((exam_payload ->> 'cameraRequired')::boolean, false),
      'microphoneRequired', coalesce((exam_payload ->> 'microphoneRequired')::boolean, false),
      'privacyNoticeVersion', lower(exam_payload ->> 'privacyNoticeVersion'),
      'privacyController', coalesce(exam_payload ->> 'privacyController', ''),
      'retentionSummary', coalesce(exam_payload ->> 'retentionSummary', ''),
      'sourceFileName', exam_payload -> 'sourceFileName',
      'sourceFileSize', exam_payload -> 'sourceFileSize',
      'admissionMode', coalesce(exam_payload ->> 'admissionMode', 'key_only')
    );

    if exam_owner_id is null then
      insert into examination_room_v1.exams (
        id, institution_id, owner_user_id, title, description, status, anonymous_grading,
        admission_mode, allowed_emails
      ) values (
        exam_id,
        p_institution_id,
        p_actor_user_id,
        exam_payload ->> 'title',
        nullif(exam_payload ->> 'instructions', ''),
        'draft',
        use_anonymous_grading,
        coalesce(exam_payload ->> 'admissionMode', 'key_only'),
        examination_room_v1.normalized_allowed_emails(exam_payload -> 'allowedEmails')
      );
    else
      update examination_room_v1.exams e
      set title = exam_payload ->> 'title',
          description = nullif(exam_payload ->> 'instructions', ''),
          admission_mode = coalesce(exam_payload ->> 'admissionMode', 'key_only'),
          allowed_emails = examination_room_v1.normalized_allowed_emails(exam_payload -> 'allowedEmails')
      where e.id = exam_id;
    end if;

    select v.id, v.version_number
    into version_id, version_number
    from examination_room_v1.exam_versions v
    where v.exam_id = exam_id
      and v.publication_status = 'building'
    order by v.version_number desc
    limit 1
    for update;

    if version_id is null then
      select coalesce(max(v.version_number), 0) + 1
      into version_number
      from examination_room_v1.exam_versions v
      where v.exam_id = exam_id;
      version_id := gen_random_uuid();
      insert into examination_room_v1.exam_versions (
        id, exam_id, institution_id, version_number, title_snapshot, instructions,
        duration_seconds, anonymous_grading_snapshot, privacy_notice_version_id,
        controls, content_sha256, admission_mode_snapshot, allowed_emails_snapshot
      ) values (
        version_id,
        exam_id,
        p_institution_id,
        version_number,
        exam_payload ->> 'title',
        coalesce(exam_payload ->> 'instructions', ''),
        greatest(60, least(86400, coalesce((exam_payload ->> 'durationMinutes')::integer, 120) * 60)),
        use_anonymous_grading,
        notice_id,
        controls_payload,
        examination_room_v1.jsonb_sha256(draft_payload),
        coalesce(exam_payload ->> 'admissionMode', 'key_only'),
        examination_room_v1.normalized_allowed_emails(exam_payload -> 'allowedEmails')
      );
    else
      update examination_room_v1.exam_versions v
      set title_snapshot = exam_payload ->> 'title',
          instructions = coalesce(exam_payload ->> 'instructions', ''),
          duration_seconds = greatest(60, least(86400, coalesce((exam_payload ->> 'durationMinutes')::integer, 120) * 60)),
          anonymous_grading_snapshot = use_anonymous_grading,
          privacy_notice_version_id = notice_id,
          controls = controls_payload,
          content_sha256 = examination_room_v1.jsonb_sha256(draft_payload),
          admission_mode_snapshot = coalesce(exam_payload ->> 'admissionMode', 'key_only'),
          allowed_emails_snapshot = examination_room_v1.normalized_allowed_emails(exam_payload -> 'allowedEmails')
      where v.id = version_id;
      delete from examination_room_v1.questions q where q.exam_version_id = version_id;
    end if;

    insert into examination_room_v1.questions (
      exam_version_id, position, question_key, question_kind, prompt, points, configuration, content_sha256
    )
    select
      version_id,
      coalesce((item.value ->> 'questionNumber')::integer, item.ordinality::integer),
      item.value ->> 'questionKey',
      item.value ->> 'questionKind',
      item.value ->> 'prompt',
      coalesce((item.value ->> 'points')::numeric, 0),
      jsonb_build_object(
        'type', coalesce(item.value ->> 'type', replace(item.value ->> 'questionKind', '_', '-')),
        'gradingGuidance', coalesce(item.value ->> 'gradingGuidance', ''),
        'wordLimit', item.value -> 'wordLimit',
        'choices', coalesce(item.value -> 'choices', '[]'::jsonb),
        'correctOptionIndex', item.value -> 'correctOptionIndex',
        'acceptedAnswers', coalesce(item.value -> 'acceptedAnswers', '[]'::jsonb)
      ),
      examination_room_v1.jsonb_sha256(item.value)
    from jsonb_array_elements(coalesce(exam_payload -> 'questions', '[]'::jsonb)) with ordinality item(value, ordinality);

    update examination_room_v1.exam_roster er
    set roster_status = 'withdrawn'
    from examination_room_v1.student_identities si
    where er.exam_id = exam_id
      and er.student_identity_id = si.id
      and er.roster_status in ('invited', 'eligible')
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(exam_payload -> 'roster', '[]'::jsonb)) incoming(value)
        where upper(incoming.value ->> 'studentNumber') = si.external_student_id
      );

    for roster_item in
      select value from jsonb_array_elements(coalesce(exam_payload -> 'roster', '[]'::jsonb))
    loop
      insert into examination_room_v1.student_identities (
        institution_id, external_student_id, full_name, email_normalized,
        identity_status, verified_at, verification_method
      ) values (
        p_institution_id,
        upper(roster_item ->> 'studentNumber'),
        roster_item ->> 'fullName',
        lower(roster_item ->> 'email'),
        'active',
        requested_at,
        'registrar_import'
      )
      on conflict (institution_id, external_student_id) do update
      set full_name = excluded.full_name,
          email_normalized = excluded.email_normalized,
          identity_status = 'active',
          verified_at = excluded.verified_at,
          verification_method = excluded.verification_method
      returning id into student_identity_id;

      roster_row_id := gen_random_uuid();
      insert into examination_room_v1.exam_roster (
        id, exam_id, institution_id, student_identity_id, grading_alias,
        roster_status, accommodations, added_by_user_id
      ) values (
        roster_row_id,
        exam_id,
        p_institution_id,
        student_identity_id,
        case when use_anonymous_grading then 'CAND-' || upper(substr(replace(roster_row_id::text, '-', ''), 1, 8)) else null end,
        'eligible',
        jsonb_build_object(
          'clientId', roster_item -> 'clientId',
          'subject', roster_item ->> 'subject',
          'yearLevel', roster_item ->> 'yearLevel',
          'extraMinutes', coalesce((roster_item ->> 'extraMinutes')::integer, 0)
        ),
        p_actor_user_id
      )
      on conflict on constraint exam_roster_exam_student_key do update
      set roster_status = 'eligible',
          grading_alias = coalesce(examination_room_v1.exam_roster.grading_alias, excluded.grading_alias),
          accommodations = excluded.accommodations;
    end loop;

    select count(*) into question_count
    from examination_room_v1.questions q where q.exam_version_id = version_id;
    select count(*) into roster_count
    from examination_room_v1.exam_roster er
    where er.exam_id = exam_id and er.roster_status in ('invited', 'eligible');

    if p_operation = 'publish' then
      if question_count = 0 then
        return examination_room_v1.api_error(
          'PUBLICATION_NOT_READY', 'Publishing requires at least one question.', 409,
          'Add at least one complete question, then publish again.'
        );
      end if;

      publication_bundle := examination_room_v1.build_publication_manifest(version_id, requested_at);
      publication_hash := examination_room_v1.jsonb_sha256(publication_bundle);
      update examination_room_v1.exam_versions v
      set publication_manifest = publication_bundle,
          content_sha256 = publication_hash,
          publication_status = 'published',
          published_by_user_id = p_actor_user_id,
          published_at = requested_at
      where v.id = version_id;

      update examination_room_v1.exams e
      set status = 'published',
          anonymous_grading = use_anonymous_grading,
          current_published_version_id = version_id,
          closed_at = null
      where e.id = exam_id;

      insert into examination_room_v1.recovery_snapshots (
        exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
        record_count, snapshot_status, created_by_user_id, retention_until
      ) values (
        exam_id,
        version_id,
        examination_room_v1.next_snapshot_sequence(exam_id),
        'exam_definition',
        request_hash,
        question_count + roster_count,
        'pending',
        p_actor_user_id,
        requested_at + interval '365 days'
      );

      response := jsonb_build_object(
        'ok', true,
        'examId', exam_id,
        'versionId', version_id,
        'version', version_number,
        'status', 'published',
        'publicationHash', publication_hash,
        'publicationManifest', publication_bundle
      );
    else
      response := jsonb_build_object(
        'ok', true,
        'examId', exam_id,
        'versionId', version_id,
        'version', version_number,
        'status', 'draft',
        'questionCount', question_count,
        'rosterCount', roster_count
      );
    end if;

    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'professor',
      'professor.' || p_operation, 'exam', exam_id, request_hash,
      requested_at, response, null
    );
    return response;
  end if;

  if p_operation in ('open_room', 'close_room') then
    request_hash := p_payload ->> 'requestHash';
    event_time := coalesce(
      (p_payload ->> case when p_operation = 'open_room' then 'openedAt' else 'closedAt' end)::timestamptz,
      clock_timestamp()
    );
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'professor.' || p_operation);
    if replay is not null then return replay; end if;

    if p_operation = 'open_room' then
      select a.id, a.activation_status
      into version_id, room_activation_status
      from examination_room_v1.room_activations a
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in ('scheduled', 'open')
        and a.closes_at > event_time
      order by (a.activation_status = 'scheduled') desc, a.created_at desc, a.id desc
      limit 1
      for update;

      if version_id is null then
        return examination_room_v1.api_error(
          'ROOM_ACTIVATION_NOT_FOUND', 'The administrator has not approved and generated a student key yet.', 409,
          'Request a key, then wait for the administrator to approve this examination.'
        );
      end if;

      if room_activation_status = 'scheduled' then
        update examination_room_v1.room_activations a
        set activation_status = 'open',
            opens_at = least(a.opens_at, event_time, clock_timestamp()),
            deactivated_at = null,
            deactivated_by_user_id = null,
            deactivation_reason = null
        where a.id = version_id;
      end if;
      response := jsonb_build_object(
        'ok', true,
        'examId', exam_id,
        'activationId', version_id,
        'activation', jsonb_build_object('id', version_id, 'status', 'open'),
        'status', 'open'
      );
    else
      update examination_room_v1.room_activations a
      set activation_status = 'closed',
          deactivated_at = event_time,
          deactivated_by_user_id = p_actor_user_id,
          deactivation_reason = 'Professor closed the examination room.'
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in ('scheduled', 'open');

      update examination_room_v1.student_sessions s
      set session_status = 'expired', ended_at = coalesce(s.ended_at, event_time)
      where s.exam_id = exam_id
        and s.institution_id = p_institution_id
        and s.session_status in ('created', 'active');

      update examination_room_v1.exams e
      set status = 'closed', closed_at = event_time
      where e.id = exam_id and e.status in ('published', 'closed');
      response := jsonb_build_object('ok', true, 'examId', exam_id, 'status', 'closed');
    end if;

    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'professor',
      'professor.' || p_operation, 'exam', exam_id, request_hash, event_time, response, null
    );
    return response;
  end if;

  if p_operation = 'save_grade' then
    request_hash := p_payload ->> 'requestHash';
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'professor.save_grade');
    if replay is not null then return replay; end if;
    grading_manifest := p_payload -> 'gradingManifest';

    select sub.id, sub.exam_version_id, sub.submission_manifest ->> 'publicationHash', ss.id
    into submission_id, exam_version_id, publication_hash, student_session_id
    from examination_room_v1.student_sessions ss
    join examination_room_v1.submissions sub on sub.session_id = ss.id
    join examination_room_v1.exams e on e.id = ss.exam_id
    where (
        (not e.anonymous_grading and ss.id = (p_payload ->> 'sessionId')::uuid)
        or (
          e.anonymous_grading
          and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (p_payload ->> 'sessionId')::uuid
        )
      )
      and ss.exam_id = exam_id
      and ss.institution_id = p_institution_id
      and sub.submission_status = 'accepted'
    for update of sub;

    if submission_id is null then
      return examination_room_v1.api_error(
        'SUBMISSION_NOT_FOUND', 'The student has no accepted submission to grade.', 409,
        'Refresh grading after the student submits.'
      );
    end if;

    if jsonb_typeof(grading_manifest) is distinct from 'object'
       or coalesce(grading_manifest ->> 'schemaVersion', '') <> 'examination-room/grading/v1'
       or grading_manifest ->> 'submissionId' is null
       or (grading_manifest ->> 'submissionId')::uuid <> submission_id
       or grading_manifest ->> 'publicationHash' <> publication_hash
       or grading_manifest ->> 'graderId' is null
       or (grading_manifest ->> 'graderId')::uuid <> p_actor_user_id
       or coalesce(grading_manifest ->> 'status', '') <> 'draft' then
      return examination_room_v1.api_error(
        'GRADING_MANIFEST_INVALID', 'The grading evidence is not bound to this submission and signed-in professor.', 409,
        'Refresh grading, review the scores, then save again.'
      );
    end if;

    grade_revision_number := (grading_manifest ->> 'revision')::integer;
    if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
      return examination_room_v1.api_error(
        'GRADE_REVISION_CONFLICT', 'A newer grading revision already exists.', 409,
        'Refresh the grading view, review the latest scores, then save again.'
      );
    end if;

    score_count := jsonb_array_length(coalesce(grading_manifest -> 'scores', '[]'::jsonb));
    total_score := coalesce((grading_manifest ->> 'totalPointsAwarded')::numeric, 0);
    maximum_score := coalesce((grading_manifest ->> 'maxPoints')::numeric, 0);
    select
      count(*)::integer,
      count(distinct q.id)::integer,
      coalesce(sum((score.value ->> 'pointsAwarded')::numeric), 0),
      coalesce(sum(q.points), 0)
    into question_count, distinct_score_count, total_score, maximum_score
    from jsonb_array_elements(coalesce(grading_manifest -> 'scores', '[]'::jsonb)) score(value)
    join examination_room_v1.questions q
      on q.exam_version_id = exam_version_id
     and q.position = (score.value ->> 'questionNumber')::integer
     and q.question_key = score.value ->> 'questionKey'
     and q.points = (score.value ->> 'maxPoints')::numeric
    where (score.value ->> 'pointsAwarded')::numeric between 0 and q.points;

    if question_count <> score_count
       or distinct_score_count <> score_count
       or coalesce((grading_manifest ->> 'scoreCount')::integer, -1) <> score_count
       or total_score <> coalesce((grading_manifest ->> 'totalPointsAwarded')::numeric, 0)
       or maximum_score <> coalesce((grading_manifest ->> 'maxPoints')::numeric, 0) then
      return examination_room_v1.api_error(
        'GRADING_MANIFEST_INVALID', 'The grading manifest does not match this examination version.', 409,
        'Refresh grading, review the scores, then save again.'
      );
    end if;
    grade_revision_id := (grading_manifest ->> 'revisionId')::uuid;
    insert into examination_room_v1.grade_revisions (
      id, submission_id, exam_version_id, revision_number, client_revision_id,
      manifest_sha256, grading_manifest, grader_user_id, source, grade_status,
      item_count, total_score, maximum_score, general_feedback
    ) values (
      grade_revision_id,
      submission_id,
      exam_version_id,
      grade_revision_number,
      (p_payload ->> 'clientRevisionId')::uuid,
      p_payload ->> 'gradingHash',
      grading_manifest,
      p_actor_user_id,
      'online',
      grading_manifest ->> 'status',
      score_count,
      total_score,
      maximum_score,
      grading_manifest ->> 'overallFeedback'
    );

    for score_item in select value from jsonb_array_elements(coalesce(grading_manifest -> 'scores', '[]'::jsonb))
    loop
      select q.id into question_id
      from examination_room_v1.questions q
      where q.exam_version_id = exam_version_id
        and q.position = (score_item ->> 'questionNumber')::integer
        and q.question_key = score_item ->> 'questionKey';
      insert into examination_room_v1.grade_revision_items (
        grade_revision_id, exam_version_id, question_id, score, maximum_score, feedback
      ) values (
        grade_revision_id,
        exam_version_id,
        question_id,
        (score_item ->> 'pointsAwarded')::numeric,
        (score_item ->> 'maxPoints')::numeric,
        score_item ->> 'feedback'
      );
    end loop;

    response := jsonb_build_object(
      'ok', true,
      'revision', jsonb_build_object(
        'id', grade_revision_id,
        'revision', grade_revision_number,
        'status', grading_manifest ->> 'status',
        'totalPointsAwarded', total_score,
        'maxPoints', maximum_score
      )
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, student_session_id, p_actor_user_id, 'professor',
      'professor.save_grade', 'grade_revision', grade_revision_id, request_hash,
      clock_timestamp(), response, (p_payload ->> 'clientRevisionId')::uuid
    );
    return response;
  end if;

  if p_operation = 'release_results' then
    request_hash := p_payload ->> 'requestHash';
    perform set_config('examination_room_v1.release_batch_request_hash', request_hash, true);
    perform set_config(
      'examination_room_v1.release_batch_count',
      coalesce(jsonb_array_length(p_payload -> 'releases'), 0)::text,
      true
    );
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'professor.release_results');
    if replay is not null then return replay; end if;

    if jsonb_typeof(p_payload -> 'releases') <> 'array'
       or jsonb_typeof(p_payload -> 'sessionIds') <> 'array'
       or jsonb_array_length(p_payload -> 'releases') = 0
       or jsonb_array_length(p_payload -> 'releases') <> jsonb_array_length(p_payload -> 'sessionIds')
       or (
         select count(distinct item.value ->> 'sessionId')
         from jsonb_array_elements(p_payload -> 'releases') item(value)
       ) <> jsonb_array_length(p_payload -> 'releases')
       or exists (
         select 1
         from jsonb_array_elements(p_payload -> 'releases') item(value)
         where not exists (
           select 1
           from jsonb_array_elements_text(p_payload -> 'sessionIds') selected(value)
           where selected.value = item.value ->> 'sessionId'
         )
       ) then
      return examination_room_v1.api_error(
        'GRADING_CONTEXT_INVALID', 'The release set does not match the selected students.', 409,
        'Refresh grading, review the recipient list, then release again.'
      );
    end if;

    -- Validate and lock the complete batch before the first append-only write.
    for release_item in select value from jsonb_array_elements(p_payload -> 'releases')
    loop
      grading_manifest := release_item -> 'gradingManifest';
      release_manifest := release_item -> 'releaseManifest';
      select sub.id, sub.exam_version_id, sub.submission_manifest ->> 'publicationHash'
      into submission_id, exam_version_id, publication_hash
      from examination_room_v1.student_sessions ss
      join examination_room_v1.submissions sub on sub.session_id = ss.id
      join examination_room_v1.exams e on e.id = ss.exam_id
      where (
          (not e.anonymous_grading and ss.id = (release_item ->> 'sessionId')::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (release_item ->> 'sessionId')::uuid
          )
        )
        and ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and sub.submission_status = 'accepted'
      for update of sub;

      if submission_id is null
         or coalesce(grading_manifest ->> 'schemaVersion', '') <> 'examination-room/grading/v1'
         or coalesce(grading_manifest ->> 'status', '') <> 'final'
         or grading_manifest ->> 'submissionId' is null
         or (grading_manifest ->> 'submissionId')::uuid <> submission_id
         or grading_manifest ->> 'graderId' is null
         or (grading_manifest ->> 'graderId')::uuid <> p_actor_user_id
         or grading_manifest ->> 'publicationHash' <> publication_hash
         or coalesce(release_manifest ->> 'schemaVersion', '') <> 'examination-room/result-release/v1'
         or release_manifest ->> 'submissionId' is null
         or (release_manifest ->> 'submissionId')::uuid <> submission_id
         or release_manifest ->> 'publicationHash' <> publication_hash
         or release_manifest ->> 'selectedRevisionId' is null
         or (release_manifest ->> 'selectedRevisionId')::uuid <> (grading_manifest ->> 'revisionId')::uuid
         or coalesce((release_manifest ->> 'selectedRevision')::integer, -1) <> (grading_manifest ->> 'revision')::integer
         or release_manifest ->> 'releasedBy' is null
         or (release_manifest ->> 'releasedBy')::uuid <> p_actor_user_id
         or (release_manifest ->> 'releasedAt')::timestamptz < (grading_manifest ->> 'gradedAt')::timestamptz then
        return examination_room_v1.api_error(
          'GRADING_CONTEXT_INVALID', 'A selected student has invalid release or grading evidence.', 409,
          'Refresh grading and review the recipient list.'
        );
      end if;

      grade_revision_number := (grading_manifest ->> 'revision')::integer;
      if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
        return examination_room_v1.api_error(
          'GRADE_REVISION_CONFLICT', 'A selected submission changed after release preparation.', 409,
          'Refresh grading, review the latest scores, then release again.'
        );
      end if;

      score_count := jsonb_array_length(coalesce(grading_manifest -> 'scores', '[]'::jsonb));
      select
        count(*)::integer,
        count(distinct q.id)::integer,
        coalesce(sum((score.value ->> 'pointsAwarded')::numeric), 0),
        coalesce(sum(q.points), 0)
      into question_count, distinct_score_count, total_score, maximum_score
      from jsonb_array_elements(coalesce(grading_manifest -> 'scores', '[]'::jsonb)) score(value)
      join examination_room_v1.questions q
        on q.exam_version_id = exam_version_id
       and q.position = (score.value ->> 'questionNumber')::integer
       and q.question_key = score.value ->> 'questionKey'
       and q.points = (score.value ->> 'maxPoints')::numeric
      where (score.value ->> 'pointsAwarded')::numeric between 0 and q.points;

      if question_count <> score_count
         or distinct_score_count <> score_count
         or question_count <> (select count(*) from examination_room_v1.questions q where q.exam_version_id = exam_version_id)
         or coalesce((grading_manifest ->> 'scoreCount')::integer, -1) <> score_count
         or total_score <> (grading_manifest ->> 'totalPointsAwarded')::numeric
         or maximum_score <> (grading_manifest ->> 'maxPoints')::numeric then
        return examination_room_v1.api_error(
          'GRADING_INCOMPLETE', 'Every question must have a valid final score before release.', 409,
          'Score every question, review the totals, then release again.'
        );
      end if;

      expected_result := jsonb_build_object(
        'gradedAt', grading_manifest -> 'gradedAt',
        'scores', grading_manifest -> 'scores',
        'totalPointsAwarded', grading_manifest -> 'totalPointsAwarded',
        'maxPoints', grading_manifest -> 'maxPoints',
        'overallFeedback', grading_manifest -> 'overallFeedback'
      );
      if release_manifest -> 'result' is distinct from expected_result then
        return examination_room_v1.api_error(
          'RESULT_RELEASE_MISMATCH', 'The student-facing result does not exactly match the final grade revision.', 409,
          'Refresh grading, review the final scores, then release again.'
        );
      end if;
    end loop;

    score_count := 0;

    for release_item in select value from jsonb_array_elements(coalesce(p_payload -> 'releases', '[]'::jsonb))
    loop
      grading_manifest := release_item -> 'gradingManifest';
      select sub.id, sub.exam_version_id, sub.submission_manifest ->> 'publicationHash'
      into submission_id, exam_version_id, publication_hash
      from examination_room_v1.student_sessions ss
      join examination_room_v1.submissions sub on sub.session_id = ss.id
      join examination_room_v1.exams e on e.id = ss.exam_id
      where (
          (not e.anonymous_grading and ss.id = (release_item ->> 'sessionId')::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (release_item ->> 'sessionId')::uuid
          )
        )
        and ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and sub.submission_status = 'accepted'
      for update of sub;

      if submission_id is null then
        return examination_room_v1.api_error(
          'GRADING_CONTEXT_INVALID', 'A selected student has no accepted submission.', 409,
          'Refresh grading and review the recipient list.'
        );
      end if;

      grade_revision_number := (grading_manifest ->> 'revision')::integer;
      if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
        return examination_room_v1.api_error(
          'GRADE_REVISION_CONFLICT', 'A selected submission changed after release preparation.', 409,
          'Refresh grading, review the latest scores, then release again.'
        );
      end if;

      grade_revision_id := (grading_manifest ->> 'revisionId')::uuid;
      insert into examination_room_v1.grade_revisions (
        id, submission_id, exam_version_id, revision_number, client_revision_id,
        manifest_sha256, grading_manifest, grader_user_id, source, grade_status,
        item_count, total_score, maximum_score, general_feedback
      ) values (
        grade_revision_id,
        submission_id,
        exam_version_id,
        grade_revision_number,
        examination_room_v1.uuid_from_hash(release_item ->> 'releaseRequestHash'),
        release_item ->> 'gradingHash',
        grading_manifest,
        p_actor_user_id,
        'online',
        'final',
        jsonb_array_length(coalesce(grading_manifest -> 'scores', '[]'::jsonb)),
        (grading_manifest ->> 'totalPointsAwarded')::numeric,
        (grading_manifest ->> 'maxPoints')::numeric,
        grading_manifest ->> 'overallFeedback'
      );

      for score_item in select value from jsonb_array_elements(coalesce(grading_manifest -> 'scores', '[]'::jsonb))
      loop
        select q.id into question_id
        from examination_room_v1.questions q
        where q.exam_version_id = exam_version_id
          and q.position = (score_item ->> 'questionNumber')::integer
          and q.question_key = score_item ->> 'questionKey';
        insert into examination_room_v1.grade_revision_items (
          grade_revision_id, exam_version_id, question_id, score, maximum_score, feedback
        ) values (
          grade_revision_id,
          exam_version_id,
          question_id,
          (score_item ->> 'pointsAwarded')::numeric,
          (score_item ->> 'maxPoints')::numeric,
          score_item ->> 'feedback'
        );
      end loop;

      insert into examination_room_v1.result_releases (
        id, submission_id, grade_revision_id, release_action, channel,
        idempotency_key_hash, batch_request_hash, manifest_sha256, release_manifest,
        performed_by_user_id, occurred_at
      ) values (
        ((release_item -> 'releaseManifest') ->> 'releaseId')::uuid,
        submission_id,
        grade_revision_id,
        'release',
        'student_portal',
        release_item ->> 'releaseRequestHash',
        request_hash,
        release_item ->> 'releaseHash',
        release_item -> 'releaseManifest',
        p_actor_user_id,
        (((release_item -> 'releaseManifest') ->> 'releasedAt'))::timestamptz
      );
      score_count := score_count + 1;
    end loop;

    if score_count <> jsonb_array_length(coalesce(p_payload -> 'sessionIds', '[]'::jsonb)) then
      return examination_room_v1.api_error(
        'GRADING_CONTEXT_INVALID', 'The release set does not match the selected students.', 409,
        'Refresh grading, review the recipient list, then release again.'
      );
    end if;

    response := jsonb_build_object('ok', true, 'released', score_count);
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'professor',
      'professor.release_results', 'exam', exam_id, request_hash,
      clock_timestamp(), response, null
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'The professor operation is not implemented.', 400,
    'Refresh Examination Room and try a listed action.'
  );
end;
$function$


ALTER FUNCTION "examination_room_v1"."api_professor"(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."api_professor"(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."api_professor"(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.api_professor_view(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_exam_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_variable
declare
  target_exam examination_room_v1.exams%rowtype;
  response jsonb;
begin
  select exam.* into target_exam
  from examination_room_v1.exams exam
  where exam.id = p_exam_id
    and exam.institution_id = p_institution_id;

  if target_exam.id is null then
    return examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'The examination does not exist in this workspace.', 404,
      'Return to the Examination Room list and choose an available examination.'
    );
  end if;
  if target_exam.owner_user_id <> p_actor_user_id
     and not examination_room_v1.owner_authorized(p_actor_user_id) then
    return examination_room_v1.api_error(
      'FORBIDDEN', 'Only the examination creator or a platform owner may open this examination.', 403,
      'Choose an examination created by your signed-in account.'
    );
  end if;

  if p_operation = 'monitor' then
    select jsonb_build_object(
      'ok', true,
      'exam', jsonb_build_object(
        'id', exam.id,
        'examId', exam.id,
        'title', exam.title,
        'description', exam.description,
        'status', exam.status,
        'anonymousGrading', exam.anonymous_grading,
        'currentPublishedVersionId', exam.current_published_version_id
      ),
      'activation', (
        select jsonb_build_object(
          'id', activation.id,
          'status', activation.activation_status,
          'opensAt', activation.opens_at,
          'closesAt', activation.closes_at,
          'expiresAt', activation.closes_at,
          'maxSessions', activation.max_sessions,
          'createdAt', activation.created_at
        )
        from examination_room_v1.room_activations activation
        where activation.exam_id = exam.id
        order by activation.created_at desc, activation.id desc
        limit 1
      ),
      'sessions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', session.id,
          'sessionId', session.id,
          'examId', session.exam_id,
          'fullName', identity.full_name,
          'studentNumber', identity.external_student_id,
          'yearLevel', roster.accommodations ->> 'yearLevel',
          'subject', roster.accommodations ->> 'subject',
          'status', session.session_status,
          'connected', coalesce((session.session_metadata ->> 'connected')::boolean, false),
          'currentQuestion', session.session_metadata -> 'currentQuestion',
          'consentVersion', (
            select notice.notice_code
            from examination_room_v1.privacy_acceptances acceptance
            join examination_room_v1.privacy_notice_versions notice
              on notice.id = acceptance.notice_version_id
            where acceptance.session_id = session.id
              and acceptance.decision = 'accepted'
            order by acceptance.recorded_at desc, acceptance.id desc
            limit 1
          ),
          'startedAt', session.started_at,
          'lastSeenAt', coalesce(session.last_heartbeat_at, session.updated_at, session.started_at),
          'endedAt', session.ended_at
        ) order by identity.full_name, session.started_at, session.id)
        from examination_room_v1.student_sessions session
        join examination_room_v1.exam_roster roster on roster.id = session.roster_id
        join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
        where session.exam_id = exam.id
      ), '[]'::jsonb),
      'submissions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', submission.id,
          'submissionId', submission.id,
          'sessionId', submission.session_id,
          'status', submission.submission_status,
          'submissionStatus', submission.submission_status,
          'submittedAt', submission.received_at,
          'receivedAt', submission.received_at,
          'receiptCode', receipt.receipt_code,
          'receiptId', receipt.id,
          'answerCount', submission.answer_count
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        left join examination_room_v1.submission_receipts receipt on receipt.submission_id = submission.id
        where session.exam_id = exam.id
      ), '[]'::jsonb),
      'incidents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', incident.id,
          'sessionId', incident.session_id,
          'type', incident.incident_kind,
          'severity', incident.severity,
          'occurredAt', incident.occurred_at,
          'durationMs', incident.duration_ms,
          'details', incident.details,
          'reviewStatus', incident.review_status
        ) order by incident.occurred_at, incident.id)
        from examination_room_v1.proctoring_incidents incident
        join examination_room_v1.student_sessions session on session.id = incident.session_id
        where session.exam_id = exam.id
      ), '[]'::jsonb),
      'generatedAt', clock_timestamp()
    ) into response
    from examination_room_v1.exams exam
    where exam.id = target_exam.id;
    return response;
  end if;

  if p_operation = 'grading' then
    select jsonb_build_object(
      'ok', true,
      'exam', jsonb_build_object(
        'id', exam.id,
        'examId', exam.id,
        'title', exam.title,
        'description', exam.description,
        'status', exam.status,
        'anonymousGrading', exam.anonymous_grading,
        'currentPublishedVersionId', exam.current_published_version_id
      ),
      'sessions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          'sessionId', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          -- This view is already limited to the exact exam creator or a
          -- Founder/Super Admin. Return both real and grading identities so
          -- the Professor-controlled UI may mask or reveal them at any time.
          'fullName', identity.full_name,
          'studentNumber', identity.external_student_id,
          'realFullName', identity.full_name,
          'realStudentNumber', identity.external_student_id,
          'yearLevel', roster.accommodations ->> 'yearLevel',
          'subject', roster.accommodations ->> 'subject',
          'gradingAlias', roster.grading_alias,
          'identityMode', case when exam.anonymous_grading then 'anonymous_grading' else 'real_names' end,
          'status', session.session_status,
          'submittedAt', submission.received_at
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        join examination_room_v1.exam_roster roster on roster.id = session.roster_id
        join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
        where session.exam_id = exam.id
          and submission.submission_status = 'accepted'
      ), '[]'::jsonb),
      'submissions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', submission.id,
          'submissionId', submission.id,
          'sessionId', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          'status', submission.submission_status,
          'submissionStatus', submission.submission_status,
          'submittedAt', submission.received_at,
          'receivedAt', submission.received_at,
          'receiptCode', receipt.receipt_code,
          'receiptId', receipt.id,
          'answerCount', submission.answer_count
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        left join examination_room_v1.submission_receipts receipt on receipt.submission_id = submission.id
        where session.exam_id = exam.id
          and submission.submission_status = 'accepted'
      ), '[]'::jsonb),
      'answerRevisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', answer.id,
          'sessionId', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          'questionId', question.question_key,
          'questionNumber', question.position,
          'revision', answer.revision_number,
          'answer', answer.answer_payload -> 'answer',
          'flagged', answer.is_flagged,
          'contentHash', answer.answer_sha256,
          'savedAt', answer.saved_at,
          'at', answer.saved_at,
          'source', answer.source
        ) order by submission.received_at, question.position, answer.revision_number, answer.id)
        from examination_room_v1.submission_answers selected_answer
        join examination_room_v1.submissions submission on submission.id = selected_answer.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        join examination_room_v1.answer_revisions answer on answer.id = selected_answer.answer_revision_id
        join examination_room_v1.questions question on question.id = selected_answer.question_id
        where session.exam_id = exam.id
          and submission.submission_status = 'accepted'
      ), '[]'::jsonb),
      'gradeRevisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', grade.id,
          'sessionId', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          'questionId', question.question_key,
          'questionNumber', question.position,
          'points', item.score,
          'feedback', coalesce(item.feedback, ''),
          'revision', grade.revision_number,
          'status', grade.grade_status,
          'source', grade.source,
          'at', grade.created_at,
          'gradedAt', grade.grading_manifest -> 'gradedAt'
        ) order by submission.received_at, grade.revision_number, question.position, grade.id)
        from examination_room_v1.grade_revisions grade
        join examination_room_v1.grade_revision_items item on item.grade_revision_id = grade.id
        join examination_room_v1.questions question on question.id = item.question_id
        join examination_room_v1.submissions submission on submission.id = grade.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = exam.id
          and submission.submission_status = 'accepted'
      ), '[]'::jsonb),
      'releases', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', release.id,
          'sessionIds', jsonb_build_array(case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end),
          'releasedAt', release.occurred_at,
          'at', release.occurred_at,
          'status', 'released',
          'channel', release.channel
        ) order by release.occurred_at, release.id)
        from examination_room_v1.result_releases release
        join examination_room_v1.submissions submission on submission.id = release.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = exam.id
          and release.release_action = 'release'
          and not exists (
            select 1
            from examination_room_v1.result_releases revoked
            where revoked.supersedes_release_id = release.id
              and revoked.release_action = 'revoke'
          )
      ), '[]'::jsonb),
      'generatedAt', clock_timestamp()
    ) into response
    from examination_room_v1.exams exam
    where exam.id = target_exam.id;
    return response;
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'That examination creator view is unavailable.', 400,
    'Refresh Examination Room and choose Monitor or Grade.'
  );
end;
$function$


ALTER FUNCTION "examination_room_v1"."api_professor_view"(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_exam_id uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."api_professor_view"(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_exam_id uuid) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."api_professor_view"(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_exam_id uuid) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.api_record_audit(p_institution_id uuid, p_exam_id uuid, p_session_id uuid, p_actor_user_id uuid, p_actor_role text, p_event_type text, p_subject_type text, p_subject_id uuid, p_request_hash text, p_occurred_at timestamp with time zone, p_response jsonb, p_correlation_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  prior_hash text;
  audit_payload jsonb;
  computed_event_hash text;
  audit_occurred_at timestamptz;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('examination-room-v1:audit:' || p_institution_id::text, 20260826)
  );

  select a.event_hash
  into prior_hash
  from examination_room_v1.audit_events a
  where a.institution_id = p_institution_id
  order by a.recorded_at desc, a.id desc
  limit 1;

  audit_payload := jsonb_build_object(
    'response', coalesce(p_response, jsonb_build_object('ok', true)) - 'publicationManifest'
  );
  audit_occurred_at := coalesce(p_occurred_at, clock_timestamp());
  computed_event_hash := examination_room_v1.jsonb_sha256(jsonb_build_object(
    'institutionId', p_institution_id,
    'examId', p_exam_id,
    'sessionId', p_session_id,
    'actorUserId', p_actor_user_id,
    'actorRole', p_actor_role,
    'eventType', p_event_type,
    'subjectType', p_subject_type,
    'subjectId', p_subject_id,
    'correlationId', coalesce(p_correlation_id, examination_room_v1.uuid_from_hash(p_request_hash)),
    'requestHash', p_request_hash,
    'eventData', audit_payload,
    'previousEventHash', prior_hash,
    'occurredAt', audit_occurred_at
  ));

  insert into examination_room_v1.audit_events (
    institution_id,
    exam_id,
    session_id,
    actor_user_id,
    actor_role,
    event_type,
    subject_type,
    subject_id,
    correlation_id,
    request_hash,
    event_data,
    previous_event_hash,
    event_hash,
    occurred_at
  ) values (
    p_institution_id,
    p_exam_id,
    p_session_id,
    p_actor_user_id,
    p_actor_role,
    p_event_type,
    p_subject_type,
    p_subject_id,
    coalesce(p_correlation_id, examination_room_v1.uuid_from_hash(p_request_hash)),
    p_request_hash,
    audit_payload,
    prior_hash,
    computed_event_hash,
    audit_occurred_at
  );
end;
$function$


ALTER FUNCTION "examination_room_v1"."api_record_audit"(p_institution_id uuid, p_exam_id uuid, p_session_id uuid, p_actor_user_id uuid, p_actor_role text, p_event_type text, p_subject_type text, p_subject_id uuid, p_request_hash text, p_occurred_at timestamp with time zone, p_response jsonb, p_correlation_id uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."api_record_audit"(p_institution_id uuid, p_exam_id uuid, p_session_id uuid, p_actor_user_id uuid, p_actor_role text, p_event_type text, p_subject_type text, p_subject_id uuid, p_request_hash text, p_occurred_at timestamp with time zone, p_response jsonb, p_correlation_id uuid) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."api_record_audit"(p_institution_id uuid, p_exam_id uuid, p_session_id uuid, p_actor_user_id uuid, p_actor_role text, p_event_type text, p_subject_type text, p_subject_id uuid, p_request_hash text, p_occurred_at timestamp with time zone, p_response jsonb, p_correlation_id uuid) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.api_replay(p_institution_id uuid, p_request_hash text, p_event_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  stored_event_type text;
  stored_response jsonb;
begin
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    return examination_room_v1.api_error(
      'REQUEST_HASH_INVALID',
      'The command fingerprint is missing or invalid.',
      400,
      'Refresh the page so a new secure request can be created.'
    );
  end if;

  select a.event_type, a.event_data -> 'response'
  into stored_event_type, stored_response
  from examination_room_v1.audit_events a
  where a.institution_id = p_institution_id
    and a.request_hash = p_request_hash;

  if stored_event_type is null then
    return null;
  end if;

  if stored_event_type <> p_event_type then
    return examination_room_v1.api_error(
      'IDEMPOTENCY_KEY_REUSED',
      'That request fingerprint was already used for a different action.',
      409,
      'Refresh the page and repeat the action once with a new request.'
    );
  end if;

  return coalesce(stored_response, jsonb_build_object('ok', true, 'duplicate', true));
end;
$function$


ALTER FUNCTION "examination_room_v1"."api_replay"(p_institution_id uuid, p_request_hash text, p_event_type text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."api_replay"(p_institution_id uuid, p_request_hash text, p_event_type text) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."api_replay"(p_institution_id uuid, p_request_hash text, p_event_type text) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.api_student(p_operation text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_variable
declare
  institution_id uuid;
  exam_id uuid;
  exam_version_id uuid;
  activation_id uuid;
  roster_id uuid;
  student_identity_id uuid;
  session_id uuid;
  submission_id uuid;
  question_id uuid;
  answer_revision_id uuid;
  notice_version_id uuid;
  activation_status text;
  session_status text;
  notice_code text;
  full_name text;
  student_number text;
  grading_alias text;
  subject_name text;
  year_level text;
  professor_name text;
  request_hash text;
  audit_request_hash text;
  session_token_hash text;
  stored_token_hash text;
  publication_hash text;
  integrity_tier text;
  controls_payload jsonb;
  publication_manifest jsonb;
  submission_manifest jsonb;
  response jsonb;
  replay jsonb;
  answer_item jsonb;
  answer_selection jsonb;
  result_manifest jsonb;
  lifecycle_result jsonb;
  activation_opens_at timestamptz;
  activation_closes_at timestamptz;
  lease_expires_at timestamptz;
  occurred_at timestamptz;
  duration_seconds integer;
  extra_minutes integer;
  maximum_sessions integer;
  next_revision integer;
  expected_count integer;
  matched_count integer;
  affected_count integer;
  recording_required boolean;
  recording_accepted boolean;
  accepted_at timestamptz;
  accepted_features jsonb;
  expected_question_type text;
begin
  if p_operation in ('preview', 'consent') then
    select
      a.id,
      a.institution_id,
      a.exam_id,
      a.exam_version_id,
      a.activation_status,
      a.opens_at,
      a.closes_at,
      a.max_sessions,
      v.controls,
      v.publication_manifest,
      v.content_sha256,
      v.duration_seconds,
      v.privacy_notice_version_id,
      n.notice_code,
      er.id,
      er.student_identity_id,
      si.full_name,
      si.external_student_id,
      er.grading_alias,
      er.accommodations ->> 'subject',
      er.accommodations ->> 'yearLevel',
      coalesce((er.accommodations ->> 'extraMinutes')::integer, 0),
      sm.display_name
    into
      activation_id,
      institution_id,
      exam_id,
      exam_version_id,
      activation_status,
      activation_opens_at,
      activation_closes_at,
      maximum_sessions,
      controls_payload,
      publication_manifest,
      publication_hash,
      duration_seconds,
      notice_version_id,
      notice_code,
      roster_id,
      student_identity_id,
      full_name,
      student_number,
      grading_alias,
      subject_name,
      year_level,
      extra_minutes,
      professor_name
    from examination_room_v1.room_activations a
    join examination_room_v1.exam_versions v on v.id = a.exam_version_id
    join examination_room_v1.exams e on e.id = a.exam_id
    join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
    join examination_room_v1.exam_roster er on er.exam_id = a.exam_id and er.roster_status in ('invited', 'eligible', 'completed')
    join examination_room_v1.student_identities si on si.id = er.student_identity_id and si.identity_status = 'active'
    left join lateral (
      select m.display_name
      from examination_room_v1.staff_memberships m
      where m.institution_id = a.institution_id
        and m.user_id = e.owner_user_id
        and m.membership_status = 'active'
      order by (m.staff_role = 'professor') desc, m.granted_at desc
      limit 1
    ) sm on true
    where a.key_hash = p_payload ->> 'roomKeyHash'
      and a.activation_status in ('scheduled', 'open')
      and a.closes_at > clock_timestamp()
      and upper(si.external_student_id) = upper(p_payload #>> '{identity,studentNumber}')
      and lower(btrim(si.full_name)) = lower(btrim(p_payload #>> '{identity,realName}'))
      and lower(btrim(er.accommodations ->> 'subject')) = lower(btrim(p_payload #>> '{identity,subject}'))
      and lower(btrim(er.accommodations ->> 'yearLevel')) = lower(btrim(p_payload #>> '{identity,yearLevel}'))
    order by a.created_at desc
    limit 1;

    if activation_id is null then
      if exists (
        select 1
        from examination_room_v1.room_activations a
        where a.key_hash = p_payload ->> 'roomKeyHash'
          and a.activation_status in ('scheduled', 'open')
          and a.closes_at > clock_timestamp()
      ) then
        return examination_room_v1.api_error(
          'STUDENT_IDENTITY_INVALID', 'The entered identity does not exactly match the examination roster.', 400,
          'Use the complete registered name, student number, subject, and year level.'
        );
      end if;
      return examination_room_v1.api_error(
        'ROOM_KEY_INVALID', 'The room key is expired, revoked, or not recognized.', 401,
        'Copy the complete current key from the administrator message and try again.'
      );
    end if;

    lifecycle_result := public.examination_room_v1_lifecycle_guard(exam_id);
    if lifecycle_result ->> 'ok' <> 'true' then
      return lifecycle_result;
    end if;

    if p_operation = 'preview' then
      select jsonb_build_object(
        'ok', true,
        'metadata', jsonb_build_object(
          'examId', e.id,
          'title', e.title,
          'subject', subject_name,
          'yearLevel', year_level,
          'durationMinutes', duration_seconds / 60,
          'startsAt', controls_payload -> 'startsAt',
          'professor', coalesce(professor_name, 'Professor'),
          'questionCount', jsonb_array_length(publication_manifest -> 'questions'),
          'integrityTier', coalesce(controls_payload ->> 'integrityTier', 'standard'),
          'cameraRequired', coalesce((controls_payload ->> 'cameraRequired')::boolean, false),
          'microphoneRequired', coalesce((controls_payload ->> 'microphoneRequired')::boolean, false),
          'privacyNoticeVersion', notice_code,
          'privacyController', coalesce(controls_payload ->> 'privacyController', ''),
          'retentionSummary', coalesce(controls_payload ->> 'retentionSummary', ''),
          'activationStatus', activation_status,
          'safeguards', jsonb_build_array(
            'Fullscreen may be requested by the examination settings.',
            'Focus and connection changes are recorded for professor review.',
            'Browser signals are review evidence, not automatic proof of misconduct.'
          )
        ),
        'identity', jsonb_build_object(
          'fullName', full_name,
          'studentNumber', student_number,
          'yearLevel', year_level
        ),
        'notice', jsonb_build_object(
          'version', n.notice_code,
          'title', n.title,
          'body', n.notice_body,
          'purposes', n.processing_purposes
        )
      )
      into response
      from examination_room_v1.exams e
      join examination_room_v1.privacy_notice_versions n on n.id = notice_version_id
      where e.id = exam_id;
      return response;
    end if;

    -- Consent creation and capacity checks serialize on the chosen activation;
    -- read-only previews never take this shared hot-row lock.
    perform 1
    from examination_room_v1.room_activations a
    where a.id = activation_id
    for update;
    perform 1
    from examination_room_v1.exam_roster er
    where er.id = roster_id
    for update;

    request_hash := p_payload ->> 'requestHash';
    session_token_hash := p_payload ->> 'sessionTokenHash';
    recording_required := coalesce(controls_payload ->> 'integrityTier', 'standard') = 'recorded_proctoring'
      or coalesce((controls_payload ->> 'cameraRequired')::boolean, false)
      or coalesce((controls_payload ->> 'microphoneRequired')::boolean, false);
    recording_accepted := coalesce((p_payload #>> '{consent,recordingAccepted}')::boolean, false);

    if activation_status <> 'open' or clock_timestamp() < activation_opens_at then
      return examination_room_v1.api_error(
        'ROOM_NOT_OPEN', 'The professor has not opened this examination room yet.', 409,
        'Wait for the professor to open the room, then choose Agree and begin again.'
      );
    end if;
    if p_payload #>> '{consent,noticeVersion}' <> notice_code
       or not coalesce((p_payload #>> '{consent,accepted}')::boolean, false) then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_VERSION_MISMATCH', 'Consent must accept the exact current privacy notice.', 412,
        'Review the current notice shown on screen and agree again.'
      );
    end if;
    if recording_required and not recording_accepted then
      return examination_room_v1.api_error(
        'RECORDING_CONSENT_REQUIRED', 'This examination requires separate recording consent.', 412,
        'Agree to recording or ask the professor for another permitted arrangement.'
      );
    end if;

    replay := examination_room_v1.api_replay(institution_id, request_hash, 'student.consent');
    if replay is not null then
      if replay ->> 'ok' = 'false' then return replay; end if;
      select s.id, s.session_token_hash
      into session_id, stored_token_hash
      from examination_room_v1.student_sessions s
      where s.consent_request_hash = request_hash
        and s.activation_id = activation_id
        and s.roster_id = roster_id
      for update;
      if session_id is null then
        return examination_room_v1.api_error(
          'CONSENT_REPLAY_INVALID', 'The prior consent receipt cannot be recovered.', 409,
          'Return to the join page and create a new consent request.'
        );
      end if;
      if stored_token_hash <> session_token_hash then
        update examination_room_v1.student_sessions s
        set session_token_hash = session_token_hash
        where s.id = session_id;
      end if;
      select v.publication_manifest, v.content_sha256
      into publication_manifest, publication_hash
      from examination_room_v1.student_sessions s
      join examination_room_v1.exam_versions v on v.id = s.exam_version_id
      where s.id = session_id;
      replay := replay || jsonb_build_object(
        'publicationManifest', publication_manifest,
        'publicationHash', publication_hash
      );
      return replay;
    end if;

    if maximum_sessions is not null
       and (select count(*) from examination_room_v1.student_sessions s where s.activation_id = activation_id) >= maximum_sessions then
      return examination_room_v1.api_error(
        'ROOM_SESSION_LIMIT_REACHED', 'This room has reached its configured session limit.', 409,
        'Ask the professor or administrator to review the room capacity.'
      );
    end if;
    if exists (
      select 1 from examination_room_v1.student_sessions s
      where s.activation_id = activation_id and s.roster_id = roster_id
    ) then
      return examination_room_v1.api_error(
        'SESSION_ALREADY_EXISTS', 'A session already exists for this student and room.', 409,
        'Resume the existing session with its issued session token.'
      );
    end if;

    session_id := gen_random_uuid();
    lease_expires_at := least(
      activation_closes_at,
      clock_timestamp() + make_interval(secs => duration_seconds + extra_minutes * 60)
    );
    insert into examination_room_v1.student_sessions (
      id, activation_id, exam_id, institution_id, exam_version_id, roster_id,
      session_token_hash, consent_request_hash, client_instance_id, session_status,
      identity_verified_at, identity_verification_method, started_at,
      last_heartbeat_at, lease_expires_at, session_metadata
    ) values (
      session_id,
      activation_id,
      exam_id,
      institution_id,
      exam_version_id,
      roster_id,
      session_token_hash,
      request_hash,
      (p_payload ->> 'clientInstanceId')::uuid,
      'active',
      clock_timestamp(),
      'room_key_roster_match',
      clock_timestamp(),
      clock_timestamp(),
      lease_expires_at,
      jsonb_build_object('connected', true, 'currentQuestion', 1)
    );

    insert into examination_room_v1.privacy_acceptances (
      notice_version_id, roster_id, session_id, exam_version_id, client_event_id,
      decision, accepted_features, evidence_sha256, capture_method, recorded_at
    ) values (
      notice_version_id,
      roster_id,
      session_id,
      exam_version_id,
      (p_payload ->> 'clientEventId')::uuid,
      'accepted',
      jsonb_build_object(
        'recordingAccepted', recording_accepted,
        'cameraRequired', coalesce((controls_payload ->> 'cameraRequired')::boolean, false),
        'microphoneRequired', coalesce((controls_payload ->> 'microphoneRequired')::boolean, false),
        'integrityTier', coalesce(controls_payload ->> 'integrityTier', 'standard')
      ),
      request_hash,
      'checkbox',
      (p_payload #>> '{consent,acceptedAt}')::timestamptz
    );

    response := jsonb_build_object(
      'ok', true,
      'session', jsonb_build_object(
        'id', session_id,
        'status', 'active',
        'startedAt', clock_timestamp(),
        'leaseExpiresAt', lease_expires_at,
        'anonymousCandidateId', grading_alias
      ),
      'publicationManifest', publication_manifest,
      'publicationHash', publication_hash
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.consent',
      'student_session', session_id, request_hash, clock_timestamp(), response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  session_id := nullif(p_payload ->> 'sessionId', '')::uuid;
  session_token_hash := p_payload ->> 'sessionTokenHash';
  select
    s.institution_id,
    s.exam_id,
    s.exam_version_id,
    s.activation_id,
    s.roster_id,
    er.student_identity_id,
    s.session_status,
    s.lease_expires_at,
    a.activation_status,
    a.opens_at,
    a.closes_at,
    v.controls,
    v.publication_manifest,
    v.content_sha256,
    v.privacy_notice_version_id,
    n.notice_code,
    si.full_name,
    si.external_student_id,
    er.grading_alias,
    er.accommodations ->> 'subject',
    er.accommodations ->> 'yearLevel'
  into
    institution_id,
    exam_id,
    exam_version_id,
    activation_id,
    roster_id,
    student_identity_id,
    session_status,
    lease_expires_at,
    activation_status,
    activation_opens_at,
    activation_closes_at,
    controls_payload,
    publication_manifest,
    publication_hash,
    notice_version_id,
    notice_code,
    full_name,
    student_number,
    grading_alias,
    subject_name,
    year_level
  from examination_room_v1.student_sessions s
  join examination_room_v1.room_activations a on a.id = s.activation_id
  join examination_room_v1.exam_versions v on v.id = s.exam_version_id
  join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
  join examination_room_v1.exam_roster er on er.id = s.roster_id
  join examination_room_v1.student_identities si on si.id = er.student_identity_id
  where s.id = session_id
    and s.session_token_hash = session_token_hash
  for update of s;

  if institution_id is null then
    return examination_room_v1.api_error(
      'SESSION_INVALID', 'The examination session could not be verified.', 401,
      'Return to the join page and enter the same room key and student details.'
    );
  end if;

  if p_operation = 'result' and session_status = 'revoked' then
    return examination_room_v1.api_error(
      'SESSION_REVOKED', 'This examination credential has been revoked.', 401,
      'Ask the examination administrator to review access to the released result.'
    );
  end if;

  if p_operation in ('resume', 'session_context') then
    select jsonb_build_object(
      'ok', true,
      'session', jsonb_build_object(
        'id', s.id,
        'status', s.session_status,
        'startedAt', s.started_at,
        'lastHeartbeatAt', s.last_heartbeat_at,
        'leaseExpiresAt', s.lease_expires_at,
        'submittedAt', s.ended_at
      ),
      'publicationManifest', publication_manifest,
      'publicationHash', publication_hash,
      'studentIdentity', jsonb_build_object(
        'realName', full_name,
        'studentNumber', student_number,
        'subject', subject_name,
        'yearLevel', year_level
      ),
      'privacyConsent', consent.item,
      'answerRevisions', coalesce(answers.items, '[]'::jsonb),
      'nextRevisionByQuestion', coalesce(answers.next_revisions, '{}'::jsonb),
      'anonymousCandidateId', grading_alias
    )
    into response
    from examination_room_v1.student_sessions s
    left join lateral (
      select jsonb_build_object(
        'noticeVersion', notice_code,
        'accepted', true,
        'acceptedAt', to_char(pa.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'recordingAccepted', coalesce((pa.accepted_features ->> 'recordingAccepted')::boolean, false)
      ) as item
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = s.id
        and pa.decision = 'accepted'
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawal
          where withdrawal.prior_acceptance_id = pa.id and withdrawal.decision = 'withdrawn'
        )
      order by pa.recorded_at desc
      limit 1
    ) consent on true
    left join lateral (
      with latest as (
        select distinct on (ar.question_id)
          ar.question_id,
          ar.answer_payload,
          ar.idempotency_key_hash,
          ar.revision_number
        from examination_room_v1.answer_revisions ar
        where ar.session_id = s.id
        order by ar.question_id, ar.revision_number desc
      ), next_values as (
        select q.question_key, coalesce(max(ar.revision_number), 0) + 1 as next_revision
        from examination_room_v1.questions q
        left join examination_room_v1.answer_revisions ar
          on ar.question_id = q.id and ar.session_id = s.id
        where q.exam_version_id = s.exam_version_id
        group by q.question_key
      )
      select
        coalesce((
          select jsonb_agg(
            latest.answer_payload || jsonb_build_object('idempotencyKey', latest.idempotency_key_hash)
            order by q.position
          )
          from latest
          join examination_room_v1.questions q on q.id = latest.question_id
        ), '[]'::jsonb) as items,
        coalesce((select jsonb_object_agg(next_values.question_key, next_values.next_revision) from next_values), '{}'::jsonb) as next_revisions
    ) answers on true
    where s.id = session_id;

    if p_operation = 'session_context' and response -> 'privacyConsent' = 'null'::jsonb then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
        'Return to the join page and review the current notice.'
      );
    end if;
    return response;
  end if;

  if p_operation = 'result' then
    select rr.release_manifest
    into result_manifest
    from examination_room_v1.submissions sub
    join examination_room_v1.result_releases rr
      on rr.submission_id = sub.id and rr.release_action = 'release'
    where sub.session_id = session_id
      and not exists (
        select 1 from examination_room_v1.result_releases revoked
        where revoked.supersedes_release_id = rr.id and revoked.release_action = 'revoke'
      )
    order by rr.occurred_at desc
    limit 1;

    if result_manifest is null then
      return jsonb_build_object('ok', true, 'available', false, 'status', 'awaiting_release');
    end if;
    return jsonb_build_object(
      'ok', true,
      'available', true,
      'releasedAt', result_manifest -> 'releasedAt',
      'result', result_manifest -> 'result'
    );
  end if;

  if p_operation in ('heartbeat', 'record_event', 'save_answer', 'submit')
     and not exists (
       select 1
       from examination_room_v1.privacy_acceptances pa
       where pa.session_id = session_id
         and pa.notice_version_id = notice_version_id
         and pa.decision = 'accepted'
         and not exists (
           select 1
           from examination_room_v1.privacy_acceptances withdrawn
           where withdrawn.prior_acceptance_id = pa.id
             and withdrawn.decision = 'withdrawn'
         )
     ) then
    return examination_room_v1.api_error(
      'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
      'Return to the join page and review the current notice.'
    );
  end if;

  request_hash := p_payload ->> 'requestHash';
  audit_request_hash := case
    when p_operation = 'submit' then
      encode(extensions.digest(request_hash || ':student.submit', 'sha256'), 'hex')
    else request_hash
  end;

  replay := examination_room_v1.api_replay(
    institution_id,
    audit_request_hash,
    'student.' || p_operation
  );

  if replay is null
     and p_operation = 'submit'
     and exists (
       select 1
       from examination_room_v1.audit_events legacy
       where legacy.institution_id = institution_id
         and legacy.request_hash = request_hash
         and legacy.event_type = 'student.submit'
     ) then
    replay := examination_room_v1.api_replay(
      institution_id,
      request_hash,
      'student.submit'
    );
  end if;

  if replay is not null then
    if p_operation = 'submit' and replay ->> 'ok' = 'true' then
      return jsonb_set(replay, '{duplicate}', 'true'::jsonb, true);
    end if;
    return replay;
  end if;

  if session_status not in ('created', 'active')
     or lease_expires_at <= clock_timestamp()
     or activation_status <> 'open'
     or clock_timestamp() > activation_closes_at then
    return examination_room_v1.api_error(
      'SESSION_NOT_ACTIVE', 'This examination session is no longer active.', 409,
      'Reconnect or ask the professor to review the session. Server-backed answers remain preserved.'
    );
  end if;

  occurred_at := coalesce((p_payload ->> 'occurredAt')::timestamptz, clock_timestamp());

  if p_operation = 'heartbeat' then
    update examination_room_v1.student_sessions s
    set last_heartbeat_at = greatest(coalesce(s.last_heartbeat_at, s.started_at), occurred_at),
        session_metadata = s.session_metadata || jsonb_build_object(
          'connected', coalesce((p_payload ->> 'connected')::boolean, true),
          'currentQuestion', coalesce((p_payload ->> 'currentQuestion')::integer, 1)
        )
    where s.id = session_id;
    response := jsonb_build_object(
      'ok', true,
      'sessionId', session_id,
      'receivedAt', clock_timestamp(),
      'connected', coalesce((p_payload ->> 'connected')::boolean, true)
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.heartbeat',
      'student_session', session_id, request_hash, occurred_at, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  if p_operation = 'record_event' then
    insert into examination_room_v1.proctoring_incidents (
      session_id, client_event_id, incident_kind, source, severity,
      occurred_at, duration_ms, details
    ) values (
      session_id,
      (p_payload ->> 'clientEventId')::uuid,
      p_payload ->> 'incidentKind',
      'browser_signal',
      coalesce(p_payload ->> 'severity', 'info'),
      occurred_at,
      nullif(p_payload ->> 'durationMs', '')::integer,
      coalesce(p_payload -> 'details', '{}'::jsonb)
    )
    returning id into answer_revision_id;
    response := jsonb_build_object('ok', true, 'incidentId', answer_revision_id, 'recordedAt', clock_timestamp());
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.record_event',
      'proctoring_incident', answer_revision_id, request_hash, occurred_at, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  if p_operation = 'save_answer' then
    if not exists (
      select 1
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = session_id
        and pa.notice_version_id = notice_version_id
        and pa.decision = 'accepted'
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawn
          where withdrawn.prior_acceptance_id = pa.id and withdrawn.decision = 'withdrawn'
        )
    ) then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
        'Return to the join page and review the current notice.'
      );
    end if;

    answer_item := p_payload -> 'answerRevision';
    select q.id, coalesce(q.configuration ->> 'type', replace(q.question_kind, '_', '-'))
    into question_id, expected_question_type
    from examination_room_v1.questions q
    where q.exam_version_id = exam_version_id
      and q.position = (answer_item ->> 'questionNumber')::integer
      and q.question_key = answer_item ->> 'questionKey';
    if question_id is null
       or (answer_item ->> 'attemptId')::uuid <> session_id
       or (answer_item ->> 'examinationId')::uuid <> exam_id
       or coalesce((answer_item ->> 'examinationVersion')::integer, -1) <> (publication_manifest ->> 'version')::integer
       or answer_item ->> 'questionType' <> expected_question_type
       or answer_item ->> 'publicationHash' <> publication_hash then
      return examination_room_v1.api_error(
        'ANSWER_BINDING_MISMATCH', 'The answer does not belong to this exact examination session and version.', 409,
        'Refresh the examination. Your other saved answers remain preserved.'
      );
    end if;
    select coalesce(max(ar.revision_number), 0) + 1
    into next_revision
    from examination_room_v1.answer_revisions ar
    where ar.session_id = session_id and ar.question_id = question_id;
    if (answer_item ->> 'revision')::integer <> next_revision then
      return examination_room_v1.api_error(
        'ANSWER_REVISION_CONFLICT', 'A newer answer revision already exists for this question.', 409,
        'Refresh the saved answer state, then save again.'
      );
    end if;

    answer_revision_id := gen_random_uuid();
    insert into examination_room_v1.answer_revisions (
      id, session_id, exam_version_id, question_id, revision_number,
      client_revision_id, idempotency_key_hash, answer_format, answer_payload,
      answer_sha256, is_flagged, source, saved_at
    ) values (
      answer_revision_id,
      session_id,
      exam_version_id,
      question_id,
      next_revision,
      (p_payload ->> 'clientEventId')::uuid,
      request_hash,
      case
        when answer_item ->> 'questionType' = 'multiple-choice' then 'choice'
        when answer_item ->> 'questionType' = 'true-false' then 'boolean'
        else 'plain_text'
      end,
      answer_item,
      p_payload ->> 'answerHash',
      coalesce((p_payload ->> 'flagged')::boolean, false),
      coalesce(p_payload ->> 'source', 'autosave'),
      (p_payload ->> 'savedAt')::timestamptz
    );
    response := jsonb_build_object(
      'ok', true,
      'revision', jsonb_build_object(
        'id', answer_revision_id,
        'questionKey', answer_item ->> 'questionKey',
        'revision', next_revision,
        'savedAt', p_payload -> 'savedAt',
        'flagged', coalesce((p_payload ->> 'flagged')::boolean, false)
      )
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.save_answer',
      'answer_revision', answer_revision_id, request_hash,
      (p_payload ->> 'savedAt')::timestamptz, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  if p_operation = 'submit' then
    submission_manifest := p_payload -> 'submissionManifest';

    select pa.recorded_at, pa.accepted_features
    into accepted_at, accepted_features
    from examination_room_v1.privacy_acceptances pa
    where pa.session_id = session_id
      and pa.notice_version_id = notice_version_id
      and pa.decision = 'accepted'
      and not exists (
        select 1
        from examination_room_v1.privacy_acceptances withdrawn
        where withdrawn.prior_acceptance_id = pa.id
          and withdrawn.decision = 'withdrawn'
      )
    order by pa.recorded_at desc
    limit 1;

    if coalesce(submission_manifest ->> 'schemaVersion', '') <> 'examination-room/submission/v1'
       or (submission_manifest ->> 'attemptId')::uuid <> session_id
       or (submission_manifest ->> 'examinationId')::uuid <> exam_id
       or coalesce((submission_manifest ->> 'examinationVersion')::integer, -1) <> (publication_manifest ->> 'version')::integer
       or submission_manifest ->> 'publicationHash' <> publication_hash
       or submission_manifest ->> 'identityMode' <> coalesce(controls_payload ->> 'identityMode', 'real_names')
       or submission_manifest -> 'studentIdentity' is distinct from jsonb_build_object(
         'realName', full_name,
         'studentNumber', student_number,
         'subject', subject_name,
         'yearLevel', year_level
       )
       or submission_manifest -> 'gradingIdentity' is distinct from (case
         when coalesce(controls_payload ->> 'identityMode', 'real_names') = 'anonymous_grading' then
           jsonb_build_object('mode', 'anonymous_grading', 'anonymousCandidateId', grading_alias)
         else
           jsonb_build_object('mode', 'real_names', 'displayName', full_name, 'studentNumber', student_number)
       end)
       or submission_manifest #>> '{privacyConsent,noticeVersion}' <> notice_code
       or not coalesce((submission_manifest #>> '{privacyConsent,accepted}')::boolean, false) then
      return examination_room_v1.api_error(
        'SUBMISSION_BINDING_MISMATCH', 'The submission does not match this exact session, publication, and consent.', 409,
        'Reconnect to the examination and submit the server-backed answers again.'
      );
    end if;

    if submission_manifest -> 'privacyConsent' is distinct from jsonb_build_object(
         'noticeVersion', notice_code,
         'accepted', true,
         'acceptedAt', to_char(accepted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'recordingAccepted', coalesce((accepted_features ->> 'recordingAccepted')::boolean, false)
       ) then
      return examination_room_v1.api_error(
        'SUBMISSION_CONSENT_MISMATCH', 'The submission consent evidence does not match the immutable server receipt.', 409,
        'Reconnect to the examination and submit the server-backed consent receipt again.'
      );
    end if;

    if not exists (
      select 1
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = session_id
        and pa.notice_version_id = notice_version_id
        and pa.decision = 'accepted'
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawn
          where withdrawn.prior_acceptance_id = pa.id and withdrawn.decision = 'withdrawn'
        )
    ) then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
        'Return to the join page and review the current notice.'
      );
    end if;

    expected_count := jsonb_array_length(coalesce(p_payload -> 'answerSelections', '[]'::jsonb));
    if expected_count <> (select count(*) from examination_room_v1.questions q where q.exam_version_id = exam_version_id)
       or expected_count <> jsonb_array_length(coalesce(submission_manifest -> 'questions', '[]'::jsonb))
       or coalesce((submission_manifest ->> 'questionCount')::integer, -1) <> expected_count
       or coalesce((submission_manifest ->> 'maxPoints')::numeric, -1) <>
          (select coalesce(sum(q.points), 0) from examination_room_v1.questions q where q.exam_version_id = exam_version_id) then
      return examination_room_v1.api_error(
        'SUBMISSION_ANSWER_MISSING', 'Every question must have one saved answer revision before submission.', 400,
        'Return to the listed question, save an answer, then submit again.'
      );
    end if;

    select count(*)::integer
    into matched_count
    from jsonb_array_elements(p_payload -> 'answerSelections') selected(value)
    join examination_room_v1.questions q
      on q.exam_version_id = exam_version_id
     and q.position = (selected.value ->> 'questionNumber')::integer
     and q.question_key = selected.value ->> 'questionKey'
    join examination_room_v1.answer_revisions ar
      on ar.session_id = session_id
     and ar.question_id = q.id
     and ar.revision_number = (selected.value ->> 'revision')::integer
    join lateral (
      select manifest_question.value
      from jsonb_array_elements(submission_manifest -> 'questions') manifest_question(value)
      where (manifest_question.value ->> 'questionNumber')::integer = q.position
        and manifest_question.value ->> 'questionKey' = q.question_key
        and (manifest_question.value ->> 'revision')::integer = ar.revision_number
        and manifest_question.value -> 'answer' = ar.answer_payload -> 'answer'
    ) bound on true;

    if matched_count <> expected_count then
      return examination_room_v1.api_error(
        'ANSWER_BINDING_MISMATCH', 'One or more submitted answers does not match its saved server revision.', 409,
        'Refresh the saved-answer state and submit again.'
      );
    end if;

    submission_id := (submission_manifest ->> 'submissionId')::uuid;
    insert into examination_room_v1.submissions (
      id, session_id, exam_version_id, idempotency_key_hash, manifest_sha256,
      submission_manifest, answer_count, submitted_at_client
    ) values (
      submission_id,
      session_id,
      exam_version_id,
      request_hash,
      p_payload ->> 'manifestHash',
      submission_manifest,
      expected_count,
      (submission_manifest ->> 'submittedAt')::timestamptz
    );

    for answer_selection in select value from jsonb_array_elements(p_payload -> 'answerSelections')
    loop
      select q.id, ar.id
      into question_id, answer_revision_id
      from examination_room_v1.questions q
      join examination_room_v1.answer_revisions ar
        on ar.question_id = q.id
       and ar.session_id = session_id
       and ar.revision_number = (answer_selection ->> 'revision')::integer
      where q.exam_version_id = exam_version_id
        and q.position = (answer_selection ->> 'questionNumber')::integer
        and q.question_key = answer_selection ->> 'questionKey';
      insert into examination_room_v1.submission_answers (
        submission_id, session_id, question_id, answer_revision_id
      ) values (
        submission_id, session_id, question_id, answer_revision_id
      );
    end loop;

    insert into examination_room_v1.submission_receipts (
      submission_id, receipt_sha256, receipt_payload
    ) values (
      submission_id,
      p_payload ->> 'manifestHash',
      jsonb_build_object(
        'schemaVersion', 'examination-room/submission-receipt/v1',
        'submissionId', submission_id,
        'manifestHash', p_payload ->> 'manifestHash',
        'answerCount', expected_count,
        'receivedAt', clock_timestamp()
      )
    ) returning id into answer_revision_id;

    update examination_room_v1.student_sessions s
    set session_status = 'submitted', ended_at = clock_timestamp()
    where s.id = session_id;
    update examination_room_v1.exam_roster er
    set roster_status = 'completed'
    where er.id = roster_id;

    insert into examination_room_v1.recovery_snapshots (
      exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
      record_count, snapshot_status, retention_until
    ) values (
      exam_id,
      exam_version_id,
      examination_room_v1.next_snapshot_sequence(exam_id),
      'answer_state',
      request_hash,
      expected_count,
      'pending',
      clock_timestamp() + interval '365 days'
    );

    response := jsonb_build_object(
      'ok', true,
      'submission', jsonb_build_object(
        'id', submission_id,
        'status', 'accepted',
        'receiptId', answer_revision_id,
        'receivedAt', clock_timestamp()
      ),
      'duplicate', false
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.submit',
      'submission', submission_id, audit_request_hash,
      (submission_manifest ->> 'submittedAt')::timestamptz, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'The student operation is not implemented.', 400,
    'Refresh the examination and try a listed action.'
  );
end;
$function$


ALTER FUNCTION "examination_room_v1"."api_student"(p_operation text, p_payload jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."api_student"(p_operation text, p_payload jsonb) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."api_student"(p_operation text, p_payload jsonb) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.build_publication_manifest(p_exam_version_id uuid, p_published_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'schemaVersion', 'examination-room/publication/v1',
    'examinationId', v.exam_id,
    'version', v.version_number,
    'publishedAt', to_char(p_published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'title', v.title_snapshot,
    'subject', coalesce(v.controls ->> 'subject', ''),
    'yearLevel', coalesce(v.controls ->> 'yearLevel', ''),
    'instructions', v.instructions,
    'identityMode', coalesce(v.controls ->> 'identityMode', 'real_names'),
    'integrityTier', coalesce(v.controls ->> 'integrityTier', 'standard'),
    'privacyNoticeVersion', coalesce(v.controls ->> 'privacyNoticeVersion', n.notice_code),
    'questions', coalesce(q.questions, '[]'::jsonb),
    'questionCount', coalesce(q.question_count, 0),
    'totalPoints', coalesce(q.total_points, 0)
  )
  from examination_room_v1.exam_versions v
  join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
  left join lateral (
    select
      jsonb_agg(
        jsonb_build_object(
          'number', questions.position,
          'key', questions.question_key,
          'type', coalesce(questions.configuration ->> 'type', replace(questions.question_kind, '_', '-')),
          'prompt', questions.prompt,
          'points', questions.points,
          'gradingGuidance', coalesce(questions.configuration ->> 'gradingGuidance', ''),
          'wordLimit', case when questions.configuration ? 'wordLimit' then questions.configuration -> 'wordLimit' else 'null'::jsonb end,
          'choices', coalesce(questions.configuration -> 'choices', '[]'::jsonb),
          'correctOptionIndex', coalesce(questions.configuration -> 'correctOptionIndex', 'null'::jsonb),
          'acceptedAnswers', coalesce(questions.configuration -> 'acceptedAnswers', '[]'::jsonb)
        )
        order by questions.position
      ) as questions,
      count(*)::integer as question_count,
      coalesce(sum(questions.points), 0) as total_points
    from examination_room_v1.questions
    where questions.exam_version_id = v.id
  ) q on true
  where v.id = p_exam_version_id;
$function$


ALTER FUNCTION "examination_room_v1"."build_publication_manifest"(p_exam_version_id uuid, p_published_at timestamp with time zone) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."build_publication_manifest"(p_exam_version_id uuid, p_published_at timestamp with time zone) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."build_publication_manifest"(p_exam_version_id uuid, p_published_at timestamp with time zone) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.creator_authorized(p_actor_user_id uuid, p_institution_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_actor_user_id is not null
    and p_institution_id is not null
    and exists (
      select 1 from auth.users auth_user where auth_user.id = p_actor_user_id
    )
    and exists (
      select 1
      from examination_room_v1.institutions institution
      left join public.profiles profile on profile.id = p_actor_user_id
      where institution.id = p_institution_id
        and institution.institution_status = 'active'
        and (
          institution.institution_code = 'due-diligence-community'
          or institution.profile_school_id = lower(btrim(coalesce(profile.law_school_id, '')))
          or lower(institution.institution_name) = lower(btrim(coalesce(
            nullif(profile.law_school_other, ''), profile.school, ''
          )))
          or exists (
            select 1
            from examination_room_v1.staff_memberships membership
            where membership.institution_id = institution.id
              and membership.user_id = p_actor_user_id
              and membership.membership_status = 'active'
          )
        )
    );
$function$


ALTER FUNCTION "examination_room_v1"."creator_authorized"(p_actor_user_id uuid, p_institution_id uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."creator_authorized"(p_actor_user_id uuid, p_institution_id uuid) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."creator_authorized"(p_actor_user_id uuid, p_institution_id uuid) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.creator_revoke_session(p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_variable
declare
  exam_id uuid := nullif(p_payload ->> 'examId', '')::uuid;
  session_id uuid := nullif(p_payload ->> 'sessionId', '')::uuid;
  request_hash text := p_payload ->> 'requestHash';
  reason text := btrim(coalesce(p_payload ->> 'reason', 'Removed from this examination by the creator.'));
  revoked_at timestamptz := coalesce((p_payload ->> 'revokedAt')::timestamptz, clock_timestamp());
  exam_owner_id uuid;
  current_status text;
  response jsonb;
  replay jsonb;
begin
  select exam.owner_user_id into exam_owner_id
  from examination_room_v1.exams exam
  where exam.id = exam_id
    and exam.institution_id = p_institution_id;

  if exam_owner_id is null then
    return examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'The examination does not exist in this workspace.', 404,
      'Return to the Examination Room list and choose an available examination.'
    );
  end if;
  if exam_owner_id <> p_actor_user_id
     and not examination_room_v1.owner_authorized(p_actor_user_id) then
    return examination_room_v1.api_error(
      'FORBIDDEN', 'Only the examination creator or a platform owner may remove this session.', 403,
      'Choose an examination created by your signed-in account.'
    );
  end if;
  if length(reason) not between 1 and 1000 then
    return examination_room_v1.api_error(
      'REVOCATION_REASON_INVALID', 'Enter a short reason for removing this session.', 400,
      'Enter the reason, then try again.'
    );
  end if;

  perform examination_room_v1.lock_request(p_institution_id, request_hash);
  replay := examination_room_v1.api_replay(
    p_institution_id, request_hash, 'professor.revoke_session'
  );
  if replay is not null then return replay; end if;

  select session.session_status into current_status
  from examination_room_v1.student_sessions session
  where session.id = session_id
    and session.exam_id = exam_id
    and session.institution_id = p_institution_id
  for update;

  if current_status is null then
    return examination_room_v1.api_error(
      'SESSION_NOT_FOUND', 'The student session is no longer available.', 404,
      'Refresh Monitor and choose a current student session.'
    );
  end if;
  if current_status not in ('created', 'active', 'revoked') then
    return examination_room_v1.api_error(
      'SESSION_NOT_ACTIVE', 'Only a currently active examination session can be removed.', 409,
      'Refresh Monitor and choose a student who is still taking the examination.'
    );
  end if;

  update examination_room_v1.student_sessions session
  set session_status = 'revoked',
      ended_at = coalesce(session.ended_at, revoked_at),
      last_heartbeat_at = coalesce(session.last_heartbeat_at, revoked_at),
      session_metadata = session.session_metadata || jsonb_build_object(
        'connected', false,
        'revokedReason', reason,
        'revokedByUserId', p_actor_user_id,
        'revokedAt', revoked_at
      ),
      updated_at = clock_timestamp()
  where session.id = session_id;

  response := jsonb_build_object(
    'ok', true,
    'examId', exam_id,
    'sessionId', session_id,
    'status', 'revoked',
    'alreadyRevoked', current_status = 'revoked',
    'reason', reason,
    'revokedAt', revoked_at
  );
  perform examination_room_v1.api_record_audit(
    p_institution_id, exam_id, session_id, p_actor_user_id, 'professor',
    'professor.revoke_session', 'student_session', session_id, request_hash,
    revoked_at, response, null
  );
  return response;
end;
$function$


ALTER FUNCTION "examination_room_v1"."creator_revoke_session"(p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."creator_revoke_session"(p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."creator_revoke_session"(p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.ensure_exam_current_version_published()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.current_published_version_id is not null
     and not exists (
       select 1
       from examination_room_v1.exam_versions v
       where v.id = new.current_published_version_id
         and v.exam_id = new.id
         and v.publication_status = 'published'
         and v.anonymous_grading_snapshot = new.anonymous_grading
     ) then
    raise exception using
      errcode = '23514',
      message = 'current_published_version_id must reference a sealed published version of this exam';
  end if;

  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."ensure_exam_current_version_published"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."ensure_exam_current_version_published"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."ensure_exam_current_version_published"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.ensure_releasable_grade()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  revision_status text;
  expected_item_count integer;
  expected_total numeric(12, 2);
  expected_maximum numeric(12, 2);
  current_item_count integer;
  current_total numeric(12, 2);
  current_maximum numeric(12, 2);
begin
  if new.release_action = 'release' then
    select g.grade_status, g.item_count, g.total_score, g.maximum_score
    into revision_status, expected_item_count, expected_total, expected_maximum
    from examination_room_v1.grade_revisions g
    where g.id = new.grade_revision_id
      and g.submission_id = new.submission_id
    for update;

    select count(*)::integer, coalesce(sum(i.score), 0), coalesce(sum(i.maximum_score), 0)
    into current_item_count, current_total, current_maximum
    from examination_room_v1.grade_revision_items i
    where i.grade_revision_id = new.grade_revision_id;

    if revision_status is null
       or revision_status not in ('final', 'corrected')
       or current_item_count <> expected_item_count
       or current_total <> expected_total
       or current_maximum <> expected_maximum then
      raise exception using
        errcode = '23514',
        message = 'release requires a complete final or corrected grade revision';
    end if;
  elsif new.release_action = 'revoke'
        and (
          new.supersedes_release_id = new.id
          or not exists (
            select 1
            from examination_room_v1.result_releases prior
            where prior.id = new.supersedes_release_id
              and prior.submission_id = new.submission_id
              and prior.release_action = 'release'
              and prior.occurred_at < new.occurred_at
          )
        ) then
    raise exception using
      errcode = '23514',
      message = 'a result revocation must reference an earlier release for the same submission';
  end if;

  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."ensure_releasable_grade"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."ensure_releasable_grade"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."ensure_releasable_grade"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.grader_safe_submission_manifest(p_manifest jsonb, p_anonymous_grading boolean, p_grading_alias text, p_opaque_session_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when not p_anonymous_grading then p_manifest
    else p_manifest || jsonb_build_object(
      'attemptId', p_opaque_session_id,
      'studentIdentity', jsonb_build_object(
        'realName', p_grading_alias,
        'studentNumber', p_grading_alias,
        'subject', p_manifest ->> 'subject',
        'yearLevel', p_manifest ->> 'yearLevel'
      ),
      'gradingIdentity', jsonb_build_object(
        'mode', 'anonymous_grading',
        'anonymousCandidateId', p_grading_alias
      )
    )
  end;
$function$


ALTER FUNCTION "examination_room_v1"."grader_safe_submission_manifest"(p_manifest jsonb, p_anonymous_grading boolean, p_grading_alias text, p_opaque_session_id uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."grader_safe_submission_manifest"(p_manifest jsonb, p_anonymous_grading boolean, p_grading_alias text, p_opaque_session_id uuid) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."grader_safe_submission_manifest"(p_manifest jsonb, p_anonymous_grading boolean, p_grading_alias text, p_opaque_session_id uuid) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.json_rows(p_value jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(p_value, '[]'::jsonb);
$function$


ALTER FUNCTION "examination_room_v1"."json_rows"(p_value jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."json_rows"(p_value jsonb) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."json_rows"(p_value jsonb) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.jsonb_sha256(p_value jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
  select encode(sha256(convert_to(p_value::text, 'UTF8')), 'hex');
$function$


ALTER FUNCTION "examination_room_v1"."jsonb_sha256"(p_value jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."jsonb_sha256"(p_value jsonb) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."jsonb_sha256"(p_value jsonb) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.lock_request(p_institution_id uuid, p_request_hash text)
 RETURNS void
 LANGUAGE sql
 STRICT
 SET search_path TO 'pg_catalog'
AS $function$
  select pg_advisory_xact_lock(
    hashtextextended(
      'examination-room-v1:request:' || p_institution_id::text || ':' || p_request_hash,
      20260826
    )
  );
$function$


ALTER FUNCTION "examination_room_v1"."lock_request"(p_institution_id uuid, p_request_hash text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."lock_request"(p_institution_id uuid, p_request_hash text) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."lock_request"(p_institution_id uuid, p_request_hash text) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.next_snapshot_sequence(p_exam_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STRICT
 SET search_path TO 'pg_catalog'
AS $function$
declare
  next_sequence integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('examination-room-v1:snapshot:' || p_exam_id::text, 20260826)
  );
  select coalesce(max(s.snapshot_sequence), 0) + 1
  into next_sequence
  from examination_room_v1.recovery_snapshots s
  where s.exam_id = p_exam_id;
  return next_sequence;
end;
$function$


ALTER FUNCTION "examination_room_v1"."next_snapshot_sequence"(p_exam_id uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."next_snapshot_sequence"(p_exam_id uuid) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."next_snapshot_sequence"(p_exam_id uuid) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.normalize_default_student_warning()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  warning_body constant text :=
    'This examination records your identity, answers, submission status, grades, and any examination-integrity features enabled by your Professor. These records can be viewed by your Professor and the platform owner.';
begin
  if new.notice_code = 'exam-room-v1' then
    new.title := 'Student privacy warning';
    new.notice_body := warning_body;
    new.body_sha256 := encode(sha256(convert_to(warning_body, 'UTF8')), 'hex');
    new.processing_purposes := '["examination_administration","answer_persistence","grading","integrity_review"]'::jsonb;
  end if;
  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."normalize_default_student_warning"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."normalize_default_student_warning"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."normalize_default_student_warning"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.normalized_allowed_emails(p_value jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when p_value is null then '{}'::text[]
    when jsonb_typeof(p_value) <> 'array' then null::text[]
    else coalesce((
      select array_agg(email_value order by email_value)
      from (
        select distinct lower(btrim(item.value)) as email_value
        from jsonb_array_elements_text(p_value) item(value)
        where btrim(item.value) <> ''
      ) normalized
    ), '{}'::text[])
  end;
$function$


ALTER FUNCTION "examination_room_v1"."normalized_allowed_emails"(p_value jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."normalized_allowed_emails"(p_value jsonb) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."normalized_allowed_emails"(p_value jsonb) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.owner_authorized(p_actor_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists (
    select 1
    from public.user_roles owner_role
    where owner_role.user_id = p_actor_user_id
      and owner_role.role in ('founder_admin', 'super_admin')
  );
$function$


ALTER FUNCTION "examination_room_v1"."owner_authorized"(p_actor_user_id uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."owner_authorized"(p_actor_user_id uuid) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."owner_authorized"(p_actor_user_id uuid) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.owner_exam_bundle(p_exam_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  bundle jsonb;
begin
  bundle := examination_room_v1.owner_exam_bundle_before_result_email(p_exam_id);
  return jsonb_set(
    bundle,
    '{tables,resultEmailDeliveryEvents}',
    examination_room_v1.json_rows((
      select jsonb_agg(to_jsonb(event) order by event.released_at, event.release_id)
      from examination_room_v1.result_email_delivery_events event
      where event.exam_id = p_exam_id
    )),
    true
  );
end;
$function$


ALTER FUNCTION "examination_room_v1"."owner_exam_bundle"(p_exam_id uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."owner_exam_bundle"(p_exam_id uuid) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."owner_exam_bundle"(p_exam_id uuid) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.owner_exam_bundle_before_result_email(p_exam_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_institution_id uuid;
  v_current_version_id uuid;
  bundle jsonb;
begin
  select exam.institution_id, exam.current_published_version_id
  into v_institution_id, v_current_version_id
  from examination_room_v1.exams exam
  where exam.id = p_exam_id;

  if v_institution_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'schemaVersion', 'examination-room/owner-bundle/v1',
    'generatedAt', clock_timestamp(),
    'institutionId', v_institution_id,
    'examId', p_exam_id,
    'currentPublishedVersionId', v_current_version_id,
    'tables', jsonb_build_object(
      'institutions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.created_at)
        from examination_room_v1.institutions row_value
        where row_value.id = v_institution_id
      )),
      'privacyNoticeVersions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.version_number)
        from examination_room_v1.privacy_notice_versions row_value
        where row_value.institution_id = v_institution_id
          and exists (
            select 1 from examination_room_v1.exam_versions version
            where version.exam_id = p_exam_id
              and version.privacy_notice_version_id = row_value.id
          )
      )),
      'staffMemberships', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.granted_at, row_value.id)
        from examination_room_v1.staff_memberships row_value
        where row_value.institution_id = v_institution_id
          and (
            row_value.user_id = (select owner_user_id from examination_room_v1.exams where id = p_exam_id)
            or row_value.staff_role = 'admin'
          )
      )),
      'professorAccessRequests', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.requested_at, row_value.id)
        from examination_room_v1.professor_access_requests row_value
        where row_value.requested_institution_id = v_institution_id
          and row_value.user_id = (select owner_user_id from examination_room_v1.exams where id = p_exam_id)
      )),
      'exams', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value))
        from examination_room_v1.exams row_value
        where row_value.id = p_exam_id
      )),
      'examVersions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.version_number)
        from examination_room_v1.exam_versions row_value
        where row_value.exam_id = p_exam_id
      )),
      'questions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.exam_version_id, row_value.position)
        from examination_room_v1.questions row_value
        where exists (
          select 1 from examination_room_v1.exam_versions version
          where version.exam_id = p_exam_id and version.id = row_value.exam_version_id
        )
      )),
      'studentIdentities', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.full_name, row_value.id)
        from examination_room_v1.student_identities row_value
        where exists (
          select 1 from examination_room_v1.exam_roster roster
          where roster.exam_id = p_exam_id and roster.student_identity_id = row_value.id
        )
      )),
      'ownerIdentityCorrections', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.corrected_at, row_value.id)
        from examination_room_v1.owner_identity_corrections row_value
        where row_value.exam_id = p_exam_id
      )),
      'examRoster', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.created_at desc, row_value.id desc)
        from examination_room_v1.exam_roster row_value
        where row_value.exam_id = p_exam_id
      )),
      'roomActivations', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.created_at, row_value.id)
        from examination_room_v1.room_activations row_value
        where row_value.exam_id = p_exam_id
      )),
      'ownerKeyEnvelopes', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.created_at desc, row_value.activation_id desc)
        from examination_room_v1.owner_key_envelopes row_value
        where row_value.exam_id = p_exam_id
      )),
      'studentSessions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.started_at, row_value.id)
        from examination_room_v1.student_sessions row_value
        where row_value.exam_id = p_exam_id
      )),
      'privacyAcceptances', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.recorded_at, row_value.id)
        from examination_room_v1.privacy_acceptances row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'answerRevisions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.session_id, row_value.question_id, row_value.revision_number)
        from examination_room_v1.answer_revisions row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'submissions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.received_at, row_value.id)
        from examination_room_v1.submissions row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'submissionAnswers', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.submission_id, row_value.question_id)
        from examination_room_v1.submission_answers row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'submissionReceipts', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.issued_at, row_value.id)
        from examination_room_v1.submission_receipts row_value
        join examination_room_v1.submissions submission on submission.id = row_value.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = p_exam_id
      )),
      'proctoringIncidents', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.occurred_at, row_value.id)
        from examination_room_v1.proctoring_incidents row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'proctoringArtifacts', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.captured_from, row_value.id)
        from examination_room_v1.proctoring_artifacts row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'gradeRevisions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.submission_id, row_value.revision_number)
        from examination_room_v1.grade_revisions row_value
        join examination_room_v1.submissions submission on submission.id = row_value.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = p_exam_id
      )),
      'gradeRevisionItems', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.grade_revision_id, row_value.question_id)
        from examination_room_v1.grade_revision_items row_value
        join examination_room_v1.grade_revisions grade on grade.id = row_value.grade_revision_id
        join examination_room_v1.submissions submission on submission.id = grade.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = p_exam_id
      )),
      'resultReleases', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.occurred_at, row_value.id)
        from examination_room_v1.result_releases row_value
        join examination_room_v1.submissions submission on submission.id = row_value.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = p_exam_id
      )),
      'auditEvents', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.occurred_at, row_value.id)
        from examination_room_v1.audit_events row_value
        where row_value.exam_id = p_exam_id
      )),
      'recoverySnapshots', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.snapshot_sequence)
        from examination_room_v1.recovery_snapshots row_value
        where row_value.exam_id = p_exam_id
      )),
      'emailDeliveryEvents', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.attempted_at desc, row_value.id desc)
        from examination_room_v1.email_delivery_events row_value
        where row_value.exam_id = p_exam_id
      ))
    )
  ) into bundle;

  return bundle;
end;
$function$


ALTER FUNCTION "examination_room_v1"."owner_exam_bundle_before_result_email"(p_exam_id uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."owner_exam_bundle_before_result_email"(p_exam_id uuid) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."owner_exam_bundle_before_result_email"(p_exam_id uuid) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.owner_snapshot_event_bundle(p_snapshot examination_room_v1.recovery_snapshots)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_institution_id uuid;
  v_submission_id uuid := p_snapshot.source_submission_id;
  bundle jsonb;
begin
  select exam.institution_id into v_institution_id
  from examination_room_v1.exams exam
  where exam.id = p_snapshot.exam_id;

  if p_snapshot.source_kind = 'publication' then
    select jsonb_build_object(
      'schemaVersion', 'examination-room/recovery-event/v1',
      'capturedAt', p_snapshot.created_at,
      'eventKind', 'publication',
      'institutionId', v_institution_id,
      'examId', p_snapshot.exam_id,
      'tables', jsonb_build_object(
        'examVersions', examination_room_v1.json_rows(jsonb_build_array(to_jsonb(version))),
        'questions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(question) order by question.position)
          from examination_room_v1.questions question
          where question.exam_version_id = p_snapshot.exam_version_id
        )),
        'privacyNoticeVersions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(notice))
          from examination_room_v1.privacy_notice_versions notice
          where notice.id = version.privacy_notice_version_id
        ))
      )
    ) into bundle
    from examination_room_v1.exam_versions version
    where version.id = p_snapshot.exam_version_id
      and version.exam_id = p_snapshot.exam_id;
  elsif p_snapshot.source_kind = 'submission' and v_submission_id is not null then
    select jsonb_build_object(
      'schemaVersion', 'examination-room/recovery-event/v1',
      'capturedAt', p_snapshot.created_at,
      'eventKind', 'submission',
      'institutionId', v_institution_id,
      'examId', p_snapshot.exam_id,
      'tables', jsonb_build_object(
        'submissions', examination_room_v1.json_rows(jsonb_build_array(jsonb_build_object(
          'id', submission.id,
          'session_id', submission.session_id,
          'exam_version_id', submission.exam_version_id,
          'idempotency_key_hash', submission.idempotency_key_hash,
          'manifest_sha256', submission.manifest_sha256,
          'submission_manifest', submission.submission_manifest,
          'answer_count', submission.answer_count,
          'submitted_at_client', submission.submitted_at_client,
          'received_at', submission.received_at
        ))),
        'answerRevisions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(answer) order by answer.question_id, answer.revision_number)
          from examination_room_v1.answer_revisions answer
          where answer.session_id = submission.session_id
            and answer.received_at <= p_snapshot.created_at
        )),
        'submissionAnswers', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(answer) order by answer.question_id)
          from examination_room_v1.submission_answers answer
          where answer.submission_id = submission.id
        )),
        'submissionReceipts', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(receipt) order by receipt.issued_at, receipt.id)
          from examination_room_v1.submission_receipts receipt
          where receipt.submission_id = submission.id
        )),
        'privacyAcceptances', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(acceptance) order by acceptance.recorded_at, acceptance.id)
          from examination_room_v1.privacy_acceptances acceptance
          where acceptance.session_id = submission.session_id
            and acceptance.recorded_at <= p_snapshot.created_at
        ))
      )
    ) into bundle
    from examination_room_v1.submissions submission
    where submission.id = v_submission_id;
  elsif p_snapshot.source_kind = 'grade_revision' and p_snapshot.source_grade_revision_id is not null then
    select jsonb_build_object(
      'schemaVersion', 'examination-room/recovery-event/v1',
      'capturedAt', p_snapshot.created_at,
      'eventKind', 'grade_revision',
      'institutionId', v_institution_id,
      'examId', p_snapshot.exam_id,
      'tables', jsonb_build_object(
        'gradeRevisions', examination_room_v1.json_rows(jsonb_build_array(to_jsonb(grade))),
        'gradeRevisionItems', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(item) order by item.question_id)
          from examination_room_v1.grade_revision_items item
          where item.grade_revision_id = grade.id
        )),
        'submissions', examination_room_v1.json_rows((
          select jsonb_agg(jsonb_build_object(
            'id', submission.id,
            'session_id', submission.session_id,
            'exam_version_id', submission.exam_version_id,
            'manifest_sha256', submission.manifest_sha256,
            'submission_manifest', submission.submission_manifest,
            'received_at', submission.received_at
          ))
          from examination_room_v1.submissions submission
          where submission.id = grade.submission_id
        ))
      )
    ) into bundle
    from examination_room_v1.grade_revisions grade
    where grade.id = p_snapshot.source_grade_revision_id;
  elsif p_snapshot.source_kind = 'result_release' then
    bundle := jsonb_build_object(
      'schemaVersion', 'examination-room/recovery-event/v1',
      'capturedAt', p_snapshot.created_at,
      'eventKind', 'result_release_batch',
      'institutionId', v_institution_id,
      'examId', p_snapshot.exam_id,
      'tables', jsonb_build_object(
        'gradeRevisions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(grade) order by grade.created_at, grade.id)
          from examination_room_v1.grade_revisions grade
          where grade.id in (
            select release.grade_revision_id
            from examination_room_v1.result_releases release
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'gradeRevisionItems', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(item) order by item.created_at, item.grade_revision_id, item.question_id)
          from examination_room_v1.grade_revision_items item
          where item.grade_revision_id in (
            select release.grade_revision_id
            from examination_room_v1.result_releases release
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'resultReleases', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(release) order by release.occurred_at, release.id)
          from examination_room_v1.result_releases release
          where release.batch_request_hash = p_snapshot.request_hash
            or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
        )),
        'submissions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(submission) order by submission.received_at, submission.id)
          from examination_room_v1.submissions submission
          where submission.id in (
            select release.submission_id
            from examination_room_v1.result_releases release
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'studentSessions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(session) order by session.started_at, session.id)
          from examination_room_v1.student_sessions session
          where session.id in (
            select submission.session_id
            from examination_room_v1.submissions submission
            join examination_room_v1.result_releases release on release.submission_id = submission.id
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'examRoster', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(roster) order by roster.id)
          from examination_room_v1.exam_roster roster
          where roster.id in (
            select session.roster_id
            from examination_room_v1.student_sessions session
            join examination_room_v1.submissions submission on submission.session_id = session.id
            join examination_room_v1.result_releases release on release.submission_id = submission.id
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'studentIdentities', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(identity) order by identity.id)
          from examination_room_v1.student_identities identity
          where identity.id in (
            select roster.student_identity_id
            from examination_room_v1.exam_roster roster
            join examination_room_v1.student_sessions session on session.roster_id = roster.id
            join examination_room_v1.submissions submission on submission.session_id = session.id
            join examination_room_v1.result_releases release on release.submission_id = submission.id
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'questions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(question) order by question.position, question.id)
          from examination_room_v1.questions question
          where question.exam_version_id = p_snapshot.exam_version_id
        ))
      )
    );
  else
    bundle := examination_room_v1.owner_exam_bundle(p_snapshot.exam_id);
  end if;

  return bundle;
end;
$function$


ALTER FUNCTION "examination_room_v1"."owner_snapshot_event_bundle"(p_snapshot examination_room_v1.recovery_snapshots) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."owner_snapshot_event_bundle"(p_snapshot examination_room_v1.recovery_snapshots) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."owner_snapshot_event_bundle"(p_snapshot examination_room_v1.recovery_snapshots) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.owner_snapshot_payload(p_snapshot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  snapshot examination_room_v1.recovery_snapshots%rowtype;
  bundle jsonb;
begin
  select * into snapshot
  from examination_room_v1.recovery_snapshots row_value
  where row_value.id = p_snapshot_id;
  if snapshot.id is null then return null; end if;

  bundle := case
    when snapshot.snapshot_scope = 'full_recovery' or snapshot.source_kind = 'manual'
      then examination_room_v1.owner_exam_bundle(snapshot.exam_id)
    else examination_room_v1.owner_snapshot_event_bundle(snapshot)
  end;
  return jsonb_build_object(
    'schemaVersion', 'examination-room/recovery-bundle/v1',
    'snapshot', to_jsonb(snapshot),
    'institutionId', (bundle ->> 'institutionId')::uuid,
    'examId', snapshot.exam_id,
    'examVersionId', snapshot.exam_version_id,
    'scope', snapshot.snapshot_scope,
    'sourceKind', snapshot.source_kind,
    'bundle', bundle
  );
end;
$function$


ALTER FUNCTION "examination_room_v1"."owner_snapshot_payload"(p_snapshot_id uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."owner_snapshot_payload"(p_snapshot_id uuid) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."owner_snapshot_payload"(p_snapshot_id uuid) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.prepare_student_admission(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_variable
declare
  activation_row examination_room_v1.room_activations%rowtype;
  exam_owner_id uuid;
  student_identity_id uuid;
  roster_id uuid;
  full_name text := btrim(coalesce(p_payload #>> '{identity,realName}', ''));
  student_number text := upper(btrim(coalesce(p_payload #>> '{identity,studentNumber}', '')));
  entered_subject text := btrim(coalesce(p_payload #>> '{identity,subject}', ''));
  entered_year_level text := btrim(coalesce(p_payload #>> '{identity,yearLevel}', ''));
  student_email text := nullif(lower(btrim(coalesce(p_payload #>> '{identity,email}', ''))), '');
  canonical_subject text;
  canonical_year_level text;
  admission_mode text;
  allowed_emails text[];
  use_anonymous_grading boolean;
  lifecycle_result jsonb;
begin
  select activation.* into activation_row
  from examination_room_v1.room_activations activation
  where activation.key_hash = p_payload ->> 'roomKeyHash'
  order by activation.created_at desc, activation.id desc
  limit 1;

  if activation_row.id is null then
    return examination_room_v1.api_error(
      'ROOM_KEY_INVALID', 'The room key is expired, revoked, or not recognized.', 401,
      'Copy the complete current key from the Professor message and try again.'
    );
  end if;

  lifecycle_result := public.examination_room_v1_lifecycle_guard(activation_row.exam_id);
  if lifecycle_result ->> 'ok' <> 'true' then
    return lifecycle_result;
  end if;

  if activation_row.activation_status not in ('scheduled', 'open')
     or activation_row.closes_at <= clock_timestamp() then
    return examination_room_v1.api_error(
      'ROOM_KEY_INVALID', 'The room key is expired, revoked, or not recognized.', 401,
      'Copy the complete current key from the Professor message and try again.'
    );
  end if;

  if activation_row.activation_status = 'scheduled' then
    update examination_room_v1.room_activations activation
    set activation_status = 'open',
        opens_at = least(activation.opens_at, clock_timestamp()),
        deactivated_at = null,
        deactivated_by_user_id = null,
        deactivation_reason = null
    where activation.id = activation_row.id
      and activation.activation_status = 'scheduled'
      and activation.closes_at > clock_timestamp()
    returning activation.* into activation_row;

    if not found then
      select activation.* into activation_row
      from examination_room_v1.room_activations activation
      where activation.key_hash = p_payload ->> 'roomKeyHash'
        and activation.activation_status = 'open'
        and activation.closes_at > clock_timestamp();
    end if;
    if activation_row.id is null then
      return examination_room_v1.api_error(
        'ROOM_KEY_INVALID', 'The room key is expired, revoked, or not recognized.', 401,
        'Copy the complete current key from the Professor message and try again.'
      );
    end if;
  end if;

  if length(full_name) not between 2 and 240
     or full_name !~ '[[:alpha:]]'
     or length(student_number) not between 2 and 128
     or length(entered_subject) not between 1 and 160
     or length(entered_year_level) not between 1 and 64 then
    return examination_room_v1.api_error(
      'STUDENT_IDENTITY_INVALID', 'Complete the student name, student number, subject, and year level.', 400,
      'Correct the four student details, then try again with the same key.'
    );
  end if;
  if student_email is not null and (
    length(student_email) not between 3 and 320
    or student_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    return examination_room_v1.api_error(
      'STUDENT_EMAIL_INVALID', 'Enter a valid student email or leave it blank.', 400,
      'Correct the email, then try again.'
    );
  end if;

  select
    exam.owner_user_id,
    exam.anonymous_grading,
    version.admission_mode_snapshot,
    version.allowed_emails_snapshot,
    coalesce(version.controls ->> 'subject', ''),
    coalesce(version.controls ->> 'yearLevel', '')
  into
    exam_owner_id,
    use_anonymous_grading,
    admission_mode,
    allowed_emails,
    canonical_subject,
    canonical_year_level
  from examination_room_v1.exams exam
  join examination_room_v1.exam_versions version on version.id = activation_row.exam_version_id
  where exam.id = activation_row.exam_id
    and exam.institution_id = activation_row.institution_id;

  if admission_mode = 'email_allowlist'
     and (student_email is null or not (student_email = any(allowed_emails))) then
    return examination_room_v1.api_error(
      'STUDENT_EMAIL_NOT_ALLOWED', 'This email is not included in the examination access list.', 403,
      'Check the email spelling or ask the Professor to update the optional email list.'
    );
  end if;

  if exists (
    select 1
    from examination_room_v1.student_sessions session
    join examination_room_v1.exam_roster roster on roster.id = session.roster_id
    join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
    where session.activation_id = activation_row.id
      and session.session_status = 'revoked'
      and (
        identity.external_student_id = student_number
        or (
          student_email is not null
          and identity.email_normalized = student_email
        )
      )
  ) then
    return examination_room_v1.api_error(
      'SESSION_REVOKED', 'This entry was removed from the current examination room.', 403,
      'Ask the Professor before trying to enter this activation again.'
    );
  end if;

  insert into examination_room_v1.student_identities (
    institution_id, external_student_id, full_name, email_normalized,
    identity_status, verified_at, verification_method
  ) values (
    activation_row.institution_id,
    student_number,
    full_name,
    student_email,
    'active',
    null,
    null
  )
  on conflict (institution_id, external_student_id) do update
  set full_name = excluded.full_name,
      email_normalized = coalesce(excluded.email_normalized, examination_room_v1.student_identities.email_normalized),
      identity_status = 'active',
      updated_at = clock_timestamp()
  returning id into student_identity_id;

  roster_id := gen_random_uuid();
  insert into examination_room_v1.exam_roster (
    id, exam_id, institution_id, student_identity_id, grading_alias,
    roster_status, accommodations, added_by_user_id
  ) values (
    roster_id,
    activation_row.exam_id,
    activation_row.institution_id,
    student_identity_id,
    case when use_anonymous_grading
      then 'CAND-' || upper(substr(replace(roster_id::text, '-', ''), 1, 8))
      else null end,
    'eligible',
    jsonb_build_object(
      'subject', canonical_subject,
      'yearLevel', canonical_year_level,
      'enteredSubject', entered_subject,
      'enteredYearLevel', entered_year_level,
      'admissionSource', 'room_key_self_entry',
      'extraMinutes', 0
    ),
    exam_owner_id
  )
  on conflict on constraint exam_roster_exam_student_key do update
  set roster_status = case
        when examination_room_v1.exam_roster.roster_status = 'completed' then 'completed'
        else 'eligible'
      end,
      grading_alias = coalesce(examination_room_v1.exam_roster.grading_alias, excluded.grading_alias),
      accommodations = jsonb_build_object(
        'subject', canonical_subject,
        'yearLevel', canonical_year_level,
        'enteredSubject', entered_subject,
        'enteredYearLevel', entered_year_level,
        'admissionSource', 'room_key_self_entry',
        'extraMinutes', coalesce(
          examination_room_v1.exam_roster.accommodations -> 'extraMinutes',
          '0'::jsonb
        )
      ),
      updated_at = clock_timestamp()
  returning id into roster_id;

  if exists (
    select 1
    from examination_room_v1.student_sessions session
    where session.activation_id = activation_row.id
      and session.roster_id = roster_id
      and session.session_status = 'revoked'
  ) then
    return examination_room_v1.api_error(
      'SESSION_REVOKED', 'This entry was removed from the current examination room.', 403,
      'Ask the Professor before trying to enter this activation again.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'identity', jsonb_strip_nulls(jsonb_build_object(
      'realName', full_name,
      'studentNumber', student_number,
      'subject', canonical_subject,
      'yearLevel', canonical_year_level,
      'email', student_email
    ))
  );
end;
$function$


ALTER FUNCTION "examination_room_v1"."prepare_student_admission"(p_payload jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."prepare_student_admission"(p_payload jsonb) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."prepare_student_admission"(p_payload jsonb) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.prevent_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  raise exception using
    errcode = '55000',
    message = format('%I.%I rows cannot be deleted', tg_table_schema, tg_table_name);
  return null;
end;
$function$


ALTER FUNCTION "examination_room_v1"."prevent_delete"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."prevent_delete"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."prevent_delete"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.prevent_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  raise exception using
    errcode = '55000',
    message = format('%I.%I is append-only', tg_table_schema, tg_table_name);
  return null;
end;
$function$


ALTER FUNCTION "examination_room_v1"."prevent_mutation"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."prevent_mutation"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."prevent_mutation"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.protect_email_delivery_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'examination_room_v1.email_delivery_events is append-only';
  end if;

  if new.id is distinct from old.id
     or new.institution_id is distinct from old.institution_id
     or new.exam_id is distinct from old.exam_id
     or new.activation_id is distinct from old.activation_id
     or new.request_hash is distinct from old.request_hash
     or new.delivery_kind is distinct from old.delivery_kind
     or new.professor_recipient is distinct from old.professor_recipient
     or new.owner_copy_recipients is distinct from old.owner_copy_recipients then
    raise exception using
      errcode = '55000',
      message = 'email delivery scope and recipient evidence is immutable';
  end if;

  if old.provider_status in ('failed', 'not_configured')
     and new.provider_status = 'sent'
     and new.safe_error_code is null
     and new.attempted_at >= old.attempted_at then
    return new;
  end if;

  if to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'email delivery status may advance only from failed or not configured to sent';
  return null;
end;
$function$


ALTER FUNCTION "examination_room_v1"."protect_email_delivery_event"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."protect_email_delivery_event"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."protect_email_delivery_event"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.protect_grade_revision_item_set()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  expected_item_count integer;
  current_item_count integer;
begin
  if tg_op <> 'INSERT' then
    raise exception using
      errcode = '55000',
      message = 'grade revision items are append-only';
  end if;

  select g.item_count
  into expected_item_count
  from examination_room_v1.grade_revisions g
  where g.id = new.grade_revision_id
  for update;

  if expected_item_count is null then
    raise exception using
      errcode = '23503',
      message = 'grade item references an unknown grade revision';
  end if;

  if exists (
    select 1
    from examination_room_v1.result_releases r
    where r.grade_revision_id = new.grade_revision_id
      and r.release_action = 'release'
  ) then
    raise exception using
      errcode = '55000',
      message = 'released grade revision items are sealed';
  end if;

  select count(*)::integer
  into current_item_count
  from examination_room_v1.grade_revision_items i
  where i.grade_revision_id = new.grade_revision_id;

  if current_item_count >= expected_item_count then
    raise exception using
      errcode = '23514',
      message = 'grade item exceeds the declared item count';
  end if;

  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."protect_grade_revision_item_set"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."protect_grade_revision_item_set"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."protect_grade_revision_item_set"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.protect_professor_access_request_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.request_status <> 'pending' then
      raise exception using
        errcode = '55000',
        message = 'Professor access requests must begin in pending state';
    end if;
    new.updated_at = clock_timestamp();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.email_normalized is distinct from old.email_normalized
     or new.display_name is distinct from old.display_name
     or new.claimed_school_id is distinct from old.claimed_school_id
     or new.claimed_school_name is distinct from old.claimed_school_name
     or new.requested_institution_id is distinct from old.requested_institution_id
     or new.requested_at is distinct from old.requested_at then
    raise exception using
      errcode = '55000',
      message = 'Professor access request identity and school binding are immutable';
  end if;

  if old.request_status <> 'pending'
     or new.request_status not in ('approved', 'rejected', 'cancelled') then
    raise exception using
      errcode = '55000',
      message = 'Professor access request history cannot be reopened or rewritten';
  end if;

  if new.request_status = 'approved'
     and not exists (
       select 1
       from examination_room_v1.staff_memberships membership
       where membership.id = new.approved_membership_id
         and membership.institution_id = new.requested_institution_id
         and membership.user_id = new.user_id
         and membership.staff_role = 'professor'
         and membership.membership_status = 'active'
     ) then
    raise exception using
      errcode = '23514',
      message = 'Professor request approval must reference the active matching Professor membership';
  end if;

  new.updated_at = clock_timestamp();
  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."protect_professor_access_request_history"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."protect_professor_access_request_history"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."protect_professor_access_request_history"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.protect_published_question()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_version_id uuid;
begin
  if tg_op = 'UPDATE' and exists (
    select 1
    from examination_room_v1.exam_versions v
    where v.id = old.exam_version_id
      and v.publication_status = 'published'
  ) then
    raise exception using
      errcode = '55000',
      message = 'published exam questions are immutable';
  end if;

  if tg_op = 'DELETE' then
    target_version_id = old.exam_version_id;
  else
    target_version_id = new.exam_version_id;
  end if;

  if exists (
    select 1
    from examination_room_v1.exam_versions v
    where v.id = target_version_id
      and v.publication_status = 'published'
  ) then
    raise exception using
      errcode = '55000',
      message = 'published exam questions are immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."protect_published_question"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."protect_published_question"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."protect_published_question"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.protect_recovery_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.id is distinct from old.id
     or new.exam_id is distinct from old.exam_id
     or new.exam_version_id is distinct from old.exam_version_id
     or new.snapshot_sequence is distinct from old.snapshot_sequence
     or new.snapshot_scope is distinct from old.snapshot_scope
     or new.request_hash is distinct from old.request_hash
     or new.record_count is distinct from old.record_count
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_at is distinct from old.created_at
     or new.retention_until is distinct from old.retention_until
     or new.source_kind is distinct from old.source_kind
     or new.source_session_id is distinct from old.source_session_id
     or new.source_submission_id is distinct from old.source_submission_id
     or new.source_grade_revision_id is distinct from old.source_grade_revision_id
     or new.source_result_release_id is distinct from old.source_result_release_id then
    raise exception using
      errcode = '55000',
      message = 'recovery snapshot request evidence is immutable';
  end if;

  if old.snapshot_status in ('pending', 'failed')
     and new.snapshot_status = 'materializing'
     and new.materialization_attempts = old.materialization_attempts + 1 then
    return new;
  end if;

  if old.snapshot_status = 'materializing'
     and old.lease_expires_at < clock_timestamp()
     and new.snapshot_status = 'materializing'
     and new.materialization_attempts = old.materialization_attempts + 1 then
    return new;
  end if;

  if old.snapshot_status = 'materializing'
     and new.snapshot_status in ('available', 'failed') then
    return new;
  end if;

  if old.snapshot_status = 'failed'
     and new.snapshot_status = 'pending'
     and new.last_error_code is null
     and new.last_error_at is null then
    return new;
  end if;

  if old.snapshot_status = 'available'
     and new.snapshot_status in ('restoring', 'expired', 'superseded')
     and new.encrypted_object_reference = old.encrypted_object_reference
     and new.snapshot_sha256 = old.snapshot_sha256
     and new.encryption_key_reference = old.encryption_key_reference then
    return new;
  end if;

  if old.snapshot_status = 'restoring'
     and new.snapshot_status in ('available', 'restored')
     and new.encrypted_object_reference = old.encrypted_object_reference
     and new.snapshot_sha256 = old.snapshot_sha256
     and new.encryption_key_reference = old.encryption_key_reference then
    return new;
  end if;

  if to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'recovery snapshot state may advance only through claim, materialization, retry, verification, restore, or retention states';
  return null;
end;
$function$


ALTER FUNCTION "examination_room_v1"."protect_recovery_snapshot"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."protect_recovery_snapshot"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."protect_recovery_snapshot"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.protect_staff_membership_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.id is distinct from old.id
     or new.institution_id is distinct from old.institution_id
     or new.user_id is distinct from old.user_id
     or new.staff_role is distinct from old.staff_role
     or new.grant_reason is distinct from old.grant_reason
     or new.granted_by_user_id is distinct from old.granted_by_user_id
     or new.granted_at is distinct from old.granted_at then
    raise exception using
      errcode = '55000',
      message = 'staff membership grant identity is immutable';
  end if;

  if old.membership_status = new.membership_status
     and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return new;
  end if;

  if old.membership_status = 'active'
     and new.membership_status in ('suspended', 'revoked') then
    return new;
  end if;

  if old.membership_status = 'suspended'
     and new.membership_status = 'revoked' then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'staff membership history cannot be reactivated or rewritten; create a new grant row';
  return null;
end;
$function$


ALTER FUNCTION "examination_room_v1"."protect_staff_membership_history"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."protect_staff_membership_history"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."protect_staff_membership_history"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.protect_student_session_binding()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.id is distinct from old.id
     or new.activation_id is distinct from old.activation_id
     or new.exam_id is distinct from old.exam_id
     or new.institution_id is distinct from old.institution_id
     or new.exam_version_id is distinct from old.exam_version_id
     or new.roster_id is distinct from old.roster_id
     or new.consent_request_hash is distinct from old.consent_request_hash
     or new.client_instance_id is distinct from old.client_instance_id
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'student session identity and consent binding are immutable';
  end if;

  -- A fresh bearer credential may be issued after the current room key and
  -- exact roster identity are re-verified. Immutable answer revisions stay
  -- untouched, and credential rotation is forbidden once any submission exists.
  if new.session_token_hash is distinct from old.session_token_hash
     and not (
       old.session_status in ('created', 'active')
       and new.session_status = old.session_status
       and not exists (
         select 1
         from examination_room_v1.submissions sub
         where sub.session_id = old.id
       )
     ) then
    raise exception using
      errcode = '55000',
      message = 'student session tokens can rotate only for unfinished active sessions';
  end if;

  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."protect_student_session_binding"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."protect_student_session_binding"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."protect_student_session_binding"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.protect_submission_answer_set()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  expected_answer_count integer;
  current_answer_count integer;
begin
  if tg_op <> 'INSERT' then
    raise exception using
      errcode = '55000',
      message = 'submission answer mappings are append-only';
  end if;

  select s.answer_count
  into expected_answer_count
  from examination_room_v1.submissions s
  where s.id = new.submission_id
  for update;

  if expected_answer_count is null then
    raise exception using
      errcode = '23503',
      message = 'submission answer mapping references an unknown submission';
  end if;

  if exists (
    select 1
    from examination_room_v1.submission_receipts r
    where r.submission_id = new.submission_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'submission answer set is sealed by its receipt';
  end if;

  select count(*)::integer
  into current_answer_count
  from examination_room_v1.submission_answers a
  where a.submission_id = new.submission_id;

  if current_answer_count >= expected_answer_count then
    raise exception using
      errcode = '23514',
      message = 'submission answer mapping exceeds the declared answer count';
  end if;

  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."protect_submission_answer_set"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."protect_submission_answer_set"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."protect_submission_answer_set"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.queue_grading_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  exam_id uuid;
  exam_version_id uuid;
  grade_revision_id uuid;
  result_release_id uuid;
  request_hash text;
  record_count bigint;
  actor_user_id uuid;
  release_batch_hash text := nullif(current_setting('examination_room_v1.release_batch_request_hash', true), '');
  release_batch_count integer := coalesce(
    nullif(current_setting('examination_room_v1.release_batch_count', true), '')::integer,
    0
  );
begin
  if tg_table_name = 'grade_revisions' then
    if new.grade_status not in ('final', 'corrected') then
      return new;
    end if;
    if release_batch_hash ~ '^[0-9a-f]{64}$' then
      return new;
    end if;
    grade_revision_id := new.id;
    exam_version_id := new.exam_version_id;
    actor_user_id := new.grader_user_id;
    select session.exam_id into exam_id
    from examination_room_v1.submissions submission
    join examination_room_v1.student_sessions session on session.id = submission.session_id
    where submission.id = new.submission_id;
    request_hash := encode(sha256(convert_to('grade-revision:' || new.id::text, 'UTF8')), 'hex');
  else
    result_release_id := new.id;
    grade_revision_id := new.grade_revision_id;
    actor_user_id := new.performed_by_user_id;
    select session.exam_id, submission.exam_version_id into exam_id, exam_version_id
    from examination_room_v1.submissions submission
    join examination_room_v1.student_sessions session on session.id = submission.session_id
    where submission.id = new.submission_id;
    request_hash := case
      when new.batch_request_hash ~ '^[0-9a-f]{64}$' then new.batch_request_hash
      else encode(sha256(convert_to('result-release:' || new.id::text, 'UTF8')), 'hex')
    end;
  end if;

  select 1
    + (select count(*) from examination_room_v1.grade_revisions grade where grade.submission_id = new.submission_id)
    + (select count(*) from examination_room_v1.grade_revision_items item
       join examination_room_v1.grade_revisions grade on grade.id = item.grade_revision_id
       where grade.submission_id = new.submission_id)
    + (select count(*) from examination_room_v1.result_releases release where release.submission_id = new.submission_id)
  into record_count;
  if tg_table_name = 'result_releases' then
    if new.batch_request_hash ~ '^[0-9a-f]{64}$' then
      record_count := greatest(record_count, release_batch_count);
    end if;
  end if;

  insert into examination_room_v1.recovery_snapshots (
    exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
    record_count, snapshot_status, created_by_user_id, retention_until,
    source_kind, source_grade_revision_id, source_result_release_id
  ) values (
    exam_id, exam_version_id, examination_room_v1.next_snapshot_sequence(exam_id),
    'grading_state', request_hash, record_count, 'pending',
    actor_user_id,
    clock_timestamp() + interval '365 days',
    case when tg_table_name = 'grade_revisions' then 'grade_revision' else 'result_release' end,
    grade_revision_id, result_release_id
  ) on conflict on constraint recovery_snapshots_request_hash_key do nothing;
  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."queue_grading_snapshot"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."queue_grading_snapshot"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."queue_grading_snapshot"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.recover_existing_student_session(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_session_id uuid;
  v_exam_id uuid;
  v_exam_version_id uuid;
  v_institution_id uuid;
  v_roster_id uuid;
  v_session_status text;
  v_started_at timestamptz;
  v_lease_expires_at timestamptz;
  v_publication_manifest jsonb;
  v_publication_hash text;
  v_grading_alias text;
  v_request_hash text := p_payload ->> 'requestHash';
  v_session_token_hash text := p_payload ->> 'sessionTokenHash';
  v_client_event_id uuid := nullif(p_payload ->> 'clientEventId', '')::uuid;
  v_response jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or coalesce(p_payload ->> 'roomKeyHash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(v_request_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(v_session_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return examination_room_v1.api_error(
      'SESSION_RECOVERY_INVALID',
      'The saved examination could not be reconnected safely.',
      400,
      'Return to the join page, enter the same room key and student details, then try again.'
    );
  end if;

  select
    s.id,
    s.exam_id,
    s.exam_version_id,
    s.institution_id,
    s.roster_id,
    s.session_status,
    s.started_at,
    s.lease_expires_at,
    v.publication_manifest,
    v.content_sha256,
    er.grading_alias
  into
    v_session_id,
    v_exam_id,
    v_exam_version_id,
    v_institution_id,
    v_roster_id,
    v_session_status,
    v_started_at,
    v_lease_expires_at,
    v_publication_manifest,
    v_publication_hash,
    v_grading_alias
  from examination_room_v1.room_activations a
  join examination_room_v1.student_sessions s
    on s.activation_id = a.id
  join examination_room_v1.exam_roster er
    on er.id = s.roster_id
   and er.exam_id = s.exam_id
   and er.institution_id = s.institution_id
  join examination_room_v1.student_identities si
    on si.id = er.student_identity_id
  join examination_room_v1.exam_versions v
    on v.id = s.exam_version_id
  where a.key_hash = p_payload ->> 'roomKeyHash'
    and a.activation_status = 'open'
    and a.closes_at > clock_timestamp()
    and s.session_status in ('created', 'active')
    and upper(si.external_student_id) = upper(p_payload #>> '{identity,studentNumber}')
    and lower(btrim(si.full_name)) = lower(btrim(p_payload #>> '{identity,realName}'))
    and lower(btrim(er.accommodations ->> 'subject')) = lower(btrim(p_payload #>> '{identity,subject}'))
    and lower(btrim(er.accommodations ->> 'yearLevel')) = lower(btrim(p_payload #>> '{identity,yearLevel}'))
    and not exists (
      select 1
      from examination_room_v1.submissions sub
      where sub.session_id = s.id
    )
  order by s.started_at desc
  limit 1
  for update of s;

  if v_session_id is null then
    return examination_room_v1.api_error(
      'SESSION_ALREADY_EXISTS',
      'A session already exists for this student and room, but it could not be safely resumed.',
      409,
      'Use the same room key and exact student details. If this continues, ask the professor to review the session.'
    );
  end if;

  update examination_room_v1.student_sessions s
  set session_token_hash = v_session_token_hash,
      last_heartbeat_at = greatest(coalesce(s.last_heartbeat_at, s.started_at), clock_timestamp()),
      updated_at = clock_timestamp()
  where s.id = v_session_id;

  v_response := jsonb_build_object(
    'ok', true,
    'resumed', true,
    'session', jsonb_build_object(
      'id', v_session_id,
      'status', v_session_status,
      'startedAt', v_started_at,
      'leaseExpiresAt', v_lease_expires_at,
      'anonymousCandidateId', v_grading_alias
    ),
    'publicationManifest', v_publication_manifest,
    'publicationHash', v_publication_hash
  );

  perform examination_room_v1.api_record_audit(
    v_institution_id,
    v_exam_id,
    v_session_id,
    null,
    'student',
    'student.session_recovered',
    'student_session',
    v_session_id,
    v_request_hash,
    clock_timestamp(),
    v_response,
    v_client_event_id
  );

  return v_response;
end;
$function$


ALTER FUNCTION "examination_room_v1"."recover_existing_student_session"(p_payload jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."recover_existing_student_session"(p_payload jsonb) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."recover_existing_student_session"(p_payload jsonb) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.seal_exam_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'DELETE' and old.publication_status = 'building' then
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.publication_status = 'building'
     and new.id = old.id
     and new.exam_id = old.exam_id
     and new.institution_id = old.institution_id
     and new.version_number = old.version_number
     and new.created_at = old.created_at then
    if new.publication_status = 'building' then
      return new;
    end if;

    if new.publication_status = 'published'
       and (
         to_jsonb(new)
           - 'publication_status'
           - 'published_by_user_id'
           - 'published_at'
           - 'publication_manifest'
           - 'content_sha256'
       ) = (
         to_jsonb(old)
           - 'publication_status'
           - 'published_by_user_id'
           - 'published_at'
           - 'publication_manifest'
           - 'content_sha256'
       ) then
      return new;
    end if;
  end if;

  raise exception using
    errcode = '55000',
    message = 'examination_room_v1.exam_versions is immutable except for its one-way publication seal';
  return null;
end;
$function$


ALTER FUNCTION "examination_room_v1"."seal_exam_version"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."seal_exam_version"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."seal_exam_version"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.set_snapshot_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.source_kind is null then
    new.source_kind := case new.snapshot_scope
      when 'exam_definition' then 'publication'
      when 'answer_state' then 'submission'
      when 'grading_state' then 'grade_revision'
      else 'manual'
    end;
  end if;
  if new.snapshot_scope = 'answer_state' and new.source_submission_id is null then
    select submission.id, submission.session_id
    into new.source_submission_id, new.source_session_id
    from examination_room_v1.submissions submission
    where submission.idempotency_key_hash = new.request_hash;
  end if;
  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."set_snapshot_source"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."set_snapshot_source"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."set_snapshot_source"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."touch_updated_at"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."touch_updated_at"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."touch_updated_at"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.uuid_from_hash(p_hash text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
  select (
    substr(p_hash, 1, 8) || '-' ||
    substr(p_hash, 9, 4) || '-' ||
    '4' || substr(p_hash, 14, 3) || '-' ||
    '8' || substr(p_hash, 18, 3) || '-' ||
    substr(p_hash, 21, 12)
  )::uuid;
$function$


ALTER FUNCTION "examination_room_v1"."uuid_from_hash"(p_hash text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."uuid_from_hash"(p_hash text) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."uuid_from_hash"(p_hash text) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.valid_allowed_emails(p_emails text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_emails is not null
    and cardinality(p_emails) <= 5000
    and array_position(p_emails, null) is null
    and not exists (
      select 1
      from unnest(p_emails) email_value
      where email_value <> lower(btrim(email_value))
        or length(email_value) not between 3 and 320
        or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
    and cardinality(p_emails) = (
      select count(distinct email_value)::integer from unnest(p_emails) email_value
    );
$function$


ALTER FUNCTION "examination_room_v1"."valid_allowed_emails"(p_emails text[]) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."valid_allowed_emails"(p_emails text[]) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."valid_allowed_emails"(p_emails text[]) TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.validate_exam_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'UPDATE'
     and (new.owner_user_id is distinct from old.owner_user_id
       or new.institution_id is distinct from old.institution_id) then
    raise exception using
      errcode = '55000',
      message = 'examination owner and workspace are immutable after creation';
  end if;
  if not examination_room_v1.creator_authorized(
    new.owner_user_id,
    new.institution_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'exam owner must be a verified account in an active examination workspace';
  end if;
  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."validate_exam_owner"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."validate_exam_owner"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."validate_exam_owner"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.validate_privacy_acceptance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.decision = 'withdrawn'
     and (
       new.prior_acceptance_id = new.id
       or not exists (
         select 1
         from examination_room_v1.privacy_acceptances prior
         where prior.id = new.prior_acceptance_id
           and prior.roster_id = new.roster_id
           and prior.notice_version_id = new.notice_version_id
           and prior.session_id = new.session_id
           and prior.exam_version_id = new.exam_version_id
           and prior.decision = 'accepted'
           and prior.recorded_at < new.recorded_at
           and prior.created_at <= new.created_at
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'a withdrawal must reference an earlier accepted event for the same session and notice';
  end if;

  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."validate_privacy_acceptance"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."validate_privacy_acceptance"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."validate_privacy_acceptance"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.validate_room_activation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if not exists (
    select 1
    from examination_room_v1.exam_versions v
    where v.id = new.exam_version_id
      and v.exam_id = new.exam_id
      and v.institution_id = new.institution_id
      and v.publication_status = 'published'
  ) then
    raise exception using
      errcode = '23514',
      message = 'room activations must reference a sealed published exam version';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.exam_id is distinct from old.exam_id
       or new.institution_id is distinct from old.institution_id
       or new.exam_version_id is distinct from old.exam_version_id
       or new.request_hash is distinct from old.request_hash
       or new.key_hash_algorithm is distinct from old.key_hash_algorithm
       or new.activated_by_user_id is distinct from old.activated_by_user_id
       or new.created_at is distinct from old.created_at then
      raise exception using
        errcode = '55000',
        message = 'room activation identity and request binding are immutable';
    end if;

    if new.key_hash is distinct from old.key_hash
       and not (
         old.activation_status = 'scheduled'
         and new.activation_status = 'scheduled'
         and not exists (
           select 1
           from examination_room_v1.student_sessions s
           where s.activation_id = old.id
         )
       ) then
      raise exception using
        errcode = '55000',
        message = 'an issued room-key verifier can rotate only before the room opens or any session exists';
    end if;
  end if;

  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."validate_room_activation"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."validate_room_activation"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."validate_room_activation"() TO "postgres";

CREATE OR REPLACE FUNCTION examination_room_v1.validate_submission_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  expected_answer_count integer;
  current_answer_count integer;
begin
  select s.answer_count
  into expected_answer_count
  from examination_room_v1.submissions s
  where s.id = new.submission_id
  for update;

  select count(*)::integer
  into current_answer_count
  from examination_room_v1.submission_answers a
  where a.submission_id = new.submission_id;

  if expected_answer_count is null or current_answer_count <> expected_answer_count then
    raise exception using
      errcode = '23514',
      message = 'a receipt requires the complete declared submission answer set';
  end if;

  return new;
end;
$function$


ALTER FUNCTION "examination_room_v1"."validate_submission_receipt"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "examination_room_v1"."validate_submission_receipt"() FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "examination_room_v1"."validate_submission_receipt"() TO "postgres";

CREATE OR REPLACE FUNCTION public.examination_room_v1_api(p_scope text, p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_variable
declare
  safe_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  exam_id uuid;
  admission_result jsonb;
  student_result jsonb;
begin
  if p_scope is null
     or p_operation is null
     or (p_scope <> 'student' and p_institution_id is null)
     or jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'Scope, operation, an object payload, and workspace for creator views are required.', 400,
      'Refresh Examination Room and try again.'
    );
  end if;

  if safe_payload::text ~* '"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)"[[:space:]]*:' then
    return examination_room_v1.api_error(
      'RAW_SECRET_REJECTED', 'Only one-way hashes or opaque identifiers may reach examination persistence.', 400,
      'Refresh the page and repeat the action without raw credentials.'
    );
  end if;

  if not (
    (p_scope = 'professor' and p_operation in (
      'session', 'exam', 'monitor', 'grading', 'grading_context', 'release_context',
      'save_draft', 'publish', 'open_room', 'close_room', 'revoke_session',
      'save_grade', 'release_results'
    ))
    or (p_scope = 'student' and p_operation in (
      'preview', 'consent', 'resume', 'result', 'session_context', 'save_answer',
      'record_event', 'heartbeat', 'submission_intent', 'submit'
    ))
    or (p_scope = 'admin' and p_operation in (
      'overview', 'activate_exam', 'email_key', 'revoke_key', 'create_snapshot'
    ))
  ) then
    return examination_room_v1.api_error(
      'UNKNOWN_OPERATION', 'The requested Examination Room operation is not registered.', 400,
      'Refresh Examination Room and choose a listed action.'
    );
  end if;

  if p_scope = 'professor' then
    if not examination_room_v1.creator_authorized(p_actor_user_id, p_institution_id) then
      return examination_room_v1.api_error(
        'CREATOR_WORKSPACE_REQUIRED', 'A verified account and active law-school workspace are required.', 403,
        'Sign in, choose an active workspace, then retry.'
      );
    end if;
    if p_operation in ('monitor', 'grading') then
      exam_id := nullif(safe_payload ->> 'examId', '')::uuid;
      return examination_room_v1.api_professor_view(
        p_operation, p_actor_user_id, p_institution_id, exam_id
      );
    end if;
    if p_operation = 'revoke_session' then
      return examination_room_v1.creator_revoke_session(
        p_actor_user_id, p_institution_id, safe_payload
      );
    end if;
    return examination_room_v1.api_professor(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  elsif p_scope = 'admin' then
    if not examination_room_v1.owner_authorized(p_actor_user_id)
       or not exists (
         select 1 from examination_room_v1.institutions institution
         where institution.id = p_institution_id
           and institution.institution_status = 'active'
       ) then
      return examination_room_v1.api_error(
        'PLATFORM_OWNER_REQUIRED', 'Only a Founder or Super Admin may use examination administration.', 403,
        'Sign in with a platform-owner account.'
      );
    end if;
    return examination_room_v1.api_admin(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  end if;

  if p_operation in ('preview', 'consent') then
    admission_result := examination_room_v1.prepare_student_admission(safe_payload);
    if admission_result ->> 'ok' = 'false' then return admission_result; end if;
    safe_payload := jsonb_set(
      safe_payload,
      '{identity}',
      admission_result -> 'identity',
      true
    );
  end if;

  student_result := examination_room_v1.api_student(p_operation, safe_payload);

  if p_operation = 'consent'
     and student_result #>> '{error,code}' = 'SESSION_ALREADY_EXISTS' then
    return examination_room_v1.recover_existing_student_session(safe_payload);
  end if;

  return student_result;
exception
  when invalid_text_representation or datetime_field_overflow then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'A supplied identifier, number, or timestamp is invalid.', 400,
      'Refresh the page, correct the highlighted value, and try again.'
    );
  when unique_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_CONFLICT', 'A newer or duplicate record already exists for this action.', 409,
      'Refresh the current server-backed state, then repeat the action only if still needed.'
    );
  when foreign_key_violation or check_violation or not_null_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_STATE_INVALID', 'The action does not match the current immutable examination state.', 409,
      'Refresh the examination and retry from the latest saved state.'
    );
  when object_not_in_prerequisite_state then
    return examination_room_v1.api_error(
      'IMMUTABLE_RECORD_SEALED', 'That evidence record is already sealed and cannot be changed.', 409,
      'Refresh the view and create a new revision instead of overwriting sealed evidence.'
    );
  when serialization_failure or deadlock_detected then
    return examination_room_v1.api_error(
      'RETRY_REQUIRED', 'Another examination action completed at the same time.', 409,
      'Refresh the current state and retry the action once.'
    );
  when others then
    return examination_room_v1.api_error(
      'PERSISTENCE_INTERNAL_ERROR', 'The database could not complete the examination action safely.', 500,
      'Your prior server-backed work is preserved. Try again; if it continues, contact support.'
    );
end;
$function$


ALTER FUNCTION "public"."examination_room_v1_api"(p_scope text, p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."examination_room_v1_api"(p_scope text, p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "public"."examination_room_v1_api"(p_scope text, p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."examination_room_v1_api"(p_scope text, p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb) TO "service_role";

CREATE OR REPLACE FUNCTION public.examination_room_v1_lifecycle_guard(p_exam_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when exam.id is null then examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'That examination is no longer available.', 404,
      'Ask the examination creator or administrator for the current room key.'
    )
    when exam.deleted_at is not null then examination_room_v1.api_error(
      'EXAMINATION_ARCHIVED', 'This examination is not accepting new students.', 409,
      'Ask the examination creator or administrator to restore the room or provide another key.'
    )
    when exam.blocked_at is not null then examination_room_v1.api_error(
      'EXAMINATION_BLOCKED', 'This examination is temporarily blocked by the administrator.', 409,
      'Wait for the administrator to reopen admission, then enter the same key again.'
    )
    else jsonb_build_object('ok', true, 'examId', exam.id)
  end
  from (select p_exam_id as requested_id) requested
  left join examination_room_v1.exams exam on exam.id = requested.requested_id;
$function$


ALTER FUNCTION "public"."examination_room_v1_lifecycle_guard"(p_exam_id uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."examination_room_v1_lifecycle_guard"(p_exam_id uuid) FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT EXECUTE ON FUNCTION "public"."examination_room_v1_lifecycle_guard"(p_exam_id uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."examination_room_v1_lifecycle_guard"(p_exam_id uuid) TO "service_role";

SET LOCAL check_function_bodies = on;

-- Install all captured constraints, including function-backed checks.

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_answer_format_check" CHECK (answer_format = ANY (ARRAY['rich_text'::text, 'plain_text'::text, 'choice'::text, 'boolean'::text, 'file_reference'::text]));

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_answer_payload_check" CHECK (jsonb_typeof(answer_payload) = 'object'::text);

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_answer_sha256_check" CHECK (answer_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_clock_skew_check" CHECK (saved_at <= (received_at + '24:00:00'::interval));

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_id_session_question_key" UNIQUE (id, session_id, question_id);

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_idempotency_key_hash_check" CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_idempotency_key_hash_key" UNIQUE (idempotency_key_hash);

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_revision_number_check" CHECK (revision_number > 0);

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_session_client_key" UNIQUE (session_id, client_revision_id);

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_session_question_number_key" UNIQUE (session_id, question_id, revision_number);

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_source_check" CHECK (source = ANY (ARRAY['autosave'::text, 'manual_save'::text, 'recovery'::text, 'submission'::text]));

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_word_count_check" CHECK (word_count IS NULL OR word_count >= 0);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_actor_role_check" CHECK (actor_role = ANY (ARRAY['professor'::text, 'admin'::text, 'student'::text, 'system'::text, 'service'::text]));

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_event_data_check" CHECK (jsonb_typeof(event_data) = 'object'::text AND event_data::text !~* '"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)"[[:space:]]*:'::text);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_event_hash_check" CHECK (event_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_event_type_check" CHECK (length(btrim(event_type)) >= 1 AND length(btrim(event_type)) <= 120);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_institution_hash_key" UNIQUE (institution_id, event_hash);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_institution_request_key" UNIQUE (institution_id, request_hash);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_ip_hash_check" CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_previous_event_hash_check" CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_request_hash_check" CHECK (request_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_session_requires_exam_check" CHECK (session_id IS NULL OR exam_id IS NOT NULL);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_subject_type_check" CHECK (length(btrim(subject_type)) >= 1 AND length(btrim(subject_type)) <= 80);

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_user_agent_hash_check" CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_delivery_kind_check" CHECK (delivery_kind = ANY (ARRAY['activation_key'::text, 'key_resend'::text, 'key_rotation'::text]));

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_owner_copy_recipients_check" CHECK (jsonb_typeof(owner_copy_recipients) = 'array'::text);

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_professor_recipient_check" CHECK (professor_recipient IS NULL OR professor_recipient = lower(btrim(professor_recipient)) AND POSITION(('@'::text) IN (professor_recipient)) > 1 AND length(professor_recipient) >= 3 AND length(professor_recipient) <= 320);

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_provider_id_check" CHECK (provider_id IS NULL OR length(provider_id) >= 1 AND length(provider_id) <= 240);

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_provider_status_check" CHECK (provider_status = ANY (ARRAY['sent'::text, 'suppressed'::text, 'not_configured'::text, 'failed'::text]));

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_request_hash_check" CHECK (request_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_request_hash_key" UNIQUE (request_hash);

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_safe_error_code_check" CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[a-z0-9_]{2,80}$'::text);

ALTER TABLE "examination_room_v1"."exam_roster" ADD CONSTRAINT "exam_roster_accommodations_check" CHECK (jsonb_typeof(accommodations) = 'object'::text);

ALTER TABLE "examination_room_v1"."exam_roster" ADD CONSTRAINT "exam_roster_exam_student_key" UNIQUE (exam_id, student_identity_id);

ALTER TABLE "examination_room_v1"."exam_roster" ADD CONSTRAINT "exam_roster_grading_alias_check" CHECK (grading_alias IS NULL OR length(btrim(grading_alias)) >= 1 AND length(btrim(grading_alias)) <= 80);

ALTER TABLE "examination_room_v1"."exam_roster" ADD CONSTRAINT "exam_roster_id_exam_institution_key" UNIQUE (id, exam_id, institution_id);

ALTER TABLE "examination_room_v1"."exam_roster" ADD CONSTRAINT "exam_roster_id_exam_key" UNIQUE (id, exam_id);

ALTER TABLE "examination_room_v1"."exam_roster" ADD CONSTRAINT "exam_roster_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."exam_roster" ADD CONSTRAINT "exam_roster_roster_status_check" CHECK (roster_status = ANY (ARRAY['invited'::text, 'eligible'::text, 'withdrawn'::text, 'completed'::text]));

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_admission_mode_check" CHECK (admission_mode_snapshot = ANY (ARRAY['key_only'::text, 'email_allowlist'::text]));

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_allowed_emails_check" CHECK (examination_room_v1.valid_allowed_emails(allowed_emails_snapshot));

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_content_sha256_check" CHECK (content_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_controls_check" CHECK (jsonb_typeof(controls) = 'object'::text);

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_duration_seconds_check" CHECK (duration_seconds >= 60 AND duration_seconds <= 86400);

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_exam_version_key" UNIQUE (exam_id, version_number);

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_id_exam_institution_key" UNIQUE (id, exam_id, institution_id);

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_id_exam_key" UNIQUE (id, exam_id);

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_id_notice_key" UNIQUE (id, privacy_notice_version_id);

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_publication_manifest_check" CHECK (jsonb_typeof(publication_manifest) = 'object'::text);

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_publication_state_check" CHECK (publication_status = 'building'::text AND published_by_user_id IS NULL AND published_at IS NULL AND publication_manifest = '{}'::jsonb OR publication_status = 'published'::text AND published_by_user_id IS NOT NULL AND published_at IS NOT NULL AND published_at >= created_at AND (publication_manifest ->> 'schemaVersion'::text) = 'examination-room/publication/v1'::text);

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_publication_status_check" CHECK (publication_status = ANY (ARRAY['building'::text, 'published'::text]));

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_title_snapshot_check" CHECK (length(btrim(title_snapshot)) >= 1 AND length(btrim(title_snapshot)) <= 300);

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_version_number_check" CHECK (version_number > 0);

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_admission_mode_check" CHECK (admission_mode = ANY (ARRAY['key_only'::text, 'email_allowlist'::text]));

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_allowed_emails_check" CHECK (examination_room_v1.valid_allowed_emails(allowed_emails));

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_block_state_check" CHECK (blocked_at IS NULL AND blocked_by_user_id IS NULL AND block_reason IS NULL OR blocked_at IS NOT NULL AND blocked_by_user_id IS NOT NULL AND NULLIF(btrim(block_reason), ''::text) IS NOT NULL);

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_delete_state_check" CHECK (deleted_at IS NULL AND deleted_by_user_id IS NULL AND delete_reason IS NULL OR deleted_at IS NOT NULL AND deleted_by_user_id IS NOT NULL AND NULLIF(btrim(delete_reason), ''::text) IS NOT NULL);

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_id_institution_key" UNIQUE (id, institution_id);

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_lifecycle_prior_status_check" CHECK (lifecycle_prior_status IS NULL OR (lifecycle_prior_status = ANY (ARRAY['draft'::text, 'published'::text, 'closed'::text, 'archived'::text])));

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_lifecycle_timestamps_check" CHECK ((closed_at IS NULL OR closed_at >= created_at) AND (archived_at IS NULL OR archived_at >= created_at));

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_publish_state_check" CHECK (status = 'draft'::text AND current_published_version_id IS NULL OR status <> 'draft'::text AND current_published_version_id IS NOT NULL);

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'closed'::text, 'archived'::text]));

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_title_check" CHECK (length(btrim(title)) >= 1 AND length(btrim(title)) <= 300);

ALTER TABLE "examination_room_v1"."grade_revision_items" ADD CONSTRAINT "grade_revision_items_check" CHECK (maximum_score >= 0::numeric AND score <= maximum_score);

ALTER TABLE "examination_room_v1"."grade_revision_items" ADD CONSTRAINT "grade_revision_items_pkey" PRIMARY KEY (grade_revision_id, question_id);

ALTER TABLE "examination_room_v1"."grade_revision_items" ADD CONSTRAINT "grade_revision_items_rubric_marks_check" CHECK (jsonb_typeof(rubric_marks) = 'object'::text);

ALTER TABLE "examination_room_v1"."grade_revision_items" ADD CONSTRAINT "grade_revision_items_score_check" CHECK (score >= 0::numeric);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_check" CHECK (maximum_score >= 0::numeric AND total_score <= maximum_score);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_grade_status_check" CHECK (grade_status = ANY (ARRAY['draft'::text, 'final'::text, 'corrected'::text]));

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_grading_manifest_check" CHECK (jsonb_typeof(grading_manifest) = 'object'::text AND (grading_manifest ->> 'schemaVersion'::text) = 'examination-room/grading/v1'::text);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_id_submission_key" UNIQUE (id, submission_id);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_id_version_key" UNIQUE (id, exam_version_id);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_item_count_check" CHECK (item_count >= 0);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_manifest_sha256_check" CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_revision_number_check" CHECK (revision_number > 0);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_rubric_snapshot_check" CHECK (jsonb_typeof(rubric_snapshot) = 'object'::text);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_source_check" CHECK (source = ANY (ARRAY['online'::text, 'offline_import'::text, 'recovery'::text]));

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_submission_client_key" UNIQUE (submission_id, client_revision_id);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_submission_revision_key" UNIQUE (submission_id, revision_number);

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_total_score_check" CHECK (total_score >= 0::numeric);

ALTER TABLE "examination_room_v1"."institutions" ADD CONSTRAINT "institutions_bootstrap_request_hash_check" CHECK (bootstrap_request_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."institutions" ADD CONSTRAINT "institutions_bootstrap_request_hash_key" UNIQUE (bootstrap_request_hash);

ALTER TABLE "examination_room_v1"."institutions" ADD CONSTRAINT "institutions_institution_code_check" CHECK (institution_code = lower(btrim(institution_code)) AND institution_code ~ '^[a-z0-9][a-z0-9._-]{1,63}$'::text);

ALTER TABLE "examination_room_v1"."institutions" ADD CONSTRAINT "institutions_institution_code_key" UNIQUE (institution_code);

ALTER TABLE "examination_room_v1"."institutions" ADD CONSTRAINT "institutions_institution_name_check" CHECK (length(btrim(institution_name)) >= 2 AND length(btrim(institution_name)) <= 240);

ALTER TABLE "examination_room_v1"."institutions" ADD CONSTRAINT "institutions_institution_status_check" CHECK (institution_status = ANY (ARRAY['active'::text, 'suspended'::text]));

ALTER TABLE "examination_room_v1"."institutions" ADD CONSTRAINT "institutions_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."institutions" ADD CONSTRAINT "institutions_profile_school_id_check" CHECK (profile_school_id = lower(btrim(profile_school_id)) AND profile_school_id ~ '^[a-z0-9][a-z0-9-]{1,179}$'::text);

ALTER TABLE "examination_room_v1"."institutions" ADD CONSTRAINT "institutions_profile_school_id_key" UNIQUE (profile_school_id);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_artifact_kind_check" CHECK (artifact_kind = ANY (ARRAY['camera_chunk'::text, 'microphone_chunk'::text, 'screen_chunk'::text, 'still_image'::text]));

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_capture_window_check" CHECK (captured_to >= captured_from AND captured_to <= (captured_from + '00:15:00'::interval) AND retention_until > captured_to);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_completion_request_hash_check" CHECK (completion_request_hash IS NULL OR completion_request_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_encrypted_size_bytes_check" CHECK (encrypted_size_bytes >= 1 AND encrypted_size_bytes <= 67108864);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_intent_status_check" CHECK (intent_status = ANY (ARRAY['prepared'::text, 'local_queue'::text, 'completed'::text]));

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_object_sha256_check" CHECK (object_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_provider_check" CHECK (provider = ANY (ARRAY['google_drive'::text, 'supabase_storage'::text, 'local_queue'::text]));

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_provider_object_reference_check" CHECK (length(btrim(provider_object_reference)) >= 8 AND length(btrim(provider_object_reference)) <= 1024 AND provider_object_reference !~* '(token|secret|authorization|credential|password)='::text AND provider_object_reference !~* '^https?://'::text);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_provider_result_check" CHECK (jsonb_typeof(provider_result) = 'object'::text AND provider_result::text !~* '"(url|token|secret|authorization|credential|password|accessToken|refreshToken|signedUrl)"[[:space:]]*:'::text);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_request_hash_check" CHECK (request_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_session_artifact_key" UNIQUE (session_id, client_artifact_id);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_session_request_key" UNIQUE (session_id, request_hash);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_source_mime_type_check" CHECK (length(btrim(source_mime_type)) >= 3 AND length(btrim(source_mime_type)) <= 160);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_status_check" CHECK (intent_status = 'completed'::text AND artifact_id IS NOT NULL AND completion_request_hash IS NOT NULL AND completed_at IS NOT NULL OR intent_status <> 'completed'::text AND artifact_id IS NULL AND completed_at IS NULL);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_wrapped_key_aad_sha256_check" CHECK (wrapped_key_aad_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_wrapped_key_algorithm_check" CHECK (wrapped_key_algorithm = 'aes-256-gcm-v1'::text);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_wrapped_key_ciphertext_check" CHECK (length(wrapped_key_ciphertext) >= 43 AND length(wrapped_key_ciphertext) <= 128 AND wrapped_key_ciphertext ~ '^[A-Za-z0-9_-]+$'::text);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_wrapped_key_iv_check" CHECK (length(wrapped_key_iv) >= 16 AND length(wrapped_key_iv) <= 32 AND wrapped_key_iv ~ '^[A-Za-z0-9_-]+$'::text);

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_wrapped_key_version_check" CHECK (wrapped_key_version = 1);

ALTER TABLE "examination_room_v1"."owner_identity_corrections" ADD CONSTRAINT "owner_identity_corrections_after_record_check" CHECK (jsonb_typeof(after_record) = 'object'::text);

ALTER TABLE "examination_room_v1"."owner_identity_corrections" ADD CONSTRAINT "owner_identity_corrections_before_record_check" CHECK (jsonb_typeof(before_record) = 'object'::text);

ALTER TABLE "examination_room_v1"."owner_identity_corrections" ADD CONSTRAINT "owner_identity_corrections_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."owner_identity_corrections" ADD CONSTRAINT "owner_identity_corrections_reason_check" CHECK (length(btrim(reason)) >= 1 AND length(btrim(reason)) <= 1000);

ALTER TABLE "examination_room_v1"."owner_identity_corrections" ADD CONSTRAINT "owner_identity_corrections_request_hash_check" CHECK (request_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."owner_identity_corrections" ADD CONSTRAINT "owner_identity_corrections_request_hash_key" UNIQUE (request_hash);

ALTER TABLE "examination_room_v1"."owner_key_envelopes" ADD CONSTRAINT "owner_key_envelopes_aad_sha256_check" CHECK (aad_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."owner_key_envelopes" ADD CONSTRAINT "owner_key_envelopes_ciphertext_base64_check" CHECK (length(ciphertext_base64) >= 24 AND length(ciphertext_base64) <= 4096);

ALTER TABLE "examination_room_v1"."owner_key_envelopes" ADD CONSTRAINT "owner_key_envelopes_envelope_algorithm_check" CHECK (envelope_algorithm = 'aes-256-gcm-v1'::text);

ALTER TABLE "examination_room_v1"."owner_key_envelopes" ADD CONSTRAINT "owner_key_envelopes_iv_base64_check" CHECK (length(iv_base64) >= 16 AND length(iv_base64) <= 64);

ALTER TABLE "examination_room_v1"."owner_key_envelopes" ADD CONSTRAINT "owner_key_envelopes_key_version_check" CHECK (key_version > 0);

ALTER TABLE "examination_room_v1"."owner_key_envelopes" ADD CONSTRAINT "owner_key_envelopes_pkey" PRIMARY KEY (activation_id);

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_accepted_features_check" CHECK (jsonb_typeof(accepted_features) = 'object'::text);

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_capture_method_check" CHECK (capture_method = ANY (ARRAY['checkbox'::text, 'signed_notice'::text, 'admin_recorded'::text]));

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_decision_check" CHECK (decision = ANY (ARRAY['accepted'::text, 'withdrawn'::text]));

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_evidence_sha256_check" CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_id_subject_key" UNIQUE (id, roster_id, notice_version_id, session_id, exam_version_id);

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_prior_required_check" CHECK (decision = 'accepted'::text AND prior_acceptance_id IS NULL OR decision = 'withdrawn'::text AND prior_acceptance_id IS NOT NULL);

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_session_event_key" UNIQUE (session_id, client_event_id);

ALTER TABLE "examination_room_v1"."privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_body_sha256_check" CHECK (body_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_id_institution_key" UNIQUE (id, institution_id);

ALTER TABLE "examination_room_v1"."privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_institution_code_version_key" UNIQUE (institution_id, notice_code, version_number);

ALTER TABLE "examination_room_v1"."privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_notice_body_check" CHECK (length(btrim(notice_body)) > 0);

ALTER TABLE "examination_room_v1"."privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_notice_code_check" CHECK (notice_code = lower(btrim(notice_code)) AND notice_code ~ '^[a-z0-9][a-z0-9._-]{1,63}$'::text);

ALTER TABLE "examination_room_v1"."privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_processing_purposes_check" CHECK (jsonb_typeof(processing_purposes) = 'array'::text);

ALTER TABLE "examination_room_v1"."privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_title_check" CHECK (length(btrim(title)) >= 1 AND length(btrim(title)) <= 240);

ALTER TABLE "examination_room_v1"."privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_version_number_check" CHECK (version_number > 0);

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ADD CONSTRAINT "proctoring_artifacts_artifact_kind_check" CHECK (artifact_kind = ANY (ARRAY['camera_chunk'::text, 'microphone_chunk'::text, 'screen_chunk'::text, 'still_image'::text]));

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ADD CONSTRAINT "proctoring_artifacts_artifact_status_check" CHECK (artifact_status = ANY (ARRAY['uploading'::text, 'available'::text, 'quarantined'::text, 'deleted'::text]));

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ADD CONSTRAINT "proctoring_artifacts_capture_window_check" CHECK (captured_to >= captured_from);

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ADD CONSTRAINT "proctoring_artifacts_encrypted_object_reference_check" CHECK (length(btrim(encrypted_object_reference)) >= 1 AND length(btrim(encrypted_object_reference)) <= 1024);

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ADD CONSTRAINT "proctoring_artifacts_encryption_key_reference_check" CHECK (length(btrim(encryption_key_reference)) >= 1 AND length(btrim(encryption_key_reference)) <= 512);

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ADD CONSTRAINT "proctoring_artifacts_object_reference_key" UNIQUE (encrypted_object_reference);

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ADD CONSTRAINT "proctoring_artifacts_object_sha256_check" CHECK (object_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ADD CONSTRAINT "proctoring_artifacts_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ADD CONSTRAINT "proctoring_artifacts_retention_check" CHECK (retention_until > captured_to);

ALTER TABLE "examination_room_v1"."proctoring_incidents" ADD CONSTRAINT "proctoring_incidents_details_check" CHECK (jsonb_typeof(details) = 'object'::text AND details::text !~* '"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)"[[:space:]]*:'::text);

ALTER TABLE "examination_room_v1"."proctoring_incidents" ADD CONSTRAINT "proctoring_incidents_duration_ms_check" CHECK (duration_ms IS NULL OR duration_ms >= 0);

ALTER TABLE "examination_room_v1"."proctoring_incidents" ADD CONSTRAINT "proctoring_incidents_id_session_key" UNIQUE (id, session_id);

ALTER TABLE "examination_room_v1"."proctoring_incidents" ADD CONSTRAINT "proctoring_incidents_incident_kind_check" CHECK (incident_kind = ANY (ARRAY['focus_lost'::text, 'fullscreen_exit'::text, 'camera_interrupted'::text, 'microphone_interrupted'::text, 'network_disconnected'::text, 'device_changed'::text, 'clock_anomaly'::text, 'other'::text]));

ALTER TABLE "examination_room_v1"."proctoring_incidents" ADD CONSTRAINT "proctoring_incidents_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."proctoring_incidents" ADD CONSTRAINT "proctoring_incidents_review_check" CHECK (review_status = 'unreviewed'::text AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL OR review_status <> 'unreviewed'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL);

ALTER TABLE "examination_room_v1"."proctoring_incidents" ADD CONSTRAINT "proctoring_incidents_review_status_check" CHECK (review_status = ANY (ARRAY['unreviewed'::text, 'benign'::text, 'escalated'::text, 'dismissed'::text]));

ALTER TABLE "examination_room_v1"."proctoring_incidents" ADD CONSTRAINT "proctoring_incidents_session_event_key" UNIQUE (session_id, client_event_id);

ALTER TABLE "examination_room_v1"."proctoring_incidents" ADD CONSTRAINT "proctoring_incidents_severity_check" CHECK (severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]));

ALTER TABLE "examination_room_v1"."proctoring_incidents" ADD CONSTRAINT "proctoring_incidents_source_check" CHECK (source = ANY (ARRAY['browser_signal'::text, 'proctor_report'::text, 'system_rule'::text, 'student_report'::text]));

ALTER TABLE "examination_room_v1"."professor_access_requests" ADD CONSTRAINT "professor_access_requests_claimed_school_id_check" CHECK (claimed_school_id = lower(btrim(claimed_school_id)) AND length(claimed_school_id) >= 1 AND length(claimed_school_id) <= 180);

ALTER TABLE "examination_room_v1"."professor_access_requests" ADD CONSTRAINT "professor_access_requests_claimed_school_name_check" CHECK (length(btrim(claimed_school_name)) >= 2 AND length(btrim(claimed_school_name)) <= 240);

ALTER TABLE "examination_room_v1"."professor_access_requests" ADD CONSTRAINT "professor_access_requests_display_name_check" CHECK (length(btrim(display_name)) >= 2 AND length(btrim(display_name)) <= 240);

ALTER TABLE "examination_room_v1"."professor_access_requests" ADD CONSTRAINT "professor_access_requests_email_normalized_check" CHECK (email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) >= 3 AND length(email_normalized) <= 320 AND POSITION(('@'::text) IN (email_normalized)) > 1);

ALTER TABLE "examination_room_v1"."professor_access_requests" ADD CONSTRAINT "professor_access_requests_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."professor_access_requests" ADD CONSTRAINT "professor_access_requests_request_status_check" CHECK (request_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]));

ALTER TABLE "examination_room_v1"."professor_access_requests" ADD CONSTRAINT "professor_access_requests_review_check" CHECK (request_status = 'pending'::text AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND review_reason IS NULL AND assigned_institution_id IS NULL AND approved_membership_id IS NULL OR request_status = 'rejected'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND assigned_institution_id = requested_institution_id AND approved_membership_id IS NULL OR request_status = 'cancelled'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND assigned_institution_id IS NULL AND approved_membership_id IS NULL OR request_status = 'approved'::text AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND assigned_institution_id = requested_institution_id AND approved_membership_id IS NOT NULL);

ALTER TABLE "examination_room_v1"."professor_access_requests" ADD CONSTRAINT "professor_access_requests_review_reason_check" CHECK (review_reason IS NULL OR length(btrim(review_reason)) >= 5 AND length(btrim(review_reason)) <= 1000);

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_configuration_check" CHECK (jsonb_typeof(configuration) = 'object'::text);

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_content_sha256_check" CHECK (content_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_id_version_key" UNIQUE (id, exam_version_id);

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_points_check" CHECK (points >= 0::numeric);

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_position_check" CHECK ("position" > 0);

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_prompt_check" CHECK (length(btrim(prompt)) > 0);

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_question_key_check" CHECK (question_key ~ '^q[0-9]{3}$'::text);

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_question_kind_check" CHECK (question_kind = ANY (ARRAY['essay'::text, 'short_answer'::text, 'multiple_choice'::text, 'true_false'::text, 'file_upload'::text]));

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_version_key_key" UNIQUE (exam_version_id, question_key);

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_version_position_key" UNIQUE (exam_version_id, "position");

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_encrypted_object_reference_check" CHECK (encrypted_object_reference IS NULL OR length(btrim(encrypted_object_reference)) >= 1 AND length(btrim(encrypted_object_reference)) <= 1024);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_encryption_key_reference_check" CHECK (encryption_key_reference IS NULL OR length(btrim(encryption_key_reference)) >= 1 AND length(btrim(encryption_key_reference)) <= 512);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_exam_sequence_key" UNIQUE (exam_id, snapshot_sequence);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_last_error_code_check" CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{2,100}$'::text);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_lease_check" CHECK (snapshot_status = 'materializing'::text AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL OR snapshot_status <> 'materializing'::text AND lease_id IS NULL AND lease_expires_at IS NULL);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_materialization_attempts_check" CHECK (materialization_attempts >= 0);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_materialization_check" CHECK ((snapshot_status = ANY (ARRAY['pending'::text, 'materializing'::text, 'failed'::text])) AND encrypted_object_reference IS NULL AND snapshot_sha256 IS NULL AND encryption_key_reference IS NULL AND available_at IS NULL OR (snapshot_status = ANY (ARRAY['available'::text, 'restoring'::text, 'restored'::text, 'expired'::text, 'superseded'::text])) AND encrypted_object_reference IS NOT NULL AND snapshot_sha256 IS NOT NULL AND encryption_key_reference IS NOT NULL AND available_at IS NOT NULL);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_object_reference_key" UNIQUE (encrypted_object_reference);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_record_count_check" CHECK (record_count >= 0);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_request_hash_check" CHECK (request_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_request_hash_key" UNIQUE (request_hash);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_restore_check" CHECK (snapshot_status <> 'restored'::text AND restored_at IS NULL AND restored_by_user_id IS NULL OR snapshot_status = 'restored'::text AND restored_at IS NOT NULL AND restored_by_user_id IS NOT NULL);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_restore_verification_sha256_check" CHECK (restore_verification_sha256 IS NULL OR restore_verification_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_restored_record_count_check" CHECK (restored_record_count >= 0);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_retention_check" CHECK (retention_until > created_at);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_snapshot_scope_check" CHECK (snapshot_scope = ANY (ARRAY['exam_definition'::text, 'answer_state'::text, 'grading_state'::text, 'full_recovery'::text]));

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_snapshot_sequence_check" CHECK (snapshot_sequence > 0);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_snapshot_sha256_check" CHECK (snapshot_sha256 IS NULL OR snapshot_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_snapshot_status_check" CHECK (snapshot_status = ANY (ARRAY['pending'::text, 'materializing'::text, 'available'::text, 'failed'::text, 'restoring'::text, 'restored'::text, 'expired'::text, 'superseded'::text]));

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_source_kind_check" CHECK (source_kind IS NULL OR (source_kind = ANY (ARRAY['publication'::text, 'submission'::text, 'grade_revision'::text, 'result_release'::text, 'manual'::text])));

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_batch_release_unique" UNIQUE (batch_request_hash, release_id);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_claim_shape" CHECK (delivery_status = 'pending'::text AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL OR delivery_status <> 'pending'::text AND claim_token IS NULL AND lease_expires_at IS NULL);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_attempt_count_check" CHECK (attempt_count >= 0);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_batch_request_hash_check" CHECK (batch_request_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_check" CHECK (maximum_score >= total_score);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_delivery_status_check" CHECK (delivery_status = ANY (ARRAY['pending'::text, 'sent'::text, 'suppressed'::text, 'not_configured'::text, 'failed'::text, 'skipped'::text]));

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_exam_title_check" CHECK (length(btrim(exam_title)) >= 1 AND length(btrim(exam_title)) <= 300);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_pkey" PRIMARY KEY (release_id);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_provider_id_check" CHECK (provider_id IS NULL OR length(provider_id) >= 1 AND length(provider_id) <= 240);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_recipient_email_check" CHECK (recipient_email IS NULL OR recipient_email = lower(btrim(recipient_email)) AND POSITION(('@'::text) IN (recipient_email)) > 1 AND length(recipient_email) >= 3 AND length(recipient_email) <= 320);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_recipient_name_check" CHECK (length(btrim(recipient_name)) >= 1 AND length(btrim(recipient_name)) <= 240);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_safe_error_code_check" CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[a-z0-9_]{2,80}$'::text);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_subject_name_check" CHECK (length(btrim(subject_name)) >= 1 AND length(btrim(subject_name)) <= 200);

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_total_score_check" CHECK (total_score >= 0::numeric);

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_action_check" CHECK (release_action = 'release'::text AND grade_revision_id IS NOT NULL AND supersedes_release_id IS NULL AND manifest_sha256 IS NOT NULL AND release_manifest IS NOT NULL OR release_action = 'revoke'::text AND grade_revision_id IS NULL AND supersedes_release_id IS NOT NULL AND reason IS NOT NULL AND manifest_sha256 IS NULL AND release_manifest IS NULL);

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_batch_request_hash_check" CHECK (batch_request_hash IS NULL OR batch_request_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_channel_check" CHECK (channel = ANY (ARRAY['student_portal'::text, 'email_notice'::text, 'offline_export'::text]));

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_delivery_reference_hash_check" CHECK (delivery_reference_hash IS NULL OR delivery_reference_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_id_submission_key" UNIQUE (id, submission_id);

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_idempotency_hash_key" UNIQUE (idempotency_key_hash);

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_idempotency_key_hash_check" CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_manifest_sha256_check" CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_release_action_check" CHECK (release_action = ANY (ARRAY['release'::text, 'revoke'::text]));

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_release_manifest_check" CHECK (release_manifest IS NULL OR jsonb_typeof(release_manifest) = 'object'::text AND (release_manifest ->> 'schemaVersion'::text) = 'examination-room/result-release/v1'::text);

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_activation_status_check" CHECK (activation_status = ANY (ARRAY['scheduled'::text, 'open'::text, 'closed'::text, 'revoked'::text]));

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_deactivation_check" CHECK (deactivated_at IS NULL AND deactivated_by_user_id IS NULL OR deactivated_at IS NOT NULL AND deactivated_by_user_id IS NOT NULL AND deactivated_at >= created_at);

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_id_exam_version_key" UNIQUE (id, exam_id, exam_version_id, institution_id);

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_key_hash_algorithm_check" CHECK (key_hash_algorithm = ANY (ARRAY['hmac-sha256-v1'::text, 'argon2id-v1'::text]));

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_key_hash_format_check" CHECK (key_hash_algorithm = 'hmac-sha256-v1'::text AND key_hash ~ '^[0-9a-f]{64}$'::text OR key_hash_algorithm = 'argon2id-v1'::text AND key_hash ~~ '$argon2id$%'::text AND length(key_hash) >= 40 AND length(key_hash) <= 255);

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_key_hash_key" UNIQUE (key_hash);

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_max_sessions_check" CHECK (max_sessions IS NULL OR max_sessions > 0);

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_request_hash_check" CHECK (request_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_request_hash_key" UNIQUE (request_hash);

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_window_check" CHECK (closes_at > opens_at);

ALTER TABLE "examination_room_v1"."staff_memberships" ADD CONSTRAINT "staff_memberships_display_name_check" CHECK (display_name IS NULL OR length(btrim(display_name)) >= 1 AND length(btrim(display_name)) <= 240);

ALTER TABLE "examination_room_v1"."staff_memberships" ADD CONSTRAINT "staff_memberships_email_normalized_check" CHECK (email_normalized IS NULL OR email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) >= 3 AND length(email_normalized) <= 320 AND POSITION(('@'::text) IN (email_normalized)) > 1);

ALTER TABLE "examination_room_v1"."staff_memberships" ADD CONSTRAINT "staff_memberships_grant_reason_check" CHECK (length(btrim(grant_reason)) >= 5 AND length(btrim(grant_reason)) <= 1000);

ALTER TABLE "examination_room_v1"."staff_memberships" ADD CONSTRAINT "staff_memberships_membership_status_check" CHECK (membership_status = ANY (ARRAY['active'::text, 'suspended'::text, 'revoked'::text]));

ALTER TABLE "examination_room_v1"."staff_memberships" ADD CONSTRAINT "staff_memberships_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."staff_memberships" ADD CONSTRAINT "staff_memberships_revocation_check" CHECK (membership_status <> 'revoked'::text AND revoked_by_user_id IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL OR membership_status = 'revoked'::text AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL);

ALTER TABLE "examination_room_v1"."staff_memberships" ADD CONSTRAINT "staff_memberships_staff_role_check" CHECK (staff_role = ANY (ARRAY['professor'::text, 'admin'::text]));

ALTER TABLE "examination_room_v1"."student_identities" ADD CONSTRAINT "student_identities_email_normalized_check" CHECK (email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) >= 3 AND length(email_normalized) <= 320 AND POSITION(('@'::text) IN (email_normalized)) > 1);

ALTER TABLE "examination_room_v1"."student_identities" ADD CONSTRAINT "student_identities_external_key" UNIQUE (institution_id, external_student_id);

ALTER TABLE "examination_room_v1"."student_identities" ADD CONSTRAINT "student_identities_external_student_id_check" CHECK (length(btrim(external_student_id)) >= 1 AND length(btrim(external_student_id)) <= 128);

ALTER TABLE "examination_room_v1"."student_identities" ADD CONSTRAINT "student_identities_full_name_check" CHECK (length(btrim(full_name)) >= 1 AND length(btrim(full_name)) <= 240);

ALTER TABLE "examination_room_v1"."student_identities" ADD CONSTRAINT "student_identities_id_institution_key" UNIQUE (id, institution_id);

ALTER TABLE "examination_room_v1"."student_identities" ADD CONSTRAINT "student_identities_identity_status_check" CHECK (identity_status = ANY (ARRAY['active'::text, 'inactive'::text, 'merged'::text]));

ALTER TABLE "examination_room_v1"."student_identities" ADD CONSTRAINT "student_identities_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."student_identities" ADD CONSTRAINT "student_identities_verification_method_check" CHECK (verification_method IS NULL OR (verification_method = ANY (ARRAY['institution_sso'::text, 'registrar_import'::text, 'admin_review'::text])));

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_activation_roster_key" UNIQUE (activation_id, roster_id);

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_consent_request_hash_check" CHECK (consent_request_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_consent_request_hash_key" UNIQUE (consent_request_hash);

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_id_institution_exam_key" UNIQUE (id, institution_id, exam_id);

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_id_roster_key" UNIQUE (id, roster_id);

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_id_roster_version_key" UNIQUE (id, roster_id, exam_version_id);

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_id_version_key" UNIQUE (id, exam_version_id);

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_identity_verification_method_check" CHECK (identity_verification_method IS NULL OR (identity_verification_method = ANY (ARRAY['signed_in_account'::text, 'room_key_roster_match'::text, 'admin_override'::text])));

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_session_metadata_check" CHECK (jsonb_typeof(session_metadata) = 'object'::text);

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_session_status_check" CHECK (session_status = ANY (ARRAY['created'::text, 'active'::text, 'submitted'::text, 'expired'::text, 'revoked'::text]));

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_session_token_hash_check" CHECK (session_token_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_timestamps_check" CHECK (lease_expires_at > started_at AND (last_heartbeat_at IS NULL OR last_heartbeat_at >= started_at) AND (ended_at IS NULL OR ended_at >= started_at));

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_token_hash_key" UNIQUE (session_token_hash);

ALTER TABLE "examination_room_v1"."submission_answers" ADD CONSTRAINT "submission_answers_pkey" PRIMARY KEY (submission_id, question_id);

ALTER TABLE "examination_room_v1"."submission_answers" ADD CONSTRAINT "submission_answers_revision_key" UNIQUE (answer_revision_id);

ALTER TABLE "examination_room_v1"."submission_receipts" ADD CONSTRAINT "submission_receipts_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."submission_receipts" ADD CONSTRAINT "submission_receipts_receipt_code_key" UNIQUE (receipt_code);

ALTER TABLE "examination_room_v1"."submission_receipts" ADD CONSTRAINT "submission_receipts_receipt_payload_check" CHECK (jsonb_typeof(receipt_payload) = 'object'::text);

ALTER TABLE "examination_room_v1"."submission_receipts" ADD CONSTRAINT "submission_receipts_receipt_sha256_check" CHECK (receipt_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."submission_receipts" ADD CONSTRAINT "submission_receipts_submission_id_key" UNIQUE (submission_id);

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_answer_count_check" CHECK (answer_count >= 0);

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_clock_skew_check" CHECK (submitted_at_client <= (received_at + '24:00:00'::interval));

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_id_session_key" UNIQUE (id, session_id);

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_id_version_key" UNIQUE (id, exam_version_id);

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_idempotency_key_hash_check" CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_idempotency_key_hash_key" UNIQUE (idempotency_key_hash);

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_manifest_sha256_check" CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_pkey" PRIMARY KEY (id);

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_session_key" UNIQUE (session_id);

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_status_reason_check" CHECK (submission_status = 'accepted'::text AND status_reason IS NULL OR submission_status <> 'accepted'::text AND status_reason IS NOT NULL);

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_submission_manifest_check" CHECK (jsonb_typeof(submission_manifest) = 'object'::text AND (submission_manifest ->> 'schemaVersion'::text) = 'examination-room/submission/v1'::text);

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_submission_status_check" CHECK (submission_status = ANY (ARRAY['accepted'::text, 'under_review'::text, 'voided'::text]));

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_question_version_fk" FOREIGN KEY (question_id, exam_version_id) REFERENCES examination_room_v1.questions(id, exam_version_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."answer_revisions" ADD CONSTRAINT "answer_revisions_session_version_fk" FOREIGN KEY (session_id, exam_version_id) REFERENCES examination_room_v1.student_sessions(id, exam_version_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_exam_institution_fk" FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_institution_id_fkey" FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_previous_hash_fk" FOREIGN KEY (institution_id, previous_event_hash) REFERENCES examination_room_v1.audit_events(institution_id, event_hash) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_session_context_fk" FOREIGN KEY (session_id, institution_id, exam_id) REFERENCES examination_room_v1.student_sessions(id, institution_id, exam_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."audit_events" ADD CONSTRAINT "audit_events_session_id_fkey" FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_activation_id_fkey" FOREIGN KEY (activation_id) REFERENCES examination_room_v1.room_activations(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_exam_scope_fk" FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."email_delivery_events" ADD CONSTRAINT "email_delivery_events_institution_id_fkey" FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."exam_roster" ADD CONSTRAINT "exam_roster_exam_institution_fk" FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."exam_roster" ADD CONSTRAINT "exam_roster_identity_institution_fk" FOREIGN KEY (student_identity_id, institution_id) REFERENCES examination_room_v1.student_identities(id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_exam_institution_fk" FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."exam_versions" ADD CONSTRAINT "exam_versions_notice_institution_fk" FOREIGN KEY (privacy_notice_version_id, institution_id) REFERENCES examination_room_v1.privacy_notice_versions(id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_current_published_version_fk" FOREIGN KEY (current_published_version_id, id) REFERENCES examination_room_v1.exam_versions(id, exam_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "examination_room_v1"."exams" ADD CONSTRAINT "exams_institution_id_fkey" FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."grade_revision_items" ADD CONSTRAINT "grade_revision_items_question_version_fk" FOREIGN KEY (question_id, exam_version_id) REFERENCES examination_room_v1.questions(id, exam_version_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."grade_revision_items" ADD CONSTRAINT "grade_revision_items_revision_version_fk" FOREIGN KEY (grade_revision_id, exam_version_id) REFERENCES examination_room_v1.grade_revisions(id, exam_version_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."grade_revisions" ADD CONSTRAINT "grade_revisions_submission_version_fk" FOREIGN KEY (submission_id, exam_version_id) REFERENCES examination_room_v1.submissions(id, exam_version_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_artifact_id_fkey" FOREIGN KEY (artifact_id) REFERENCES examination_room_v1.proctoring_artifacts(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."media_upload_intents" ADD CONSTRAINT "media_upload_intents_session_id_fkey" FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."owner_identity_corrections" ADD CONSTRAINT "owner_identity_corrections_exam_scope_fk" FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."owner_identity_corrections" ADD CONSTRAINT "owner_identity_corrections_identity_scope_fk" FOREIGN KEY (student_identity_id, institution_id) REFERENCES examination_room_v1.student_identities(id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."owner_identity_corrections" ADD CONSTRAINT "owner_identity_corrections_institution_id_fkey" FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."owner_key_envelopes" ADD CONSTRAINT "owner_key_envelopes_activation_id_fkey" FOREIGN KEY (activation_id) REFERENCES examination_room_v1.room_activations(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."owner_key_envelopes" ADD CONSTRAINT "owner_key_envelopes_exam_scope_fk" FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_notice_version_id_fkey" FOREIGN KEY (notice_version_id) REFERENCES examination_room_v1.privacy_notice_versions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_prior_same_subject_fk" FOREIGN KEY (prior_acceptance_id, roster_id, notice_version_id, session_id, exam_version_id) REFERENCES examination_room_v1.privacy_acceptances(id, roster_id, notice_version_id, session_id, exam_version_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_roster_id_fkey" FOREIGN KEY (roster_id) REFERENCES examination_room_v1.exam_roster(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_session_roster_fk" FOREIGN KEY (session_id, roster_id, exam_version_id) REFERENCES examination_room_v1.student_sessions(id, roster_id, exam_version_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."privacy_acceptances" ADD CONSTRAINT "privacy_acceptances_version_notice_fk" FOREIGN KEY (exam_version_id, notice_version_id) REFERENCES examination_room_v1.exam_versions(id, privacy_notice_version_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_institution_id_fkey" FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ADD CONSTRAINT "proctoring_artifacts_incident_session_fk" FOREIGN KEY (incident_id, session_id) REFERENCES examination_room_v1.proctoring_incidents(id, session_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ADD CONSTRAINT "proctoring_artifacts_session_id_fkey" FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."proctoring_incidents" ADD CONSTRAINT "proctoring_incidents_session_id_fkey" FOREIGN KEY (session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."professor_access_requests" ADD CONSTRAINT "professor_access_requests_approved_membership_id_fkey" FOREIGN KEY (approved_membership_id) REFERENCES examination_room_v1.staff_memberships(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."professor_access_requests" ADD CONSTRAINT "professor_access_requests_assigned_institution_id_fkey" FOREIGN KEY (assigned_institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."professor_access_requests" ADD CONSTRAINT "professor_access_requests_requested_institution_id_fkey" FOREIGN KEY (requested_institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."questions" ADD CONSTRAINT "questions_exam_version_id_fkey" FOREIGN KEY (exam_version_id) REFERENCES examination_room_v1.exam_versions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_source_grade_revision_id_fkey" FOREIGN KEY (source_grade_revision_id) REFERENCES examination_room_v1.grade_revisions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_source_result_release_id_fkey" FOREIGN KEY (source_result_release_id) REFERENCES examination_room_v1.result_releases(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_source_session_id_fkey" FOREIGN KEY (source_session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_source_submission_id_fkey" FOREIGN KEY (source_submission_id) REFERENCES examination_room_v1.submissions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."recovery_snapshots" ADD CONSTRAINT "recovery_snapshots_version_exam_fk" FOREIGN KEY (exam_version_id, exam_id) REFERENCES examination_room_v1.exam_versions(id, exam_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_institution_id_fkey" FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_release_id_fkey" FOREIGN KEY (release_id) REFERENCES examination_room_v1.result_releases(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_events_student_session_id_fkey" FOREIGN KEY (student_session_id) REFERENCES examination_room_v1.student_sessions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ADD CONSTRAINT "result_email_delivery_exam_scope_fk" FOREIGN KEY (exam_id, institution_id) REFERENCES examination_room_v1.exams(id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_grade_same_submission_fk" FOREIGN KEY (grade_revision_id, submission_id) REFERENCES examination_room_v1.grade_revisions(id, submission_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_submission_id_fkey" FOREIGN KEY (submission_id) REFERENCES examination_room_v1.submissions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."result_releases" ADD CONSTRAINT "result_releases_supersedes_same_submission_fk" FOREIGN KEY (supersedes_release_id, submission_id) REFERENCES examination_room_v1.result_releases(id, submission_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."room_activations" ADD CONSTRAINT "room_activations_version_exam_fk" FOREIGN KEY (exam_version_id, exam_id, institution_id) REFERENCES examination_room_v1.exam_versions(id, exam_id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."staff_memberships" ADD CONSTRAINT "staff_memberships_institution_id_fkey" FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."student_identities" ADD CONSTRAINT "student_identities_institution_id_fkey" FOREIGN KEY (institution_id) REFERENCES examination_room_v1.institutions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_activation_fk" FOREIGN KEY (activation_id, exam_id, exam_version_id, institution_id) REFERENCES examination_room_v1.room_activations(id, exam_id, exam_version_id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."student_sessions" ADD CONSTRAINT "student_sessions_roster_fk" FOREIGN KEY (roster_id, exam_id, institution_id) REFERENCES examination_room_v1.exam_roster(id, exam_id, institution_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."submission_answers" ADD CONSTRAINT "submission_answers_revision_session_question_fk" FOREIGN KEY (answer_revision_id, session_id, question_id) REFERENCES examination_room_v1.answer_revisions(id, session_id, question_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."submission_answers" ADD CONSTRAINT "submission_answers_submission_session_fk" FOREIGN KEY (submission_id, session_id) REFERENCES examination_room_v1.submissions(id, session_id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."submission_receipts" ADD CONSTRAINT "submission_receipts_submission_id_fkey" FOREIGN KEY (submission_id) REFERENCES examination_room_v1.submissions(id) ON DELETE RESTRICT;

ALTER TABLE "examination_room_v1"."submissions" ADD CONSTRAINT "submissions_session_version_fk" FOREIGN KEY (session_id, exam_version_id) REFERENCES examination_room_v1.student_sessions(id, exam_version_id) ON DELETE RESTRICT;

-- Constraint-backed indexes were created above; create the remaining captured indexes.

CREATE INDEX answer_revisions_latest_idx ON examination_room_v1.answer_revisions USING btree (session_id, question_id, revision_number DESC);

CREATE INDEX audit_events_exam_idx ON examination_room_v1.audit_events USING btree (exam_id, occurred_at DESC) WHERE (exam_id IS NOT NULL);

CREATE INDEX audit_events_institution_idx ON examination_room_v1.audit_events USING btree (institution_id, recorded_at DESC);

CREATE INDEX audit_events_session_idx ON examination_room_v1.audit_events USING btree (session_id, occurred_at DESC) WHERE (session_id IS NOT NULL);

CREATE INDEX email_delivery_events_exam_time_idx ON examination_room_v1.email_delivery_events USING btree (exam_id, attempted_at DESC);

CREATE UNIQUE INDEX exam_roster_grading_alias_key ON examination_room_v1.exam_roster USING btree (exam_id, grading_alias) WHERE (grading_alias IS NOT NULL);

CREATE INDEX exam_roster_status_idx ON examination_room_v1.exam_roster USING btree (exam_id, roster_status);

CREATE INDEX exam_versions_published_idx ON examination_room_v1.exam_versions USING btree (exam_id, published_at DESC);

CREATE INDEX exams_admin_lifecycle_idx ON examination_room_v1.exams USING btree (institution_id, deleted_at, blocked_at, updated_at DESC);

CREATE INDEX exams_owner_active_lifecycle_idx ON examination_room_v1.exams USING btree (owner_user_id, updated_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX exams_owner_status_idx ON examination_room_v1.exams USING btree (institution_id, owner_user_id, status);

CREATE INDEX grade_revisions_latest_idx ON examination_room_v1.grade_revisions USING btree (submission_id, revision_number DESC);

CREATE INDEX media_upload_intents_pending_idx ON examination_room_v1.media_upload_intents USING btree (intent_status, updated_at) WHERE (intent_status = ANY (ARRAY['prepared'::text, 'local_queue'::text]));

CREATE INDEX media_upload_intents_session_status_idx ON examination_room_v1.media_upload_intents USING btree (session_id, intent_status, prepared_at DESC);

CREATE UNIQUE INDEX privacy_acceptances_one_withdrawal_idx ON examination_room_v1.privacy_acceptances USING btree (prior_acceptance_id) WHERE (decision = 'withdrawn'::text);

CREATE INDEX privacy_acceptances_roster_notice_idx ON examination_room_v1.privacy_acceptances USING btree (roster_id, notice_version_id, recorded_at DESC);

CREATE INDEX proctoring_artifacts_session_idx ON examination_room_v1.proctoring_artifacts USING btree (session_id, artifact_kind, captured_from);

CREATE INDEX proctoring_incidents_review_idx ON examination_room_v1.proctoring_incidents USING btree (session_id, review_status, occurred_at DESC);

CREATE UNIQUE INDEX professor_access_requests_one_pending_per_user ON examination_room_v1.professor_access_requests USING btree (user_id) WHERE (request_status = 'pending'::text);

CREATE INDEX professor_access_requests_school_queue ON examination_room_v1.professor_access_requests USING btree (requested_institution_id, request_status, requested_at);

CREATE INDEX recovery_snapshots_status_idx ON examination_room_v1.recovery_snapshots USING btree (exam_id, snapshot_status, created_at DESC);

CREATE INDEX result_email_delivery_exam_time_idx ON examination_room_v1.result_email_delivery_events USING btree (exam_id, released_at DESC, release_id);

CREATE INDEX result_email_delivery_retry_idx ON examination_room_v1.result_email_delivery_events USING btree (lease_expires_at, updated_at) WHERE (delivery_status = ANY (ARRAY['pending'::text, 'failed'::text, 'not_configured'::text, 'suppressed'::text]));

CREATE INDEX result_releases_batch_request_idx ON examination_room_v1.result_releases USING btree (batch_request_hash, occurred_at, id) WHERE (batch_request_hash IS NOT NULL);

CREATE UNIQUE INDEX result_releases_one_revocation_per_release_idx ON examination_room_v1.result_releases USING btree (supersedes_release_id) WHERE (release_action = 'revoke'::text);

CREATE INDEX result_releases_submission_idx ON examination_room_v1.result_releases USING btree (submission_id, occurred_at DESC);

CREATE INDEX room_activations_window_idx ON examination_room_v1.room_activations USING btree (exam_id, activation_status, opens_at, closes_at);

CREATE INDEX staff_memberships_active_user_idx ON examination_room_v1.staff_memberships USING btree (user_id, institution_id, staff_role) WHERE (membership_status = 'active'::text);

CREATE UNIQUE INDEX staff_memberships_one_active_role_idx ON examination_room_v1.staff_memberships USING btree (institution_id, user_id, staff_role) WHERE (membership_status = 'active'::text);

CREATE INDEX student_identities_email_idx ON examination_room_v1.student_identities USING btree (institution_id, email_normalized);

CREATE UNIQUE INDEX student_identities_institution_auth_key ON examination_room_v1.student_identities USING btree (institution_id, auth_user_id) WHERE (auth_user_id IS NOT NULL);

CREATE INDEX student_sessions_heartbeat_idx ON examination_room_v1.student_sessions USING btree (activation_id, session_status, last_heartbeat_at);

CREATE UNIQUE INDEX student_sessions_one_open_per_roster_idx ON examination_room_v1.student_sessions USING btree (activation_id, roster_id) WHERE (session_status = ANY (ARRAY['created'::text, 'active'::text]));

CREATE INDEX submissions_status_received_idx ON examination_room_v1.submissions USING btree (submission_status, received_at DESC);

CREATE TRIGGER answer_revisions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.answer_revisions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER audit_events_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.audit_events FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER email_delivery_events_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.email_delivery_events FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_email_delivery_event();

CREATE TRIGGER exam_roster_binding_locked BEFORE UPDATE OF id, exam_id, institution_id, student_identity_id, created_at ON examination_room_v1.exam_roster FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER exam_roster_touch_updated_at BEFORE UPDATE ON examination_room_v1.exam_roster FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at();

CREATE TRIGGER exam_versions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.exam_versions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.seal_exam_version();

CREATE TRIGGER exams_current_version_must_be_published BEFORE INSERT OR UPDATE ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.ensure_exam_current_version_published();

CREATE TRIGGER exams_identity_locked BEFORE UPDATE OF id, institution_id, created_at ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER exams_owner_must_be_authorized BEFORE INSERT OR UPDATE OF institution_id, owner_user_id ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_exam_owner();

CREATE TRIGGER exams_touch_updated_at BEFORE UPDATE ON examination_room_v1.exams FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at();

CREATE TRIGGER grade_revision_items_immutable BEFORE INSERT OR DELETE OR UPDATE ON examination_room_v1.grade_revision_items FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_grade_revision_item_set();

CREATE TRIGGER grade_revisions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.grade_revisions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER grade_revisions_queue_recovery AFTER INSERT ON examination_room_v1.grade_revisions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.queue_grading_snapshot();

CREATE TRIGGER institutions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.institutions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER media_upload_intents_no_delete BEFORE DELETE ON examination_room_v1.media_upload_intents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete();

CREATE TRIGGER media_upload_intents_touch_updated_at BEFORE UPDATE ON examination_room_v1.media_upload_intents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at();

CREATE TRIGGER owner_identity_corrections_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.owner_identity_corrections FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER owner_key_envelopes_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.owner_key_envelopes FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER privacy_acceptances_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.privacy_acceptances FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER privacy_acceptances_validate BEFORE INSERT ON examination_room_v1.privacy_acceptances FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_privacy_acceptance();

CREATE TRIGGER privacy_notice_versions_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.privacy_notice_versions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER privacy_notice_versions_minimal_warning BEFORE INSERT ON examination_room_v1.privacy_notice_versions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.normalize_default_student_warning();

CREATE TRIGGER proctoring_artifacts_evidence_locked BEFORE UPDATE OF id, session_id, incident_id, artifact_kind, encrypted_object_reference, object_sha256, encryption_key_reference, captured_from, captured_to, retention_until, created_at ON examination_room_v1.proctoring_artifacts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER proctoring_artifacts_no_delete BEFORE DELETE ON examination_room_v1.proctoring_artifacts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete();

CREATE TRIGGER proctoring_artifacts_touch_updated_at BEFORE UPDATE ON examination_room_v1.proctoring_artifacts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at();

CREATE TRIGGER proctoring_incidents_evidence_locked BEFORE UPDATE OF id, session_id, client_event_id, incident_kind, source, severity, occurred_at, duration_ms, details, created_at ON examination_room_v1.proctoring_incidents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER proctoring_incidents_no_delete BEFORE DELETE ON examination_room_v1.proctoring_incidents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete();

CREATE TRIGGER proctoring_incidents_touch_updated_at BEFORE UPDATE ON examination_room_v1.proctoring_incidents FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at();

CREATE TRIGGER professor_access_requests_history_locked BEFORE INSERT OR UPDATE ON examination_room_v1.professor_access_requests FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_professor_access_request_history();

CREATE TRIGGER professor_access_requests_no_delete BEFORE DELETE ON examination_room_v1.professor_access_requests FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete();

CREATE TRIGGER questions_immutable BEFORE INSERT OR DELETE OR UPDATE ON examination_room_v1.questions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_published_question();

CREATE TRIGGER recovery_snapshots_bind_source BEFORE INSERT ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.set_snapshot_source();

CREATE TRIGGER recovery_snapshots_evidence_locked BEFORE UPDATE ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_recovery_snapshot();

CREATE TRIGGER recovery_snapshots_no_delete BEFORE DELETE ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete();

CREATE TRIGGER recovery_snapshots_touch_updated_at BEFORE UPDATE ON examination_room_v1.recovery_snapshots FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at();

CREATE TRIGGER result_releases_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.result_releases FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER result_releases_queue_recovery AFTER INSERT ON examination_room_v1.result_releases FOR EACH ROW EXECUTE FUNCTION examination_room_v1.queue_grading_snapshot();

CREATE TRIGGER result_releases_validate_grade BEFORE INSERT ON examination_room_v1.result_releases FOR EACH ROW EXECUTE FUNCTION examination_room_v1.ensure_releasable_grade();

CREATE TRIGGER room_activations_no_delete BEFORE DELETE ON examination_room_v1.room_activations FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete();

CREATE TRIGGER room_activations_validate BEFORE INSERT OR UPDATE ON examination_room_v1.room_activations FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_room_activation();

CREATE TRIGGER staff_memberships_history_locked BEFORE UPDATE ON examination_room_v1.staff_memberships FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_staff_membership_history();

CREATE TRIGGER staff_memberships_no_delete BEFORE DELETE ON examination_room_v1.staff_memberships FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete();

CREATE TRIGGER staff_memberships_touch_updated_at BEFORE UPDATE ON examination_room_v1.staff_memberships FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at();

CREATE TRIGGER student_identities_touch_updated_at BEFORE UPDATE ON examination_room_v1.student_identities FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at();

CREATE TRIGGER student_sessions_binding_locked BEFORE UPDATE OF id, activation_id, exam_id, institution_id, exam_version_id, roster_id, session_token_hash, consent_request_hash, client_instance_id, started_at, created_at ON examination_room_v1.student_sessions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_student_session_binding();

CREATE TRIGGER student_sessions_no_delete BEFORE DELETE ON examination_room_v1.student_sessions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete();

CREATE TRIGGER student_sessions_touch_updated_at BEFORE UPDATE ON examination_room_v1.student_sessions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at();

CREATE TRIGGER submission_answers_immutable BEFORE INSERT OR DELETE OR UPDATE ON examination_room_v1.submission_answers FOR EACH ROW EXECUTE FUNCTION examination_room_v1.protect_submission_answer_set();

CREATE TRIGGER submission_receipts_immutable BEFORE DELETE OR UPDATE ON examination_room_v1.submission_receipts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER submission_receipts_validate BEFORE INSERT ON examination_room_v1.submission_receipts FOR EACH ROW EXECUTE FUNCTION examination_room_v1.validate_submission_receipt();

CREATE TRIGGER submissions_evidence_locked BEFORE UPDATE OF id, session_id, exam_version_id, idempotency_key_hash, manifest_sha256, submission_manifest, answer_count, submitted_at_client, received_at ON examination_room_v1.submissions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_mutation();

CREATE TRIGGER submissions_no_delete BEFORE DELETE ON examination_room_v1.submissions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.prevent_delete();

CREATE TRIGGER submissions_touch_updated_at BEFORE UPDATE ON examination_room_v1.submissions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.touch_updated_at();

ALTER TABLE "examination_room_v1"."answer_revisions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."answer_revisions" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."answer_revisions" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."answer_revisions" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."answer_revisions" TO "service_role";

ALTER TABLE "examination_room_v1"."audit_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."audit_events" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."audit_events" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."audit_events" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."audit_events" TO "service_role";

ALTER TABLE "examination_room_v1"."email_delivery_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."email_delivery_events" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."email_delivery_events" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."email_delivery_events" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."email_delivery_events" TO "service_role";

ALTER TABLE "examination_room_v1"."exam_roster" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."exam_roster" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."exam_roster" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."exam_roster" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."exam_roster" TO "service_role";

ALTER TABLE "examination_room_v1"."exam_versions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."exam_versions" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."exam_versions" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."exam_versions" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."exam_versions" TO "service_role";

ALTER TABLE "examination_room_v1"."exams" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."exams" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."exams" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."exams" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."exams" TO "service_role";

ALTER TABLE "examination_room_v1"."grade_revision_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."grade_revision_items" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."grade_revision_items" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."grade_revision_items" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."grade_revision_items" TO "service_role";

ALTER TABLE "examination_room_v1"."grade_revisions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."grade_revisions" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."grade_revisions" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."grade_revisions" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."grade_revisions" TO "service_role";

ALTER TABLE "examination_room_v1"."institutions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."institutions" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."institutions" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."institutions" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."institutions" TO "service_role";

ALTER TABLE "examination_room_v1"."media_upload_intents" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."media_upload_intents" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."media_upload_intents" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."media_upload_intents" TO "postgres";

ALTER TABLE "examination_room_v1"."owner_identity_corrections" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."owner_identity_corrections" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."owner_identity_corrections" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."owner_identity_corrections" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."owner_identity_corrections" TO "service_role";

ALTER TABLE "examination_room_v1"."owner_key_envelopes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."owner_key_envelopes" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."owner_key_envelopes" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."owner_key_envelopes" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."owner_key_envelopes" TO "service_role";

ALTER TABLE "examination_room_v1"."privacy_acceptances" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."privacy_acceptances" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."privacy_acceptances" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."privacy_acceptances" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."privacy_acceptances" TO "service_role";

ALTER TABLE "examination_room_v1"."privacy_notice_versions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."privacy_notice_versions" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."privacy_notice_versions" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."privacy_notice_versions" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."privacy_notice_versions" TO "service_role";

ALTER TABLE "examination_room_v1"."proctoring_artifacts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."proctoring_artifacts" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."proctoring_artifacts" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."proctoring_artifacts" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."proctoring_artifacts" TO "service_role";

ALTER TABLE "examination_room_v1"."proctoring_incidents" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."proctoring_incidents" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."proctoring_incidents" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."proctoring_incidents" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."proctoring_incidents" TO "service_role";

ALTER TABLE "examination_room_v1"."professor_access_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."professor_access_requests" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."professor_access_requests" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."professor_access_requests" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."professor_access_requests" TO "service_role";

ALTER TABLE "examination_room_v1"."questions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."questions" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."questions" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."questions" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."questions" TO "service_role";

ALTER TABLE "examination_room_v1"."recovery_snapshots" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."recovery_snapshots" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."recovery_snapshots" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."recovery_snapshots" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."recovery_snapshots" TO "service_role";

ALTER TABLE "examination_room_v1"."result_email_delivery_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."result_email_delivery_events" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."result_email_delivery_events" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."result_email_delivery_events" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."result_email_delivery_events" TO "service_role";

ALTER TABLE "examination_room_v1"."result_releases" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."result_releases" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."result_releases" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."result_releases" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."result_releases" TO "service_role";

ALTER TABLE "examination_room_v1"."room_activations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."room_activations" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."room_activations" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."room_activations" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."room_activations" TO "service_role";

ALTER TABLE "examination_room_v1"."staff_memberships" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."staff_memberships" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."staff_memberships" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."staff_memberships" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."staff_memberships" TO "service_role";

ALTER TABLE "examination_room_v1"."student_identities" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."student_identities" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."student_identities" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."student_identities" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."student_identities" TO "service_role";

ALTER TABLE "examination_room_v1"."student_sessions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."student_sessions" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."student_sessions" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."student_sessions" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."student_sessions" TO "service_role";

ALTER TABLE "examination_room_v1"."submission_answers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."submission_answers" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."submission_answers" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."submission_answers" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."submission_answers" TO "service_role";

ALTER TABLE "examination_room_v1"."submission_receipts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."submission_receipts" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."submission_receipts" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."submission_receipts" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."submission_receipts" TO "service_role";

ALTER TABLE "examination_room_v1"."submissions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "examination_room_v1"."submissions" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "examination_room_v1"."submissions" FROM PUBLIC, "postgres", "service_role", "anon", "authenticated", "supabase_admin", "supabase_auth_admin", "dashboard_user";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "examination_room_v1"."submissions" TO "postgres";

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE "examination_room_v1"."submissions" TO "service_role";

-- No policies were captured; none are invented here.

COMMIT;

-- Caller must run verify-current-schema.sql before adding synthetic rows or applying a repair.

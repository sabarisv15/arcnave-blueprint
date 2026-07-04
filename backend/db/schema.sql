-- ARCNAVE — database + table structure
--
-- Full schema (17 tables, RLS policies, indexes, FKs, role grants),
-- generated via `pg_dump --schema-only` from this project's own live,
-- fully-migrated Postgres 16 instance — reflects every migration in
-- backend/migrations/ up through 1752800000000
-- (documents-student-id-nullable), not hand-reconstructed. The
-- `pgmigrations` bookkeeping table is deliberately excluded: it
-- records THIS instance's own migration history, not structure worth
-- importing elsewhere. Sample/test data lives separately in
-- backend/db/seed-test-data.sql — run this file first, that one after.
--
-- HOW TO IMPORT ON ANOTHER SYSTEM
--   1. Create the target database (skip if it already exists):
--        createdb -U <superuser> arcnave
--      or, from psql:
--        CREATE DATABASE arcnave;
--
--   2. Import this file into it:
--        psql -U <superuser> -d arcnave -f backend/db/schema.sql
--
--   This file creates its own prerequisite roles (arcnave_app,
--   arcnave_platform) if they don't already exist — see the DO block
--   below — so it does not depend on this repo's
--   docker/postgres/init/*.sh scripts having run first. If you ARE
--   importing into a fresh instance of this project's own
--   docker-compose.yml, those init scripts already create these roles
--   with the real passwords from .env; this file's own CREATE ROLE
--   calls will just no-op (IF NOT EXISTS-guarded) and leave them alone.
--
--   CHANGE THE PLACEHOLDER PASSWORDS BELOW before using this anywhere
--   other than local, throwaway testing — 'changeme_app_password' /
--   'changeme_platform_password' are not secrets, they're marked
--   placeholders.
--
-- REQUIRES PostgreSQL 13+ (uses the built-in gen_random_uuid(); no
-- pgcrypto/uuid-ossp extension needed on 13+, which is what this
-- project's own docker-compose.yml already runs — postgres:16).
--
-- Includes pg_dump 16's \restrict/\unrestrict guard directives —
-- these are psql-only meta-commands (a dump-replay safety feature),
-- harmless no-ops if this file is fed to `psql`, which is the expected
-- way to run it (see step 2 above). If you're piping this into a
-- non-psql tool, strip the two \restrict/\unrestrict lines first.

-- --- Prerequisite roles (idempotent — safe if they already exist) ---
-- Same least-privilege split this project's own
-- docker/postgres/init/01-app-role.sh / 02-platform-role.sh set up
-- (ADR-015): arcnave_app is the tenant runtime role every RLS policy
-- below is written against; arcnave_platform is the separate,
-- narrower role the Super Admin Portal uses. Neither is a superuser,
-- and neither owns any table (this script's own tables are owned by
-- whichever role runs this file) — RLS's FORCE ROW LEVEL SECURITY
-- only means something for a non-owning, non-superuser role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'arcnave_app') THEN
    CREATE ROLE arcnave_app LOGIN PASSWORD 'changeme_app_password';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'arcnave_platform') THEN
    CREATE ROLE arcnave_platform LOGIN PASSWORD 'changeme_platform_password';
  END IF;
END
$$;

-- --- Schema (generated, see header above) ---

--
-- PostgreSQL database dump
--

\restrict 4RTEv9dJZmGo540YBXDUkCd85bnsN9cAOLRYS7iUfIGDzlZkoeOuSH4jqEsBFpF

-- Dumped from database version 16.14 (Debian 16.14-1.pgdg13+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attendance_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    class_id uuid NOT NULL,
    session_date date NOT NULL,
    hour_index integer NOT NULL,
    marked_by_user_id uuid NOT NULL,
    absent_student_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_students integer NOT NULL,
    locked_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.attendance_sessions FORCE ROW LEVEL SECURITY;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    college_id text NOT NULL,
    user_id uuid,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.audit_log FORCE ROW LEVEL SECURITY;


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    class_name text NOT NULL,
    department text,
    semester text,
    tutor_user_id uuid,
    timetable_status text DEFAULT 'No Tutor'::text NOT NULL,
    timetable_data jsonb,
    timetable_remarks text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.classes FORCE ROW LEVEL SECURITY;


--
-- Name: colleges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.colleges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    name text NOT NULL,
    subdomain text NOT NULL,
    subscription_status text DEFAULT 'trial'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configurations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    category text NOT NULL,
    configuration jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.configurations FORCE ROW LEVEL SECURITY;


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    student_id uuid,
    doc_type text NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text NOT NULL,
    file_size_bytes bigint NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    uploaded_by_user_id uuid NOT NULL,
    verified_by_user_id uuid,
    verified_at timestamp with time zone,
    remarks text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.documents FORCE ROW LEVEL SECURITY;


--
-- Name: faculty_allocation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faculty_allocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    class_id uuid NOT NULL,
    period_id uuid NOT NULL,
    subject text NOT NULL,
    staff_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.faculty_allocation FORCE ROW LEVEL SECURITY;


--
-- Name: fee_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    student_id uuid NOT NULL,
    fee_structure_id uuid NOT NULL,
    status text DEFAULT 'not_paid'::text NOT NULL,
    marked_by_user_id uuid NOT NULL,
    receipt_document_id uuid,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fee_payments FORCE ROW LEVEL SECURITY;


--
-- Name: fee_structures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_structures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    academic_year text NOT NULL,
    class_id uuid NOT NULL,
    fee_category text NOT NULL,
    amount numeric(12,2) NOT NULL,
    status text DEFAULT 'Pending Approval'::text NOT NULL,
    remarks text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fee_structures FORCE ROW LEVEL SECURITY;


--
-- Name: generated_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    requested_by_user_id uuid NOT NULL,
    report_type text NOT NULL,
    format text NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    document_id uuid,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.generated_reports FORCE ROW LEVEL SECURITY;


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pgmigrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platform_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone
);


--
-- Name: principal_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.principal_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    email text NOT NULL,
    token_hash text NOT NULL,
    created_by uuid,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);

ALTER TABLE ONLY public.refresh_tokens FORCE ROW LEVEL SECURITY;


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    user_id uuid NOT NULL,
    staff_code text,
    full_name text NOT NULL,
    gender text,
    dob date,
    phone text,
    department text,
    designation text,
    qualification text,
    has_phd boolean DEFAULT false NOT NULL,
    aicte_id text,
    joined_year integer,
    address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.staff FORCE ROW LEVEL SECURITY;


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    roll_no text NOT NULL,
    full_name text NOT NULL,
    gender text,
    entry_type text,
    emis_number text,
    umis_number text,
    email text,
    phone text,
    phone_verified boolean DEFAULT false NOT NULL,
    parent_name text,
    parent_phone text,
    parent_phone_verified boolean DEFAULT false NOT NULL,
    address text,
    pincode text,
    mark_10th text,
    mark_12th text,
    mark_iti text,
    accommodation text,
    club text,
    internship text,
    career_plan text,
    notes text,
    license_number text,
    bike_number text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.students FORCE ROW LEVEL SECURITY;


--
-- Name: timetable_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timetable_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    day_of_week text NOT NULL,
    hour_index integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.timetable_periods FORCE ROW LEVEL SECURITY;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    college_id text NOT NULL,
    username text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    activated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: attendance_sessions attendance_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: classes classes_college_id_class_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_college_id_class_name_key UNIQUE (college_id, class_name);


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: classes classes_tutor_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_tutor_user_id_key UNIQUE (tutor_user_id);


--
-- Name: colleges colleges_college_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colleges
    ADD CONSTRAINT colleges_college_id_key UNIQUE (college_id);


--
-- Name: colleges colleges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colleges
    ADD CONSTRAINT colleges_pkey PRIMARY KEY (id);


--
-- Name: colleges colleges_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colleges
    ADD CONSTRAINT colleges_subdomain_key UNIQUE (subdomain);


--
-- Name: configurations configurations_college_id_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configurations
    ADD CONSTRAINT configurations_college_id_category_key UNIQUE (college_id, category);


--
-- Name: configurations configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configurations
    ADD CONSTRAINT configurations_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: faculty_allocation faculty_allocation_class_id_period_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_class_id_period_id_key UNIQUE (class_id, period_id);


--
-- Name: faculty_allocation faculty_allocation_period_id_staff_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_period_id_staff_user_id_key UNIQUE (period_id, staff_user_id);


--
-- Name: faculty_allocation faculty_allocation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_pkey PRIMARY KEY (id);


--
-- Name: fee_payments fee_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_pkey PRIMARY KEY (id);


--
-- Name: fee_structures fee_structures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_pkey PRIMARY KEY (id);


--
-- Name: generated_reports generated_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_email_key UNIQUE (email);


--
-- Name: platform_admins platform_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_username_key UNIQUE (username);


--
-- Name: principal_invitations principal_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_invitations
    ADD CONSTRAINT principal_invitations_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: staff staff_college_id_staff_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_college_id_staff_code_key UNIQUE (college_id, staff_code);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);


--
-- Name: staff staff_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_user_id_key UNIQUE (user_id);


--
-- Name: students students_college_id_roll_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_college_id_roll_no_key UNIQUE (college_id, roll_no);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: timetable_periods timetable_periods_college_id_day_of_week_hour_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_college_id_day_of_week_hour_index_key UNIQUE (college_id, day_of_week, hour_index);


--
-- Name: timetable_periods timetable_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_pkey PRIMARY KEY (id);


--
-- Name: users users_college_id_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_college_id_username_key UNIQUE (college_id, username);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: attendance_sessions_class_date_hour_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX attendance_sessions_class_date_hour_key ON public.attendance_sessions USING btree (class_id, session_date, hour_index) WHERE (deleted_at IS NULL);


--
-- Name: documents_student_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_student_type_idx ON public.documents USING btree (student_id, doc_type) WHERE (deleted_at IS NULL);


--
-- Name: fee_payments_student_fee_structure_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fee_payments_student_fee_structure_key ON public.fee_payments USING btree (student_id, fee_structure_id) WHERE (deleted_at IS NULL);


--
-- Name: fee_structures_college_year_class_category_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fee_structures_college_year_class_category_key ON public.fee_structures USING btree (college_id, academic_year, class_id, fee_category) WHERE (deleted_at IS NULL);


--
-- Name: attendance_sessions attendance_sessions_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: attendance_sessions attendance_sessions_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: attendance_sessions attendance_sessions_marked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_marked_by_user_id_fkey FOREIGN KEY (marked_by_user_id) REFERENCES public.users(id);


--
-- Name: audit_log audit_log_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: classes classes_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: classes classes_tutor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_tutor_user_id_fkey FOREIGN KEY (tutor_user_id) REFERENCES public.users(id);


--
-- Name: colleges colleges_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colleges
    ADD CONSTRAINT colleges_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.platform_admins(id);


--
-- Name: configurations configurations_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configurations
    ADD CONSTRAINT configurations_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: documents documents_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: documents documents_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: documents documents_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id);


--
-- Name: documents documents_verified_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_verified_by_user_id_fkey FOREIGN KEY (verified_by_user_id) REFERENCES public.users(id);


--
-- Name: faculty_allocation faculty_allocation_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: faculty_allocation faculty_allocation_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: faculty_allocation faculty_allocation_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.timetable_periods(id);


--
-- Name: faculty_allocation faculty_allocation_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculty_allocation
    ADD CONSTRAINT faculty_allocation_staff_user_id_fkey FOREIGN KEY (staff_user_id) REFERENCES public.users(id);


--
-- Name: fee_payments fee_payments_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: fee_payments fee_payments_fee_structure_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_fee_structure_id_fkey FOREIGN KEY (fee_structure_id) REFERENCES public.fee_structures(id);


--
-- Name: fee_payments fee_payments_marked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_marked_by_user_id_fkey FOREIGN KEY (marked_by_user_id) REFERENCES public.users(id);


--
-- Name: fee_payments fee_payments_receipt_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_receipt_document_id_fkey FOREIGN KEY (receipt_document_id) REFERENCES public.documents(id);


--
-- Name: fee_payments fee_payments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: fee_structures fee_structures_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: fee_structures fee_structures_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: generated_reports generated_reports_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: generated_reports generated_reports_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: generated_reports generated_reports_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_reports
    ADD CONSTRAINT generated_reports_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id);


--
-- Name: principal_invitations principal_invitations_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_invitations
    ADD CONSTRAINT principal_invitations_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: principal_invitations principal_invitations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.principal_invitations
    ADD CONSTRAINT principal_invitations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.platform_admins(id);


--
-- Name: refresh_tokens refresh_tokens_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: staff staff_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: staff staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: students students_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: timetable_periods timetable_periods_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: users users_activated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES public.users(id);


--
-- Name: users users_college_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(college_id);


--
-- Name: attendance_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

--
-- Name: configurations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.configurations ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: faculty_allocation; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faculty_allocation ENABLE ROW LEVEL SECURITY;

--
-- Name: fee_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: fee_structures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;

--
-- Name: generated_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: staff; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

--
-- Name: students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.attendance_sessions USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: audit_log tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.audit_log USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: classes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.classes USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: configurations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.configurations USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: documents tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.documents USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: faculty_allocation tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.faculty_allocation USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: fee_payments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.fee_payments USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: fee_structures tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.fee_structures USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: generated_reports tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.generated_reports USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: refresh_tokens tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.refresh_tokens USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: staff tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.staff USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: students tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.students USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: timetable_periods tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.timetable_periods USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: users tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.users USING ((college_id = current_setting('app.current_tenant'::text, true)));


--
-- Name: timetable_periods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.timetable_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE attendance_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.attendance_sessions TO arcnave_app;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.audit_log TO arcnave_app;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.audit_log_id_seq TO arcnave_app;


--
-- Name: TABLE classes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classes TO arcnave_app;


--
-- Name: TABLE colleges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.colleges TO arcnave_app;
GRANT SELECT,INSERT,UPDATE ON TABLE public.colleges TO arcnave_platform;


--
-- Name: TABLE configurations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.configurations TO arcnave_app;


--
-- Name: TABLE documents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.documents TO arcnave_app;


--
-- Name: TABLE faculty_allocation; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.faculty_allocation TO arcnave_app;


--
-- Name: TABLE fee_payments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.fee_payments TO arcnave_app;


--
-- Name: TABLE fee_structures; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.fee_structures TO arcnave_app;


--
-- Name: TABLE generated_reports; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.generated_reports TO arcnave_app;


--
-- Name: TABLE platform_admins; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.platform_admins TO arcnave_platform;


--
-- Name: TABLE principal_invitations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.principal_invitations TO arcnave_platform;
GRANT SELECT,UPDATE ON TABLE public.principal_invitations TO arcnave_app;


--
-- Name: TABLE refresh_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.refresh_tokens TO arcnave_app;


--
-- Name: TABLE staff; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.staff TO arcnave_app;


--
-- Name: TABLE students; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.students TO arcnave_app;


--
-- Name: TABLE timetable_periods; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.timetable_periods TO arcnave_app;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO arcnave_app;


--
-- PostgreSQL database dump complete
--

\unrestrict 4RTEv9dJZmGo540YBXDUkCd85bnsN9cAOLRYS7iUfIGDzlZkoeOuSH4jqEsBFpF


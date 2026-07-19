--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: billing_key_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.billing_key_status AS ENUM (
    'active',
    'revoked',
    'invalid'
);


--
-- Name: biz_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.biz_status AS ENUM (
    'active',
    'closed',
    'suspended_tax'
);


--
-- Name: biz_verify_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.biz_verify_status AS ENUM (
    'pending',
    'valid',
    'invalid'
);


--
-- Name: claim_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.claim_status AS ENUM (
    'open',
    'investigating',
    'approved',
    'rejected',
    'closed'
);


--
-- Name: claim_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.claim_type AS ENUM (
    'cleaning_defect',
    'dispatch_failure',
    'property_damage',
    'urgent_premium',
    'other'
);


--
-- Name: fault_party; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fault_party AS ENUM (
    'tenant',
    'provider',
    'host',
    'guest',
    'platform',
    'none'
);


--
-- Name: offer_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.offer_status AS ENUM (
    'offered',
    'accepted',
    'rejected',
    'expired',
    'withdrawn'
);


--
-- Name: order_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_priority AS ENUM (
    'normal',
    'urgent'
);


--
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_status AS ENUM (
    'created',
    'billing_verified',
    'broadcasting',
    'accepted',
    'in_progress',
    'completed',
    'confirmed',
    'charged',
    'paid_out',
    'escalated',
    'reassigning',
    'backup_dispatch',
    'cancelled',
    'failed'
);


--
-- Name: payment_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_kind AS ENUM (
    'verification',
    'charge'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'succeeded',
    'failed',
    'cancelled'
);


--
-- Name: payout_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payout_status AS ENUM (
    'pending',
    'processing',
    'paid',
    'failed'
);


--
-- Name: provider_event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.provider_event_type AS ENUM (
    'registered',
    'verified',
    'rejected',
    'activated',
    'warned',
    'suspended',
    'reinstated',
    'banned'
);


--
-- Name: provider_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.provider_status AS ENUM (
    'registered',
    'pending_review',
    'rejected',
    'active',
    'warned',
    'suspended',
    'banned'
);


--
-- Name: provider_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.provider_type AS ENUM (
    'business',
    'individual'
);


--
-- Name: service_area_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_area_level AS ENUM (
    'city',
    'gu',
    'dong'
);


--
-- Name: trigger_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.trigger_type AS ENUM (
    'scheduled',
    'early_checkout',
    'rework'
);


--
-- Name: bump_order_sequence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_order_sequence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.status is distinct from old.status
     or new.scheduled_at is distinct from old.scheduled_at then
    new.sequence := old.sequence + 1;
  end if;
  return new;
end;
$$;


--
-- Name: current_provider_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_provider_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select id from public.providers where auth_user_id = auth.uid();
$$;


--
-- Name: forbid_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'append-only table: % is not allowed on %', tg_op, tg_table_name;
end;
$$;


--
-- Name: guard_provider_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_provider_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if auth.role() = 'authenticated' and new.status is distinct from old.status then
    raise exception 'provider.status는 직접 변경할 수 없습니다 (운영자/EF 전용)';
  end if;
  return new;
end;
$$;


--
-- Name: is_operator(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_operator() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'operator';
$$;


--
-- Name: provider_covers_region(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.provider_covers_region(p_provider_id uuid, p_region_code text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1 from public.provider_service_areas a
    where a.provider_id = p_provider_id
      and p_region_code like a.region_code || '%'
  );
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_info_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_info_views (
    id bigint NOT NULL,
    order_id uuid,
    property_id uuid,
    viewer text NOT NULL,
    scope text NOT NULL,
    ip inet,
    user_agent text,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT access_info_views_scope_check CHECK ((scope = ANY (ARRAY['property'::text, 'order'::text])))
);


--
-- Name: access_info_views_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.access_info_views_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: access_info_views_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.access_info_views_id_seq OWNED BY public.access_info_views.id;


--
-- Name: access_update_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_update_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    scope text NOT NULL,
    property_id uuid,
    order_id uuid,
    host_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT access_token_target CHECK ((((scope = 'property'::text) AND (property_id IS NOT NULL)) OR ((scope = 'order'::text) AND (order_id IS NOT NULL)))),
    CONSTRAINT access_update_tokens_scope_check CHECK ((scope = ANY (ARRAY['property'::text, 'order'::text])))
);


--
-- Name: billing_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    host_id uuid NOT NULL,
    pg_provider text DEFAULT 'portone'::text NOT NULL,
    billing_key text NOT NULL,
    method text NOT NULL,
    card_last4 text,
    card_brand text,
    status public.billing_key_status DEFAULT 'active'::public.billing_key_status NOT NULL,
    consent_at timestamp with time zone NOT NULL,
    consent_ip inet,
    consent_user_agent text,
    last_verified_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT billing_keys_card_last4_check CHECK ((card_last4 ~ '^[0-9]{4}$'::text)),
    CONSTRAINT billing_keys_method_check CHECK ((method = ANY (ARRAY['card'::text, 'kakaopay'::text, 'naverpay'::text, 'tosspay'::text])))
);


--
-- Name: claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    type public.claim_type NOT NULL,
    status public.claim_status DEFAULT 'open'::public.claim_status NOT NULL,
    fault public.fault_party DEFAULT 'none'::public.fault_party NOT NULL,
    claimed_amount bigint,
    approved_amount bigint,
    description text,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    opened_by text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reported_by text,
    CONSTRAINT claims_approved_amount_check CHECK ((approved_amount >= 0)),
    CONSTRAINT claims_claimed_amount_check CHECK ((claimed_amount >= 0)),
    CONSTRAINT claims_reported_by_check CHECK (((reported_by IS NULL) OR (reported_by = ANY (ARRAY['host'::text, 'guest'::text, 'tenant'::text, 'operator'::text]))))
);


--
-- Name: COLUMN claims.reported_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.claims.reported_by IS '실제 신고 주체. opened_by(API 호출 주체)와 구분. 호스트가 테넌트 대시보드에
   신고하면 opened_by=tenant, reported_by=host 가 된다.';


--
-- Name: hosts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hosts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    tenant_host_ref text NOT NULL,
    display_name text,
    phone text,
    email text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hosts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'blocked'::text])))
);


--
-- Name: order_access_info; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_access_info (
    order_id uuid NOT NULL,
    ciphertext text NOT NULL,
    key_version smallint DEFAULT 1 NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    purge_after timestamp with time zone,
    purged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_events (
    id bigint NOT NULL,
    order_id uuid NOT NULL,
    from_status public.order_status,
    to_status public.order_status NOT NULL,
    actor text NOT NULL,
    reason text,
    fault public.fault_party,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    sequence integer
);


--
-- Name: order_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_events_id_seq OWNED BY public.order_events.id;


--
-- Name: order_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    issue_type text NOT NULL,
    description text,
    photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    reported_by text NOT NULL,
    reported_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT order_issues_issue_type_check CHECK ((issue_type = ANY (ARRAY['damage'::text, 'access_failed'::text, 'excessive_soil'::text, 'missing_item'::text, 'other'::text])))
);


--
-- Name: order_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    wave smallint NOT NULL,
    rank_score numeric(8,4),
    rank_reason jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.offer_status DEFAULT 'offered'::public.offer_status NOT NULL,
    offered_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    responded_at timestamp with time zone,
    reject_reason text,
    CONSTRAINT order_offers_wave_check CHECK (((wave >= 1) AND (wave <= 4)))
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    property_id uuid NOT NULL,
    host_id uuid NOT NULL,
    provider_id uuid,
    tenant_ref text NOT NULL,
    status public.order_status DEFAULT 'created'::public.order_status NOT NULL,
    trigger_type public.trigger_type DEFAULT 'scheduled'::public.trigger_type NOT NULL,
    priority public.order_priority DEFAULT 'normal'::public.order_priority NOT NULL,
    checkout_at timestamp with time zone NOT NULL,
    checkin_at timestamp with time zone NOT NULL,
    spec jsonb DEFAULT '{}'::jsonb NOT NULL,
    base_amount bigint DEFAULT 0 NOT NULL,
    urgent_premium bigint DEFAULT 0 NOT NULL,
    charge_amount bigint DEFAULT 0 NOT NULL,
    payout_gross bigint DEFAULT 0 NOT NULL,
    withholding_amount bigint DEFAULT 0 NOT NULL,
    fault public.fault_party DEFAULT 'none'::public.fault_party NOT NULL,
    cancel_reason text,
    completion_photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    checklist jsonb DEFAULT '{}'::jsonb NOT NULL,
    billing_verified_at timestamp with time zone,
    broadcast_at timestamp with time zone,
    accepted_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    charged_at timestamp with time zone,
    paid_out_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    replaces_order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    auto_confirm_at timestamp with time zone,
    next_checkin_at timestamp with time zone,
    deadline_at timestamp with time zone,
    scheduled_at timestamp with time zone,
    arrival_at timestamp with time zone,
    free_change_until timestamp with time zone,
    sequence integer DEFAULT 0 NOT NULL,
    failure_code text,
    failure_reason text,
    env text DEFAULT 'live'::text NOT NULL,
    tenant_reported_fault public.fault_party,
    backup_provider_id uuid,
    arrival_photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    previous_order_id uuid,
    CONSTRAINT orders_base_amount_check CHECK ((base_amount >= 0)),
    CONSTRAINT orders_charge_amount_check CHECK ((charge_amount >= 0)),
    CONSTRAINT orders_env_check CHECK ((env = ANY (ARRAY['live'::text, 'test'::text]))),
    CONSTRAINT orders_payout_gross_check CHECK ((payout_gross >= 0)),
    CONSTRAINT orders_time_window CHECK ((checkin_at < checkout_at)),
    CONSTRAINT orders_urgent_premium_check CHECK ((urgent_premium >= 0)),
    CONSTRAINT orders_withholding_amount_check CHECK ((withholding_amount >= 0))
);


--
-- Name: COLUMN orders.auto_confirm_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.auto_confirm_at IS '호스트 무이의 시 자동 confirmed 시각. completed 전이 시 EF가 계산해 기록 (§13 #4).';


--
-- Name: COLUMN orders.next_checkin_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.next_checkin_at IS '다음 예약 체크인 = 청소 마감 힌트. 선택. 테넌트가 나중에 PATCH로 채울 수 있다.';


--
-- Name: COLUMN orders.deadline_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.deadline_at IS '서버 계산 최종 마감. next_checkin_at 또는 checkout_at + properties.cleaning_deadline_hours.';


--
-- Name: COLUMN orders.scheduled_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.scheduled_at IS '배차 확정된 청소 예정 시각. accepted 전이 시 확정. 변경 시 order.rescheduled 발송.';


--
-- Name: COLUMN orders.arrival_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.arrival_at IS '공급자 실제 도착 시각. in_progress 전이 시 기록.';


--
-- Name: COLUMN orders.free_change_until; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.free_change_until IS '무보상 변경·취소 시한. 배차 전 null(언제든 무보상). 배차 후 scheduled_at - 24h.
   공급자 사유로 scheduled_at이 당겨져도 줄어들지 않는다: max(기존, 새 scheduled_at - 24h).';


--
-- Name: COLUMN orders.sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.sequence IS '발주별 단조 증가. webhook 순서 판정용. 상태·scheduled_at 변경 시 +1. 절대 감소하지 않는다.';


--
-- Name: COLUMN orders.tenant_reported_fault; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.tenant_reported_fault IS '테넌트가 신고한 귀책(참고값). 최종 판정은 fault 컬럼. 분쟁 시 근거로 보존.';


--
-- Name: COLUMN orders.backup_provider_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.backup_provider_id IS '백업 공급자 사전 지정(Turno 벤치마킹). 주 공급자 펑크 시 재브로드캐스트 없이 승계.';


--
-- Name: COLUMN orders.arrival_photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.arrival_photos IS '청소 착수 전 사진. [{angle, path, at}]. in_progress 전이 시 기록.
   호스트 시설점검용 — 게스트 점유 구간 = previous_order.completion_photos ~ 이 값.
   path만 저장하고 URL은 조회 시 서명 발급(1시간). 완료 후 90일 보존.';


--
-- Name: COLUMN orders.previous_order_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.previous_order_id IS '같은 매물의 직전 완료 발주. 전/후 비교 렌더링용.';


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    billing_key_id uuid,
    kind public.payment_kind NOT NULL,
    status public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
    amount bigint DEFAULT 0 NOT NULL,
    attempt smallint DEFAULT 1 NOT NULL,
    pg_tx_id text,
    failure_code text,
    failure_message text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT payments_amount_check CHECK ((amount >= 0))
);


--
-- Name: payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    provider_type public.provider_type NOT NULL,
    gross_amount bigint NOT NULL,
    withholding_amount bigint DEFAULT 0 NOT NULL,
    net_amount bigint NOT NULL,
    status public.payout_status DEFAULT 'pending'::public.payout_status NOT NULL,
    scheduled_at timestamp with time zone,
    paid_at timestamp with time zone,
    transfer_ref text,
    failure_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payouts_amount_balance CHECK ((net_amount = (gross_amount - withholding_amount))),
    CONSTRAINT payouts_gross_amount_check CHECK ((gross_amount >= 0)),
    CONSTRAINT payouts_net_amount_check CHECK ((net_amount >= 0)),
    CONSTRAINT payouts_withholding_amount_check CHECK ((withholding_amount >= 0))
);


--
-- Name: properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.properties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    host_id uuid NOT NULL,
    tenant_property_ref text NOT NULL,
    name text,
    address text NOT NULL,
    address_detail text,
    region_code text,
    size_pyeong numeric(6,1),
    spec jsonb DEFAULT '{}'::jsonb NOT NULL,
    base_price bigint,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lat double precision,
    lng double precision,
    cleaning_deadline_hours integer DEFAULT 24 NOT NULL,
    env text DEFAULT 'live'::text NOT NULL,
    CONSTRAINT properties_base_price_check CHECK ((base_price >= 0)),
    CONSTRAINT properties_env_check CHECK ((env = ANY (ARRAY['live'::text, 'test'::text]))),
    CONSTRAINT properties_latlng_range CHECK ((((lat IS NULL) AND (lng IS NULL)) OR (((lat >= (33)::double precision) AND (lat <= (39)::double precision)) AND ((lng >= (124)::double precision) AND (lng <= (132)::double precision))))),
    CONSTRAINT properties_region_is_dong CHECK (((region_code ~ '^[0-9]{10}$'::text) AND ("right"(region_code, 5) <> '00000'::text))),
    CONSTRAINT properties_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pending_coverage'::text, 'inactive'::text])))
);


--
-- Name: COLUMN properties.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.properties.status IS 'active=발주 가능 / pending_coverage=등록됐으나 서비스 지역 밖 / inactive=비활성';


--
-- Name: COLUMN properties.lat; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.properties.lat IS '위도. 좌표계 WGS84 (카카오맵·구글맵 기준). TM/KATEC 아님.';


--
-- Name: COLUMN properties.cleaning_deadline_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.properties.cleaning_deadline_hours IS 'next_checkin_at 부재 시 마감 = checkout_at + 이 값. 기본 24시간.';


--
-- Name: property_access_info; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_access_info (
    property_id uuid NOT NULL,
    ciphertext text NOT NULL,
    key_version smallint DEFAULT 1 NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: provider_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_events (
    id bigint NOT NULL,
    provider_id uuid NOT NULL,
    event public.provider_event_type NOT NULL,
    reason text,
    actor text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT provider_events_reason_required CHECK (((event <> ALL (ARRAY['rejected'::public.provider_event_type, 'warned'::public.provider_event_type, 'suspended'::public.provider_event_type, 'banned'::public.provider_event_type])) OR (reason IS NOT NULL)))
);


--
-- Name: provider_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.provider_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: provider_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.provider_events_id_seq OWNED BY public.provider_events.id;


--
-- Name: provider_service_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_service_areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid NOT NULL,
    region_code text NOT NULL,
    level public.service_area_level NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT provider_service_areas_region_code_check CHECK ((region_code ~ '^[0-9]{2,10}$'::text)),
    CONSTRAINT service_area_level_length CHECK ((((level = 'city'::public.service_area_level) AND (length(region_code) = 2)) OR ((level = 'gu'::public.service_area_level) AND (length(region_code) = 5)) OR ((level = 'dong'::public.service_area_level) AND (length(region_code) = 10))))
);


--
-- Name: providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id uuid,
    type public.provider_type NOT NULL,
    status public.provider_status DEFAULT 'registered'::public.provider_status NOT NULL,
    display_name text NOT NULL,
    phone text NOT NULL,
    email text,
    bank_code text,
    bank_account_no text,
    bank_holder text,
    account_verified_at timestamp with time zone,
    business_no text,
    rep_name text,
    open_date date,
    biz_verify_status public.biz_verify_status,
    biz_status public.biz_status,
    biz_verified_at timestamp with time zone,
    license_image_url text,
    identity_verified_at timestamp with time zone,
    rating numeric(3,2),
    completed_count integer DEFAULT 0 NOT NULL,
    noshow_count integer DEFAULT 0 NOT NULL,
    late_cancel_count integer DEFAULT 0 NOT NULL,
    fault_claim_count integer DEFAULT 0 NOT NULL,
    last_offered_at timestamp with time zone,
    last_dispatched_at timestamp with time zone,
    suspended_until timestamp with time zone,
    status_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT providers_business_fields CHECK (((type <> 'business'::public.provider_type) OR ((business_no IS NOT NULL) AND (rep_name IS NOT NULL) AND (open_date IS NOT NULL)))),
    CONSTRAINT providers_business_no_format CHECK (((business_no IS NULL) OR (business_no ~ '^[0-9]{10}$'::text))),
    CONSTRAINT providers_rating_check CHECK (((rating >= (0)::numeric) AND (rating <= (5)::numeric)))
);


--
-- Name: region_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.region_codes (
    code text NOT NULL,
    sido text NOT NULL,
    sigungu text,
    eupmyeondong text,
    full_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_serviceable boolean DEFAULT false NOT NULL,
    CONSTRAINT region_codes_code_check CHECK ((code ~ '^[0-9]{10}$'::text))
);


--
-- Name: COLUMN region_codes.is_serviceable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.region_codes.is_serviceable IS 'GET /coverage 응답 기준. 공급자 확보에 따라 운영자가 토글한다.';


--
-- Name: tenant_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    label text,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    env text DEFAULT 'live'::text NOT NULL,
    CONSTRAINT tenant_api_keys_env_check CHECK ((env = ANY (ARRAY['live'::text, 'test'::text])))
);


--
-- Name: COLUMN tenant_api_keys.env; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant_api_keys.env IS 'ck_live_* / ck_test_*. test 키는 실제 배차·청구를 발생시키지 않는다.';


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    webhook_url text,
    webhook_secret text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    webhook_secret_prev text,
    webhook_secret_rotated_at timestamp with time zone,
    CONSTRAINT tenants_slug_check CHECK ((slug ~ '^[a-z0-9-]{2,40}$'::text)),
    CONSTRAINT tenants_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
);


--
-- Name: webhook_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid,
    claim_id uuid,
    event text NOT NULL,
    sequence integer,
    occurred_at timestamp with time zone NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt smallint DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    last_status_code integer,
    last_error text,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT webhook_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'delivered'::text, 'failed'::text, 'dead'::text])))
);


--
-- Name: TABLE webhook_deliveries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.webhook_deliveries IS '발송 원장. 재시도 1m→5m→15m→1h→6h→24h(최대 6회) 후 dead. 운영자 확인 대상.';


--
-- Name: access_info_views id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_info_views ALTER COLUMN id SET DEFAULT nextval('public.access_info_views_id_seq'::regclass);


--
-- Name: order_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events ALTER COLUMN id SET DEFAULT nextval('public.order_events_id_seq'::regclass);


--
-- Name: provider_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_events ALTER COLUMN id SET DEFAULT nextval('public.provider_events_id_seq'::regclass);


--
-- Name: access_info_views access_info_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_info_views
    ADD CONSTRAINT access_info_views_pkey PRIMARY KEY (id);


--
-- Name: access_update_tokens access_update_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_update_tokens
    ADD CONSTRAINT access_update_tokens_pkey PRIMARY KEY (id);


--
-- Name: access_update_tokens access_update_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_update_tokens
    ADD CONSTRAINT access_update_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: billing_keys billing_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_keys
    ADD CONSTRAINT billing_keys_pkey PRIMARY KEY (id);


--
-- Name: claims claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_pkey PRIMARY KEY (id);


--
-- Name: hosts hosts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hosts
    ADD CONSTRAINT hosts_pkey PRIMARY KEY (id);


--
-- Name: hosts hosts_tenant_id_tenant_host_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hosts
    ADD CONSTRAINT hosts_tenant_id_tenant_host_ref_key UNIQUE (tenant_id, tenant_host_ref);


--
-- Name: order_access_info order_access_info_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_access_info
    ADD CONSTRAINT order_access_info_pkey PRIMARY KEY (order_id);


--
-- Name: order_events order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_pkey PRIMARY KEY (id);


--
-- Name: order_issues order_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_issues
    ADD CONSTRAINT order_issues_pkey PRIMARY KEY (id);


--
-- Name: order_offers order_offers_order_id_provider_id_wave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_offers
    ADD CONSTRAINT order_offers_order_id_provider_id_wave_key UNIQUE (order_id, provider_id, wave);


--
-- Name: order_offers order_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_offers
    ADD CONSTRAINT order_offers_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pg_tx_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pg_tx_id_key UNIQUE (pg_tx_id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_order_id_key UNIQUE (order_id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);


--
-- Name: properties properties_tenant_id_tenant_property_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_tenant_id_tenant_property_ref_key UNIQUE (tenant_id, tenant_property_ref);


--
-- Name: property_access_info property_access_info_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_access_info
    ADD CONSTRAINT property_access_info_pkey PRIMARY KEY (property_id);


--
-- Name: provider_events provider_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_events
    ADD CONSTRAINT provider_events_pkey PRIMARY KEY (id);


--
-- Name: provider_service_areas provider_service_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_service_areas
    ADD CONSTRAINT provider_service_areas_pkey PRIMARY KEY (id);


--
-- Name: provider_service_areas provider_service_areas_provider_id_region_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_service_areas
    ADD CONSTRAINT provider_service_areas_provider_id_region_code_key UNIQUE (provider_id, region_code);


--
-- Name: providers providers_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: providers providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (id);


--
-- Name: region_codes region_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.region_codes
    ADD CONSTRAINT region_codes_pkey PRIMARY KEY (code);


--
-- Name: tenant_api_keys tenant_api_keys_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_api_keys
    ADD CONSTRAINT tenant_api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: tenant_api_keys tenant_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_api_keys
    ADD CONSTRAINT tenant_api_keys_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: webhook_deliveries webhook_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);


--
-- Name: access_views_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX access_views_order_idx ON public.access_info_views USING btree (order_id, at DESC);


--
-- Name: billing_keys_active_per_host; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX billing_keys_active_per_host ON public.billing_keys USING btree (host_id) WHERE (status = 'active'::public.billing_key_status);


--
-- Name: claims_fault_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claims_fault_idx ON public.claims USING btree (fault, status) WHERE (fault = 'provider'::public.fault_party);


--
-- Name: claims_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claims_order_idx ON public.claims USING btree (order_id);


--
-- Name: order_access_purge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_access_purge_idx ON public.order_access_info USING btree (purge_after) WHERE (purged_at IS NULL);


--
-- Name: order_events_order_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_events_order_at_idx ON public.order_events USING btree (order_id, at DESC);


--
-- Name: order_issues_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_issues_order_idx ON public.order_issues USING btree (order_id, reported_at DESC);


--
-- Name: order_offers_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_offers_open_idx ON public.order_offers USING btree (provider_id, status) WHERE (status = 'offered'::public.offer_status);


--
-- Name: order_offers_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_offers_order_idx ON public.order_offers USING btree (order_id, wave);


--
-- Name: order_offers_single_accept; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_offers_single_accept ON public.order_offers USING btree (order_id) WHERE (status = 'accepted'::public.offer_status);


--
-- Name: orders_auto_confirm_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_auto_confirm_due_idx ON public.orders USING btree (auto_confirm_at) WHERE (status = 'completed'::public.order_status);


--
-- Name: orders_deadline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_deadline_idx ON public.orders USING btree (deadline_at) WHERE (status = ANY (ARRAY['broadcasting'::public.order_status, 'escalated'::public.order_status, 'reassigning'::public.order_status]));


--
-- Name: orders_dispatch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_dispatch_idx ON public.orders USING btree (status, checkin_at) WHERE (status = ANY (ARRAY['broadcasting'::public.order_status, 'escalated'::public.order_status, 'reassigning'::public.order_status]));


--
-- Name: orders_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orders_idempotency_idx ON public.orders USING btree (tenant_id, tenant_ref, trigger_type, env);


--
-- Name: orders_prev_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_prev_idx ON public.orders USING btree (previous_order_id);


--
-- Name: orders_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_provider_idx ON public.orders USING btree (provider_id, status);


--
-- Name: orders_tenant_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_tenant_ref_idx ON public.orders USING btree (tenant_id, tenant_ref);


--
-- Name: payments_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_order_idx ON public.payments USING btree (order_id, kind, attempt);


--
-- Name: payouts_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payouts_provider_idx ON public.payouts USING btree (provider_id, status);


--
-- Name: properties_host_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX properties_host_idx ON public.properties USING btree (host_id);


--
-- Name: properties_pending_coverage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX properties_pending_coverage_idx ON public.properties USING btree (region_code) WHERE (status = 'pending_coverage'::text);


--
-- Name: properties_region_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX properties_region_idx ON public.properties USING btree (region_code);


--
-- Name: provider_events_provider_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_events_provider_at_idx ON public.provider_events USING btree (provider_id, at DESC);


--
-- Name: provider_service_areas_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_service_areas_code_idx ON public.provider_service_areas USING btree (region_code text_pattern_ops);


--
-- Name: providers_business_no_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX providers_business_no_uniq ON public.providers USING btree (business_no) WHERE (business_no IS NOT NULL);


--
-- Name: providers_dispatchable_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX providers_dispatchable_idx ON public.providers USING btree (status) WHERE (status = ANY (ARRAY['active'::public.provider_status, 'warned'::public.provider_status]));


--
-- Name: region_codes_prefix_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX region_codes_prefix_idx ON public.region_codes USING btree (code text_pattern_ops);


--
-- Name: tenant_api_keys_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_api_keys_tenant_idx ON public.tenant_api_keys USING btree (tenant_id) WHERE (revoked_at IS NULL);


--
-- Name: webhook_dead_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhook_dead_idx ON public.webhook_deliveries USING btree (tenant_id, created_at DESC) WHERE (status = 'dead'::text);


--
-- Name: webhook_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhook_retry_idx ON public.webhook_deliveries USING btree (next_retry_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));


--
-- Name: access_info_views access_views_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER access_views_no_delete BEFORE DELETE ON public.access_info_views FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: access_info_views access_views_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER access_views_no_update BEFORE UPDATE ON public.access_info_views FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: billing_keys billing_keys_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER billing_keys_set_updated_at BEFORE UPDATE ON public.billing_keys FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: claims claims_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER claims_set_updated_at BEFORE UPDATE ON public.claims FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: hosts hosts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hosts_set_updated_at BEFORE UPDATE ON public.hosts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: order_events order_events_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_events_no_delete BEFORE DELETE ON public.order_events FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: order_events order_events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_events_no_update BEFORE UPDATE ON public.order_events FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: orders orders_bump_sequence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_bump_sequence BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.bump_order_sequence();


--
-- Name: orders orders_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: properties properties_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER properties_set_updated_at BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: provider_events provider_events_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER provider_events_no_delete BEFORE DELETE ON public.provider_events FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: provider_events provider_events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER provider_events_no_update BEFORE UPDATE ON public.provider_events FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: providers providers_guard_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER providers_guard_status BEFORE UPDATE ON public.providers FOR EACH ROW EXECUTE FUNCTION public.guard_provider_status();


--
-- Name: providers providers_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER providers_set_updated_at BEFORE UPDATE ON public.providers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tenants tenants_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: access_info_views access_info_views_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_info_views
    ADD CONSTRAINT access_info_views_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: access_info_views access_info_views_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_info_views
    ADD CONSTRAINT access_info_views_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;


--
-- Name: access_update_tokens access_update_tokens_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_update_tokens
    ADD CONSTRAINT access_update_tokens_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.hosts(id) ON DELETE CASCADE;


--
-- Name: access_update_tokens access_update_tokens_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_update_tokens
    ADD CONSTRAINT access_update_tokens_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: access_update_tokens access_update_tokens_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_update_tokens
    ADD CONSTRAINT access_update_tokens_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: billing_keys billing_keys_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_keys
    ADD CONSTRAINT billing_keys_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.hosts(id) ON DELETE CASCADE;


--
-- Name: claims claims_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: hosts hosts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hosts
    ADD CONSTRAINT hosts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;


--
-- Name: order_access_info order_access_info_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_access_info
    ADD CONSTRAINT order_access_info_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_events order_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_issues order_issues_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_issues
    ADD CONSTRAINT order_issues_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_offers order_offers_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_offers
    ADD CONSTRAINT order_offers_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_offers order_offers_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_offers
    ADD CONSTRAINT order_offers_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: orders orders_backup_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_backup_provider_id_fkey FOREIGN KEY (backup_provider_id) REFERENCES public.providers(id) ON DELETE SET NULL;


--
-- Name: orders orders_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.hosts(id) ON DELETE RESTRICT;


--
-- Name: orders orders_previous_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_previous_order_id_fkey FOREIGN KEY (previous_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: orders orders_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE RESTRICT;


--
-- Name: orders orders_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE SET NULL;


--
-- Name: orders orders_replaces_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_replaces_order_id_fkey FOREIGN KEY (replaces_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: orders orders_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;


--
-- Name: payments payments_billing_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_billing_key_id_fkey FOREIGN KEY (billing_key_id) REFERENCES public.billing_keys(id) ON DELETE SET NULL;


--
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: payouts payouts_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: payouts payouts_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE RESTRICT;


--
-- Name: properties properties_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.hosts(id) ON DELETE RESTRICT;


--
-- Name: properties properties_region_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_region_code_fkey FOREIGN KEY (region_code) REFERENCES public.region_codes(code);


--
-- Name: properties properties_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;


--
-- Name: property_access_info property_access_info_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_access_info
    ADD CONSTRAINT property_access_info_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: provider_events provider_events_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_events
    ADD CONSTRAINT provider_events_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: provider_service_areas provider_service_areas_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_service_areas
    ADD CONSTRAINT provider_service_areas_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: providers providers_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: tenant_api_keys tenant_api_keys_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_api_keys
    ADD CONSTRAINT tenant_api_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: webhook_deliveries webhook_deliveries_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE CASCADE;


--
-- Name: webhook_deliveries webhook_deliveries_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: webhook_deliveries webhook_deliveries_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: access_info_views; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.access_info_views ENABLE ROW LEVEL SECURITY;

--
-- Name: access_update_tokens access_tokens_no_client; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY access_tokens_no_client ON public.access_update_tokens FOR SELECT TO authenticated USING (false);


--
-- Name: access_update_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.access_update_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: access_info_views access_views_operator_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY access_views_operator_read ON public.access_info_views FOR SELECT TO authenticated USING (public.is_operator());


--
-- Name: billing_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_keys billing_keys_no_client_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_keys_no_client_access ON public.billing_keys FOR SELECT TO authenticated USING (false);


--
-- Name: claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

--
-- Name: claims claims_operator_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY claims_operator_read ON public.claims FOR SELECT TO authenticated USING (public.is_operator());


--
-- Name: hosts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hosts ENABLE ROW LEVEL SECURITY;

--
-- Name: hosts hosts_operator_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hosts_operator_read ON public.hosts FOR SELECT TO authenticated USING (public.is_operator());


--
-- Name: order_access_info; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_access_info ENABLE ROW LEVEL SECURITY;

--
-- Name: order_access_info order_access_no_client; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_access_no_client ON public.order_access_info FOR SELECT TO authenticated USING (false);


--
-- Name: order_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

--
-- Name: order_events order_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_events_read ON public.order_events FOR SELECT TO authenticated USING ((public.is_operator() OR (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_events.order_id) AND (o.provider_id = public.current_provider_id()))))));


--
-- Name: order_issues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_issues ENABLE ROW LEVEL SECURITY;

--
-- Name: order_issues order_issues_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_issues_read ON public.order_issues FOR SELECT TO authenticated USING ((public.is_operator() OR (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_issues.order_id) AND (o.provider_id = public.current_provider_id()))))));


--
-- Name: order_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: order_offers order_offers_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_offers_self_read ON public.order_offers FOR SELECT TO authenticated USING (((provider_id = public.current_provider_id()) OR public.is_operator()));


--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: orders orders_assigned_provider_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_assigned_provider_read ON public.orders FOR SELECT TO authenticated USING ((provider_id = public.current_provider_id()));


--
-- Name: orders orders_operator_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_operator_read ON public.orders FOR SELECT TO authenticated USING (public.is_operator());


--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payments payments_operator_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_operator_read ON public.payments FOR SELECT TO authenticated USING (public.is_operator());


--
-- Name: payouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

--
-- Name: payouts payouts_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payouts_self_read ON public.payouts FOR SELECT TO authenticated USING (((provider_id = public.current_provider_id()) OR public.is_operator()));


--
-- Name: properties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

--
-- Name: properties properties_assigned_provider_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY properties_assigned_provider_read ON public.properties FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.property_id = properties.id) AND (o.provider_id = public.current_provider_id())))));


--
-- Name: properties properties_operator_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY properties_operator_read ON public.properties FOR SELECT TO authenticated USING (public.is_operator());


--
-- Name: property_access_info; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.property_access_info ENABLE ROW LEVEL SECURITY;

--
-- Name: property_access_info property_access_no_client; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY property_access_no_client ON public.property_access_info FOR SELECT TO authenticated USING (false);


--
-- Name: provider_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_events ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_events provider_events_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY provider_events_self_read ON public.provider_events FOR SELECT TO authenticated USING (((provider_id = public.current_provider_id()) OR public.is_operator()));


--
-- Name: provider_service_areas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_service_areas ENABLE ROW LEVEL SECURITY;

--
-- Name: providers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

--
-- Name: providers providers_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY providers_self_read ON public.providers FOR SELECT TO authenticated USING (((auth_user_id = auth.uid()) OR public.is_operator()));


--
-- Name: providers providers_self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY providers_self_update ON public.providers FOR UPDATE TO authenticated USING ((auth_user_id = auth.uid())) WITH CHECK ((auth_user_id = auth.uid()));


--
-- Name: region_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.region_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: region_codes region_codes_read_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY region_codes_read_authenticated ON public.region_codes FOR SELECT TO authenticated USING (true);


--
-- Name: provider_service_areas service_areas_self_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_areas_self_delete ON public.provider_service_areas FOR DELETE TO authenticated USING ((provider_id = public.current_provider_id()));


--
-- Name: provider_service_areas service_areas_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_areas_self_read ON public.provider_service_areas FOR SELECT TO authenticated USING (((provider_id = public.current_provider_id()) OR public.is_operator()));


--
-- Name: provider_service_areas service_areas_self_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_areas_self_write ON public.provider_service_areas FOR INSERT TO authenticated WITH CHECK ((provider_id = public.current_provider_id()));


--
-- Name: tenant_api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_api_keys tenant_api_keys_no_client_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_api_keys_no_client_access ON public.tenant_api_keys FOR SELECT TO authenticated USING (false);


--
-- Name: tenants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

--
-- Name: tenants tenants_operator_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenants_operator_read ON public.tenants FOR SELECT TO authenticated USING (public.is_operator());


--
-- Name: webhook_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_deliveries webhook_operator_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_operator_read ON public.webhook_deliveries FOR SELECT TO authenticated USING (public.is_operator());


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION bump_order_sequence(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.bump_order_sequence() TO anon;
GRANT ALL ON FUNCTION public.bump_order_sequence() TO authenticated;
GRANT ALL ON FUNCTION public.bump_order_sequence() TO service_role;


--
-- Name: FUNCTION current_provider_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.current_provider_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_provider_id() TO service_role;


--
-- Name: FUNCTION forbid_mutation(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.forbid_mutation() TO authenticated;
GRANT ALL ON FUNCTION public.forbid_mutation() TO service_role;


--
-- Name: FUNCTION guard_provider_status(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_provider_status() TO authenticated;
GRANT ALL ON FUNCTION public.guard_provider_status() TO service_role;


--
-- Name: FUNCTION is_operator(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_operator() TO authenticated;
GRANT ALL ON FUNCTION public.is_operator() TO service_role;


--
-- Name: FUNCTION provider_covers_region(p_provider_id uuid, p_region_code text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.provider_covers_region(p_provider_id uuid, p_region_code text) TO authenticated;
GRANT ALL ON FUNCTION public.provider_covers_region(p_provider_id uuid, p_region_code text) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: TABLE access_info_views; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.access_info_views TO authenticated;
GRANT ALL ON TABLE public.access_info_views TO service_role;


--
-- Name: SEQUENCE access_info_views_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.access_info_views_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.access_info_views_id_seq TO service_role;


--
-- Name: TABLE access_update_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.access_update_tokens TO authenticated;
GRANT ALL ON TABLE public.access_update_tokens TO service_role;


--
-- Name: TABLE billing_keys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.billing_keys TO authenticated;
GRANT ALL ON TABLE public.billing_keys TO service_role;


--
-- Name: TABLE claims; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.claims TO authenticated;
GRANT ALL ON TABLE public.claims TO service_role;


--
-- Name: TABLE hosts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hosts TO authenticated;
GRANT ALL ON TABLE public.hosts TO service_role;


--
-- Name: TABLE order_access_info; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_access_info TO authenticated;
GRANT ALL ON TABLE public.order_access_info TO service_role;


--
-- Name: TABLE order_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_events TO authenticated;
GRANT ALL ON TABLE public.order_events TO service_role;


--
-- Name: SEQUENCE order_events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.order_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.order_events_id_seq TO service_role;


--
-- Name: TABLE order_issues; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_issues TO authenticated;
GRANT ALL ON TABLE public.order_issues TO service_role;


--
-- Name: TABLE order_offers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_offers TO authenticated;
GRANT ALL ON TABLE public.order_offers TO service_role;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;


--
-- Name: TABLE payouts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payouts TO authenticated;
GRANT ALL ON TABLE public.payouts TO service_role;


--
-- Name: TABLE properties; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.properties TO authenticated;
GRANT ALL ON TABLE public.properties TO service_role;


--
-- Name: TABLE property_access_info; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.property_access_info TO authenticated;
GRANT ALL ON TABLE public.property_access_info TO service_role;


--
-- Name: TABLE provider_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.provider_events TO authenticated;
GRANT ALL ON TABLE public.provider_events TO service_role;


--
-- Name: SEQUENCE provider_events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.provider_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.provider_events_id_seq TO service_role;


--
-- Name: TABLE provider_service_areas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.provider_service_areas TO authenticated;
GRANT ALL ON TABLE public.provider_service_areas TO service_role;


--
-- Name: TABLE providers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.providers TO authenticated;
GRANT ALL ON TABLE public.providers TO service_role;


--
-- Name: TABLE region_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.region_codes TO authenticated;
GRANT ALL ON TABLE public.region_codes TO service_role;


--
-- Name: TABLE tenant_api_keys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tenant_api_keys TO authenticated;
GRANT ALL ON TABLE public.tenant_api_keys TO service_role;


--
-- Name: TABLE tenants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tenants TO authenticated;
GRANT ALL ON TABLE public.tenants TO service_role;


--
-- Name: TABLE webhook_deliveries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.webhook_deliveries TO authenticated;
GRANT ALL ON TABLE public.webhook_deliveries TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--



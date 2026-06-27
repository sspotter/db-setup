-- =============================================================================
-- TikSurfur v3 — Keyword-Centric Intelligence Architecture
-- Migration: v3_keyword_schema.sql
-- Created: 2026-05-14
--
-- Run this against your dev database:
--   psql -U devuser -d your_db -f migrations/v3_keyword_schema.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. search_keywords
--    Primary discovery entity. One keyword = one dataset pipeline per project.
--    Auto-created when user searches a new term on TikTok.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.search_keywords (
    id                  uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id          uuid NOT NULL,
    keyword             varchar(255) NOT NULL,
    platform            varchar(50) DEFAULT 'tiktok' NOT NULL,
    status              varchar(50) DEFAULT 'active' NOT NULL,
    -- Aggregated counters (updated by triggers or background jobs)
    total_videos        integer DEFAULT 0,
    total_creators      integer DEFAULT 0,
    total_views         bigint  DEFAULT 0,
    total_engagement    bigint  DEFAULT 0,
    created_at          timestamptz DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamptz DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT search_keywords_pkey PRIMARY KEY (id),
    CONSTRAINT search_keywords_project_keyword_unique UNIQUE (project_id, keyword),
    CONSTRAINT search_keywords_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
    CONSTRAINT search_keywords_status_check
        CHECK (status IN ('active', 'paused', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_search_keywords_project
    ON public.search_keywords USING btree (project_id);

CREATE INDEX IF NOT EXISTS idx_search_keywords_keyword
    ON public.search_keywords USING btree (keyword);

-- ---------------------------------------------------------------------------
-- 2. keyword_search_sessions
--    Each surf on TikTok for a keyword = one session.
--    Provides full traceability of when data was captured.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.keyword_search_sessions (
    id               uuid DEFAULT gen_random_uuid() NOT NULL,
    keyword_id       uuid NOT NULL,
    project_id       uuid NOT NULL,
    status           varchar(50) DEFAULT 'active' NOT NULL,
    videos_captured  integer DEFAULT 0,
    scroll_position  integer DEFAULT 0,   -- last known scroll depth (px)
    started_at       timestamptz DEFAULT CURRENT_TIMESTAMP,
    ended_at         timestamptz,
    created_at       timestamptz DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT keyword_search_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT keyword_search_sessions_keyword_id_fkey
        FOREIGN KEY (keyword_id) REFERENCES public.search_keywords(id) ON DELETE CASCADE,
    CONSTRAINT keyword_search_sessions_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
    CONSTRAINT keyword_search_sessions_status_check
        CHECK (status IN ('active', 'paused', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_kw_sessions_keyword
    ON public.keyword_search_sessions USING btree (keyword_id);

CREATE INDEX IF NOT EXISTS idx_kw_sessions_project
    ON public.keyword_search_sessions USING btree (project_id);

CREATE INDEX IF NOT EXISTS idx_kw_sessions_status
    ON public.keyword_search_sessions USING btree (status);

-- ---------------------------------------------------------------------------
-- 3. tiktok_creators
--    Creators discovered DYNAMICALLY from keyword search results.
--    NOT manually tracked — they emerge from the data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tiktok_creators (
    id               uuid DEFAULT gen_random_uuid() NOT NULL,
    tiktok_user_id   varchar(255) NOT NULL,
    username         varchar(255) NOT NULL,
    display_name     varchar(255),
    avatar_url       text,
    follower_count   bigint  DEFAULT 0,
    following_count  integer DEFAULT 0,
    video_count      integer DEFAULT 0,
    biography        text,
    is_verified      boolean DEFAULT false,
    first_seen_at    timestamptz DEFAULT CURRENT_TIMESTAMP,
    last_updated_at  timestamptz DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT tiktok_creators_pkey PRIMARY KEY (id),
    CONSTRAINT tiktok_creators_tiktok_user_id_unique UNIQUE (tiktok_user_id),
    CONSTRAINT tiktok_creators_username_unique UNIQUE (username)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_creators_username
    ON public.tiktok_creators USING btree (username);

-- ---------------------------------------------------------------------------
-- 4. tiktok_videos
--    Videos discovered from keyword search feeds.
--    Includes analyst qualification flags — the KEY v3 feature.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tiktok_videos (
    id                      uuid DEFAULT gen_random_uuid() NOT NULL,
    video_id                varchar(255) NOT NULL,
    keyword_id              uuid NOT NULL,
    session_id              uuid,
    creator_id              uuid,
    project_id              uuid NOT NULL,

    -- Content
    caption                 text,
    video_url               text,
    thumbnail_url           text,
    duration                integer DEFAULT 0,

    -- Engagement metrics (captured at scrape time)
    views_count             bigint  DEFAULT 0,
    likes_count             bigint  DEFAULT 0,
    comments_count          integer DEFAULT 0,
    shares_count            integer DEFAULT 0,
    bookmarks_count         integer DEFAULT 0,

    -- Analyst qualification flags (v3 differentiator)
    -- These control which videos contribute to analytics/reach calculations
    included_in_reach       boolean DEFAULT true,
    included_in_engagement  boolean DEFAULT true,
    included_in_reporting   boolean DEFAULT true,
    manual_reviewed         boolean DEFAULT false,
    relevance_score         integer DEFAULT 0 CHECK (relevance_score BETWEEN 0 AND 100),

    -- Capture pipeline status
    capture_status          varchar(50) DEFAULT 'captured' NOT NULL,

    -- Timestamps
    posted_at               timestamptz,
    captured_at             timestamptz DEFAULT CURRENT_TIMESTAMP,
    updated_at              timestamptz DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT tiktok_videos_pkey PRIMARY KEY (id),
    CONSTRAINT tiktok_videos_video_keyword_unique UNIQUE (video_id, keyword_id),
    CONSTRAINT tiktok_videos_keyword_id_fkey
        FOREIGN KEY (keyword_id) REFERENCES public.search_keywords(id) ON DELETE CASCADE,
    CONSTRAINT tiktok_videos_session_id_fkey
        FOREIGN KEY (session_id) REFERENCES public.keyword_search_sessions(id) ON DELETE SET NULL,
    CONSTRAINT tiktok_videos_creator_id_fkey
        FOREIGN KEY (creator_id) REFERENCES public.tiktok_creators(id) ON DELETE SET NULL,
    CONSTRAINT tiktok_videos_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
    CONSTRAINT tiktok_videos_capture_status_check
        CHECK (capture_status IN ('captured', 'comments_pending', 'comments_partial', 'comments_done', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_tiktok_videos_keyword
    ON public.tiktok_videos USING btree (keyword_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_videos_session
    ON public.tiktok_videos USING btree (session_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_videos_creator
    ON public.tiktok_videos USING btree (creator_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_videos_project
    ON public.tiktok_videos USING btree (project_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_videos_capture_status
    ON public.tiktok_videos USING btree (capture_status);

CREATE INDEX IF NOT EXISTS idx_tiktok_videos_included_reach
    ON public.tiktok_videos USING btree (included_in_reach);

-- ---------------------------------------------------------------------------
-- 5. tiktok_comments
--    Comments captured from opened video pages.
--    Always linked to keyword context for full traceability.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tiktok_comments (
    id                    varchar(255) NOT NULL,
    video_id              varchar(255) NOT NULL,
    keyword_id            uuid,
    commenter_username    varchar(255),
    commenter_user_id     varchar(255),
    commenter_avatar_url  text,
    text                  text,
    likes_count           integer DEFAULT 0,
    reply_count           integer DEFAULT 0,
    is_reply              boolean DEFAULT false,
    parent_comment_id     varchar(255),
    commented_at          timestamptz,
    scraped_at            timestamptz DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT tiktok_comments_pkey PRIMARY KEY (id),
    CONSTRAINT tiktok_comments_keyword_id_fkey
        FOREIGN KEY (keyword_id) REFERENCES public.search_keywords(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tiktok_comments_video
    ON public.tiktok_comments USING btree (video_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_comments_keyword
    ON public.tiktok_comments USING btree (keyword_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_comments_username
    ON public.tiktok_comments USING btree (commenter_username);

-- ---------------------------------------------------------------------------
-- 6. tiktok_hashtags
--    Hashtags extracted per video for trend analysis.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tiktok_hashtags (
    id          uuid DEFAULT gen_random_uuid() NOT NULL,
    video_id    varchar(255) NOT NULL,
    keyword_id  uuid,
    tag         varchar(255) NOT NULL,
    view_count  bigint DEFAULT 0,

    CONSTRAINT tiktok_hashtags_pkey PRIMARY KEY (id),
    CONSTRAINT tiktok_hashtags_video_tag_unique UNIQUE (video_id, tag),
    CONSTRAINT tiktok_hashtags_keyword_id_fkey
        FOREIGN KEY (keyword_id) REFERENCES public.search_keywords(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tiktok_hashtags_video
    ON public.tiktok_hashtags USING btree (video_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_hashtags_keyword
    ON public.tiktok_hashtags USING btree (keyword_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_hashtags_tag
    ON public.tiktok_hashtags USING btree (tag);

-- ---------------------------------------------------------------------------
-- 7. tiktok_graphql_captures
--    Raw GraphQL intercepts from the extension, tagged with full context.
--    Used for auditability + replay capability.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tiktok_graphql_captures (
    id             uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id     uuid,
    keyword_id     uuid,
    video_id       varchar(255),
    creator_id     uuid,
    url            text NOT NULL,
    method         varchar(10) DEFAULT 'GET',
    capture_type   varchar(50) DEFAULT 'unknown',   -- search | video_detail | comment | pagination
    request_body   jsonb,
    response_body  jsonb,
    captured_at    timestamptz DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT tiktok_graphql_captures_pkey PRIMARY KEY (id),
    CONSTRAINT tiktok_graphql_captures_session_id_fkey
        FOREIGN KEY (session_id) REFERENCES public.keyword_search_sessions(id) ON DELETE SET NULL,
    CONSTRAINT tiktok_graphql_captures_keyword_id_fkey
        FOREIGN KEY (keyword_id) REFERENCES public.search_keywords(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_graphql_captures_session
    ON public.tiktok_graphql_captures USING btree (session_id);

CREATE INDEX IF NOT EXISTS idx_graphql_captures_keyword
    ON public.tiktok_graphql_captures USING btree (keyword_id);

CREATE INDEX IF NOT EXISTS idx_graphql_captures_video
    ON public.tiktok_graphql_captures USING btree (video_id);

CREATE INDEX IF NOT EXISTS idx_graphql_captures_type
    ON public.tiktok_graphql_captures USING btree (capture_type);

-- ---------------------------------------------------------------------------
-- 8. tiktok_keyword_creators (junction)
--    Links creators to the keywords they participated in.
--    One creator can appear across multiple keywords.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tiktok_keyword_creators (
    id            uuid DEFAULT gen_random_uuid() NOT NULL,
    keyword_id    uuid NOT NULL,
    creator_id    uuid NOT NULL,
    video_count   integer DEFAULT 1,
    total_views   bigint  DEFAULT 0,
    first_seen_at timestamptz DEFAULT CURRENT_TIMESTAMP,
    last_seen_at  timestamptz DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT tiktok_keyword_creators_pkey PRIMARY KEY (id),
    CONSTRAINT tiktok_keyword_creators_unique UNIQUE (keyword_id, creator_id),
    CONSTRAINT tiktok_keyword_creators_keyword_fkey
        FOREIGN KEY (keyword_id) REFERENCES public.search_keywords(id) ON DELETE CASCADE,
    CONSTRAINT tiktok_keyword_creators_creator_fkey
        FOREIGN KEY (creator_id) REFERENCES public.tiktok_creators(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kw_creators_keyword
    ON public.tiktok_keyword_creators USING btree (keyword_id);

CREATE INDEX IF NOT EXISTS idx_kw_creators_creator
    ON public.tiktok_keyword_creators USING btree (creator_id);

-- ---------------------------------------------------------------------------
-- Done
-- ---------------------------------------------------------------------------
COMMIT;

-- Quick verification query (run manually after migration):
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- AND table_name IN (
--   'search_keywords', 'keyword_search_sessions',
--   'tiktok_creators', 'tiktok_videos', 'tiktok_comments',
--   'tiktok_hashtags', 'tiktok_graphql_captures', 'tiktok_keyword_creators'
-- )
-- ORDER BY table_name;

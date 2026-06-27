BEGIN;

ALTER TABLE public.search_keywords
    ADD COLUMN IF NOT EXISTS source_type varchar(20) DEFAULT 'search' NOT NULL,
    ADD COLUMN IF NOT EXISTS tiktok_challenge_id varchar(50);

ALTER TABLE public.search_keywords
    DROP CONSTRAINT IF EXISTS search_keywords_project_keyword_unique;

ALTER TABLE public.search_keywords
    ADD CONSTRAINT search_keywords_project_keyword_source_unique
        UNIQUE (project_id, keyword, source_type);

ALTER TABLE public.search_keywords
    DROP CONSTRAINT IF EXISTS search_keywords_source_type_check;

ALTER TABLE public.search_keywords
    ADD CONSTRAINT search_keywords_source_type_check
        CHECK (source_type IN ('search', 'hashtag'));

CREATE INDEX IF NOT EXISTS idx_search_keywords_source_type
    ON public.search_keywords (project_id, source_type);

COMMIT;

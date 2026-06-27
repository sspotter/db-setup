-- Complete Database Schema

-- Schema for table comment_scrape_logs

CREATE TABLE "comment_scrape_logs" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid,
    "post_shortcode" character varying(255),
    "api_calls" integer DEFAULT 0,
    "comments_scraped" integer DEFAULT 0,
    "scraped_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table users

CREATE TABLE "users" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "email" character varying(255) NOT NULL,
    "password_hash" character varying(255) NOT NULL,
    "status" character varying(50) DEFAULT 'active'::character varying,
    "plan" character varying(50) DEFAULT 'none'::character varying,
    "active_sessions" integer DEFAULT 0,
    "last_login" timestamp with time zone,
    "max_devices" integer DEFAULT 3,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table comments

CREATE TABLE "comments" (
    "id" character varying(255) NOT NULL,
    "post_shortcode" character varying(255) NOT NULL,
    "username" character varying(255),
    "user_id" character varying(255),
    "text" text,
    "likes_count" integer DEFAULT 0,
    "reply_count" integer DEFAULT 0,
    "profile_pic_url" text,
    "commented_at" timestamp with time zone,
    "scraped_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table post_metrics_history

CREATE TABLE "post_metrics_history" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "post_shortcode" character varying(255),
    "likes_count" integer DEFAULT 0,
    "comments_count" integer DEFAULT 0,
    "video_view_count" integer DEFAULT 0,
    "view_count" bigint DEFAULT 0,
    "repost_count" integer DEFAULT 0,
    "share_count" integer DEFAULT 0,
    "bookmark_count" integer DEFAULT 0,
    "captured_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table post_relations

CREATE TABLE "post_relations" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "post_shortcode" character varying(255),
    "username" character varying(255),
    "relation_type" character varying(50) NOT NULL
);


-- Schema for table project_posts

CREATE TABLE "project_posts" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL,
    "post_shortcode" character varying(255) NOT NULL,
    "added_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table projects

CREATE TABLE "projects" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" text,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table project_profiles

CREATE TABLE "project_profiles" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL,
    "username" character varying(255) NOT NULL,
    "role" character varying(50) DEFAULT 'tracked'::character varying,
    "added_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "pinned" boolean DEFAULT false
);


-- Schema for table scrape_jobs

CREATE TABLE "scrape_jobs" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "session_id" uuid NOT NULL,
    "post_shortcode" character varying(255) NOT NULL,
    "page_number" integer DEFAULT 1,
    "status" character varying(50) DEFAULT 'pending'::character varying,
    "end_cursor" text DEFAULT ''::text,
    "comments_scraped" integer DEFAULT 0,
    "retry_count" integer DEFAULT 0,
    "max_retries" integer DEFAULT 3,
    "error_message" text,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone
);


-- Schema for table scrape_sessions

CREATE TABLE "scrape_sessions" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid,
    "profile_username" character varying(255),
    "status" character varying(50) DEFAULT 'pending'::character varying,
    "total_posts" integer DEFAULT 0,
    "total_jobs" integer DEFAULT 0,
    "completed_jobs" integer DEFAULT 0,
    "total_comments_scraped" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "project_id" uuid
);


-- Schema for table user_scraped_posts

CREATE TABLE "user_scraped_posts" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid,
    "post_shortcode" character varying(255),
    "scraped_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table search_keywords

CREATE TABLE "search_keywords" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL,
    "keyword" character varying(255) NOT NULL,
    "platform" character varying(50) NOT NULL DEFAULT 'tiktok'::character varying,
    "status" character varying(50) NOT NULL DEFAULT 'active'::character varying,
    "total_videos" integer DEFAULT 0,
    "total_creators" integer DEFAULT 0,
    "total_views" bigint DEFAULT 0,
    "total_engagement" bigint DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table keyword_search_sessions

CREATE TABLE "keyword_search_sessions" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "keyword_id" uuid NOT NULL,
    "project_id" uuid NOT NULL,
    "status" character varying(50) NOT NULL DEFAULT 'active'::character varying,
    "videos_captured" integer DEFAULT 0,
    "scroll_position" integer DEFAULT 0,
    "started_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table tiktok_videos

CREATE TABLE "tiktok_videos" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "video_id" character varying(255) NOT NULL,
    "keyword_id" uuid NOT NULL,
    "session_id" uuid,
    "creator_id" uuid,
    "project_id" uuid NOT NULL,
    "caption" text,
    "video_url" text,
    "thumbnail_url" text,
    "duration" integer DEFAULT 0,
    "views_count" bigint DEFAULT 0,
    "likes_count" bigint DEFAULT 0,
    "comments_count" integer DEFAULT 0,
    "shares_count" integer DEFAULT 0,
    "bookmarks_count" integer DEFAULT 0,
    "included_in_reach" boolean DEFAULT true,
    "included_in_engagement" boolean DEFAULT true,
    "included_in_reporting" boolean DEFAULT true,
    "manual_reviewed" boolean DEFAULT false,
    "relevance_score" integer DEFAULT 0,
    "capture_status" character varying(50) NOT NULL DEFAULT 'captured'::character varying,
    "posted_at" timestamp with time zone,
    "captured_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table tiktok_creators

CREATE TABLE "tiktok_creators" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "tiktok_user_id" character varying(255) NOT NULL,
    "username" character varying(255) NOT NULL,
    "display_name" character varying(255),
    "avatar_url" text,
    "follower_count" bigint DEFAULT 0,
    "following_count" integer DEFAULT 0,
    "video_count" integer DEFAULT 0,
    "biography" text,
    "is_verified" boolean DEFAULT false,
    "first_seen_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "last_updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table tiktok_comments

CREATE TABLE "tiktok_comments" (
    "id" character varying(255) NOT NULL,
    "video_id" character varying(255) NOT NULL,
    "keyword_id" uuid,
    "commenter_username" character varying(255),
    "commenter_user_id" character varying(255),
    "commenter_avatar_url" text,
    "text" text,
    "likes_count" integer DEFAULT 0,
    "reply_count" integer DEFAULT 0,
    "is_reply" boolean DEFAULT false,
    "parent_comment_id" character varying(255),
    "commented_at" timestamp with time zone,
    "scraped_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table tiktok_hashtags

CREATE TABLE "tiktok_hashtags" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "video_id" character varying(255) NOT NULL,
    "keyword_id" uuid,
    "tag" character varying(255) NOT NULL,
    "view_count" bigint DEFAULT 0
);


-- Schema for table tiktok_graphql_captures

CREATE TABLE "tiktok_graphql_captures" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "session_id" uuid,
    "keyword_id" uuid,
    "video_id" character varying(255),
    "creator_id" uuid,
    "url" text NOT NULL,
    "method" character varying(10) DEFAULT 'GET'::character varying,
    "capture_type" character varying(50) DEFAULT 'unknown'::character varying,
    "request_body" jsonb,
    "response_body" jsonb,
    "captured_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table tiktok_keyword_creators

CREATE TABLE "tiktok_keyword_creators" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "keyword_id" uuid NOT NULL,
    "creator_id" uuid NOT NULL,
    "video_count" integer DEFAULT 1,
    "total_views" bigint DEFAULT 0,
    "first_seen_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table ig_users

CREATE TABLE "ig_users" (
    "id" character varying(255) NOT NULL,
    "username" character varying(255) NOT NULL,
    "follower_count" bigint DEFAULT 0,
    "following_count" bigint DEFAULT 0,
    "media_count" integer DEFAULT 0,
    "biography" text,
    "external_url" text,
    "business_category" character varying(255),
    "is_verified" boolean DEFAULT false,
    "role" character varying(50) DEFAULT 'reference'::character varying,
    "scraped_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "display_name" character varying(255),
    "video_count" integer DEFAULT 0,
    "signature" text,
    "bio_link" text,
    "region" character varying(100),
    "avatar_url" text
);


-- Schema for table posts

CREATE TABLE "posts" (
    "shortcode" character varying(255) NOT NULL,
    "owner_username" character varying(255),
    "post_url" text,
    "caption" text,
    "image_url" text,
    "video_url" text,
    "is_video" boolean DEFAULT false,
    "is_carousel" boolean DEFAULT false,
    "is_paid" boolean DEFAULT false,
    "classification" character varying(100) DEFAULT 'Normal Post'::character varying,
    "type" character varying(50) DEFAULT 'normal'::character varying,
    "collective_reach" bigint DEFAULT 0,
    "reach_breakdown" jsonb DEFAULT '[]'::jsonb,
    "scraped_from_profile" character varying(255),
    "is_reference" boolean DEFAULT false,
    "view_count" bigint DEFAULT 0,
    "repost_count" integer DEFAULT 0,
    "share_count" integer DEFAULT 0,
    "bookmark_count" integer DEFAULT 0,
    "posted_at" timestamp with time zone,
    "first_captured_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "last_updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "hashtags" jsonb DEFAULT '[]'::jsonb,
    "mentions" jsonb DEFAULT '[]'::jsonb,
    "music_title" character varying(500),
    "music_author" character varying(255),
    "duet_from" character varying(255),
    "stitch_from" character varying(255)
);


-- Schema for table tiktok_users

CREATE TABLE "tiktok_users" (
    "id" character varying(255),
    "username" character varying(255),
    "follower_count" bigint,
    "following_count" bigint,
    "media_count" integer,
    "biography" text,
    "external_url" text,
    "business_category" character varying(255),
    "is_verified" boolean,
    "role" character varying(50),
    "scraped_at" timestamp with time zone,
    "display_name" character varying(255),
    "video_count" integer,
    "signature" text,
    "bio_link" text,
    "region" character varying(100),
    "avatar_url" text
);



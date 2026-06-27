-- Complete Database Schema

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
    "scraped_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
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
    "posted_at" timestamp with time zone,
    "first_captured_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "last_updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table post_metrics_history

CREATE TABLE "post_metrics_history" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "post_shortcode" character varying(255),
    "likes_count" integer DEFAULT 0,
    "comments_count" integer DEFAULT 0,
    "video_view_count" integer DEFAULT 0,
    "captured_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table post_relations

CREATE TABLE "post_relations" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "post_shortcode" character varying(255),
    "username" character varying(255),
    "relation_type" character varying(50) NOT NULL
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


-- Schema for table user_scraped_posts

CREATE TABLE "user_scraped_posts" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid,
    "post_shortcode" character varying(255),
    "scraped_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
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


-- Schema for table projects

CREATE TABLE "projects" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" text,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


-- Schema for table project_posts

CREATE TABLE "project_posts" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL,
    "post_shortcode" character varying(255) NOT NULL,
    "added_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
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


-- Schema for table project_profiles

CREATE TABLE "project_profiles" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL,
    "username" character varying(255) NOT NULL,
    "role" character varying(50) DEFAULT 'tracked'::character varying,
    "added_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "pinned" boolean DEFAULT false
);


-- Schema for table comment_scrape_logs

CREATE TABLE "comment_scrape_logs" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid,
    "post_shortcode" character varying(255),
    "api_calls" integer DEFAULT 0,
    "comments_scraped" integer DEFAULT 0,
    "scraped_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);



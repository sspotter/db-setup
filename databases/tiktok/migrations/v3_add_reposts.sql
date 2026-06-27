ALTER TABLE public.tiktok_videos 
ADD COLUMN IF NOT EXISTS reposts_count integer DEFAULT 0;

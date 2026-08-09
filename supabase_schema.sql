-- Run once in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.lrc_files (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    filename text not null check (char_length(filename) between 1 and 255),
    lrc_content text not null default '',
    status text not null default 'original' check (status in ('original', 'modified')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.transcription_usage (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    request_key text not null,
    audio_seconds integer not null check (audio_seconds > 0),
    created_at timestamptz not null default now()
);
alter table public.transcription_usage add column if not exists request_key text not null default 'legacy';
alter table public.transcription_usage alter column request_key drop default;

alter table public.lrc_files enable row level security;
alter table public.transcription_usage enable row level security;
grant select, insert, update, delete on public.lrc_files to authenticated;

drop policy if exists "owners read lrc" on public.lrc_files;
drop policy if exists "owners create lrc" on public.lrc_files;
drop policy if exists "owners update lrc" on public.lrc_files;
drop policy if exists "owners delete lrc" on public.lrc_files;
create policy "owners read lrc" on public.lrc_files for select to authenticated
    using ((select auth.uid()) = user_id and
           (coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) is false
            or created_at >= now() - interval '7 days'));
create policy "owners create lrc" on public.lrc_files for insert
    to authenticated with check ((select auth.uid()) = user_id);
create policy "owners update lrc" on public.lrc_files for update
    to authenticated using ((select auth.uid()) = user_id and
           (coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) is false
            or created_at >= now() - interval '7 days'))
    with check ((select auth.uid()) = user_id);
create policy "owners delete lrc" on public.lrc_files for delete
    to authenticated using ((select auth.uid()) = user_id and
           (coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) is false
            or created_at >= now() - interval '7 days'));

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

drop function if exists public.reserve_transcription(integer);
drop function if exists public.reserve_transcription(integer, text);
create or replace function private.reserve_transcription(p_audio_seconds integer, p_request_key text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    uid uuid := auth.uid();
    anonymous boolean := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
    request_limit integer := case when anonymous then 3 else 10 end;
    duration_limit integer := case when anonymous then 600 else 900 end;
    used integer;
    ip_used integer;
begin
    if uid is null then raise exception 'Authentication required'; end if;
    if p_audio_seconds < 1 or p_audio_seconds > duration_limit then
        raise exception 'Audio exceeds the % minute limit for this account', duration_limit / 60;
    end if;
    perform pg_advisory_xact_lock(hashtext(uid::text));
    select count(*) into used from public.transcription_usage
      where user_id = uid and created_at >= date_trunc('day', now());
    if used >= request_limit then
        raise exception 'Daily transcription limit reached (% per day)', request_limit;
    end if;
    if anonymous then
        select count(*) into ip_used from public.transcription_usage
          where transcription_usage.request_key = p_request_key
            and created_at >= date_trunc('day', now());
        if ip_used >= 6 then raise exception 'Guest limit reached for this network'; end if;
    end if;
    insert into public.transcription_usage(user_id, request_key, audio_seconds)
      values(uid, p_request_key, p_audio_seconds);
    return jsonb_build_object('used', used + 1, 'limit', request_limit,
                              'remaining', request_limit - used - 1);
end $$;

revoke all on function private.reserve_transcription(integer, text) from public, anon;
grant execute on function private.reserve_transcription(integer, text) to authenticated;

create function public.reserve_transcription(p_audio_seconds integer, p_request_key text)
returns jsonb language sql security invoker set search_path = pg_catalog, private as $$
    select private.reserve_transcription(p_audio_seconds, p_request_key)
$$;
revoke all on function public.reserve_transcription(integer, text) from public;
revoke all on function public.reserve_transcription(integer, text) from anon;
grant execute on function public.reserve_transcription(integer, text) to authenticated;

create or replace function private.get_usage_status()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    uid uuid := auth.uid();
    anonymous boolean := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
    request_limit integer := case when anonymous then 3 else 10 end;
    duration_limit integer := case when anonymous then 600 else 900 end;
    used integer;
    own_audio_seconds bigint;
    shared_hour_seconds bigint;
    shared_day_seconds bigint;
    saved_files integer;
    next_expiry timestamptz;
begin
    if uid is null then raise exception 'Authentication required'; end if;
    select count(*), coalesce(sum(audio_seconds), 0) into used, own_audio_seconds
      from public.transcription_usage
      where user_id = uid and created_at >= date_trunc('day', now());
    select coalesce(sum(audio_seconds), 0) into shared_hour_seconds
      from public.transcription_usage where created_at >= now() - interval '1 hour';
    select coalesce(sum(audio_seconds), 0) into shared_day_seconds
      from public.transcription_usage where created_at >= date_trunc('day', now());
    select count(*), min(created_at + interval '7 days') into saved_files, next_expiry
      from public.lrc_files where user_id = uid
        and (anonymous is false or created_at >= now() - interval '7 days');
    return jsonb_build_object(
        'used', used,
        'limit', request_limit,
        'remaining', greatest(request_limit - used, 0),
        'audio_seconds_today', own_audio_seconds,
        'max_audio_seconds', duration_limit,
        'reset_at', date_trunc('day', now()) + interval '1 day',
        'retention_days', case when anonymous then 7 else null end,
        'saved_files', saved_files,
        'next_expiry_at', case when anonymous then next_expiry else null end,
        'shared_hour_seconds', shared_hour_seconds,
        'shared_day_seconds', shared_day_seconds
    );
end $$;

revoke all on function private.get_usage_status() from public, anon;
grant execute on function private.get_usage_status() to authenticated;

create or replace function public.get_usage_status()
returns jsonb language sql security invoker set search_path = pg_catalog, private as $$
    select private.get_usage_status()
$$;
revoke all on function public.get_usage_status() from public;
revoke all on function public.get_usage_status() from anon;
grant execute on function public.get_usage_status() to authenticated;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists lrc_files_touch_updated_at on public.lrc_files;
create trigger lrc_files_touch_updated_at before update on public.lrc_files
for each row execute function public.touch_updated_at();

create index if not exists lrc_files_user_created_idx
    on public.lrc_files(user_id, created_at desc);
create index if not exists transcription_usage_user_created_idx
    on public.transcription_usage(user_id, created_at desc);
create index if not exists transcription_usage_request_created_idx
    on public.transcription_usage(request_key, created_at desc);

drop policy if exists "usage hidden from clients" on public.transcription_usage;

-- Guest cleanup: run periodically with Supabase Cron if desired.
-- delete from public.lrc_files f using auth.users u
-- where f.user_id = u.id and u.is_anonymous and f.created_at < now() - interval '7 days';

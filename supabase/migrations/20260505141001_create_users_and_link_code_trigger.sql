-- pgcrypto provides gen_random_bytes() used by generate_link_code() below
create extension if not exists pgcrypto;

-- public.users — app-level user table
-- id is the same UUID as auth.users.id; FK with cascade so deleting the auth row wipes this row
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  link_code text not null unique,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index users_link_code_idx on public.users(link_code);

-- link_code generator: 'koshh_' + 8 hex chars (4 random bytes)
-- 4.3B possibilities; collision probability at 100K users is ~1e-5
create or replace function public.generate_link_code()
returns text
language sql
volatile
as $$
  select 'koshh_' || encode(extensions.gen_random_bytes(4), 'hex');
$$;

-- Trigger function: runs after every auth.users insert
-- Inserts a matching public.users row with a unique link_code
-- Retries on (vanishingly rare) link_code collision
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt int := 0;
  new_code text;
begin
  loop
    new_code := public.generate_link_code();
    begin
      insert into public.users (id, link_code)
      values (new.id, new_code);
      return new;
    exception when unique_violation then
      attempt := attempt + 1;
      if attempt > 5 then
        raise exception 'failed to generate unique link_code after 5 attempts';
      end if;
    end;
  end loop;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

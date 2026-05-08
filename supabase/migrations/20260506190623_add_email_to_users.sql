-- D-012: denormalize email onto public.users.
-- Four-step non-blocking schema add: nullable column → backfill → tighten → triggers.

-- Step 1 — add the column nullable so the alter doesn't block on backfill
alter table public.users add column email text;

-- Step 2 — backfill existing rows from auth.users
update public.users u
   set email = a.email
  from auth.users a
 where a.id = u.id
   and u.email is null;

-- Step 3 — once every row has email, tighten the constraint
alter table public.users alter column email set not null;

-- Step 4 — extend M1's existing trigger to copy email on insert, and add a
-- new trigger to sync on update.

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
      insert into public.users (id, email, link_code)
      values (new.id, new.email, new_code);
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

create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_change
  after update on auth.users
  for each row execute function public.sync_user_email();

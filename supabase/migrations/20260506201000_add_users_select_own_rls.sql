-- M1 carryover: public.users had RLS enabled but zero policies, which made
-- authenticated SELECTs (e.g. M2's <LinkCodeDisplay> reading link_code from
-- the browser client) return 0 rows. M1's build guide assumed this policy
-- existed; M2's build guide stumble note flagged the symptom.
--
-- Additive: RLS was deny-all for non-superuser / non-service-role before this.
-- Service-role and SECURITY DEFINER triggers bypass RLS regardless, so M1's
-- existing access paths (auth.users INSERT trigger, cleanup-deleted-user job)
-- are unaffected.

create policy users_select_own
  on public.users
  for select
  using (auth.uid() = id);

drop policy if exists waitlist_deny_anon_authenticated on public.waitlist;
create policy waitlist_deny_anon_authenticated
  on public.waitlist
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists integration_tokens_deny_anon_authenticated on app_private.integration_tokens;
create policy integration_tokens_deny_anon_authenticated
  on app_private.integration_tokens
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

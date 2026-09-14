-- The line for the free models. Apply with:
--   psql "$DATABASE_URL" -f sql/pacer.sql
-- Idempotent. `pnpm db:push` creates the `pacer` table but does not manage
-- functions, so this file is the function's only source.
--
-- Vercel AI Gateway's free tier accepted 5 calls in any rolling 5 minutes,
-- across all models on the team (measured on day 12, see README). This
-- function hands out turns so the site as a whole never goes over.
--
-- `pacer.calls` holds the start time of every call in the last window,
-- including turns reserved for a few seconds from now. Turns are only ever
-- handed out at or after the latest one, so "is there room at time s" reduces
-- to "has the k-th most recent call left the window by s".
--
-- The row lock serialises every instance: a second caller waits for the first
-- to commit, and in READ COMMITTED each statement below then sees the update.
create or replace function take_gateway_turn(
  p_calls int,        -- calls this reading will make (2: GPT and Gemini)
  p_limit int,        -- calls allowed per window (4: one short of the 5 measured)
  p_window_ms int,    -- the window (305 000: five minutes and a margin)
  p_max_wait_ms int   -- longest a visitor may wait in line
) returns table (reserved boolean, wait_ms int)
language plpgsql as $$
declare
  v_win interval := p_window_ms * interval '1 millisecond';
  v_calls timestamptz[];
  v_start timestamptz := now();
  v_k int := p_limit - p_calls + 1;
begin
  insert into pacer (name, calls) values ('gateway', '{}') on conflict (name) do nothing;
  perform 1 from pacer where name = 'gateway' for update;

  select coalesce(array_agg(c order by c desc), '{}') into v_calls
    from pacer, unnest(pacer.calls) as c
   where pacer.name = 'gateway' and c > now() - v_win;

  if cardinality(v_calls) > 0 then
    v_start := greatest(v_start, v_calls[1]);
  end if;
  if cardinality(v_calls) >= v_k then
    v_start := greatest(v_start, v_calls[v_k] + v_win);
  end if;

  if v_start - now() > p_max_wait_ms * interval '1 millisecond' then
    return query select false, ceil(extract(epoch from v_start - now()) * 1000)::int;
    return;
  end if;

  update pacer set calls = v_calls || array_fill(v_start, array[p_calls]) where name = 'gateway';
  return query select true, ceil(extract(epoch from v_start - now()) * 1000)::int;
end $$;

-- A 429 got through anyway: the model of the limit was wrong. Fill the
-- window so nobody calls for the next five minutes.
create or replace function block_gateway(p_limit int) returns void
language sql as $$
  insert into pacer (name, calls) values ('gateway', array_fill(now(), array[p_limit]))
  on conflict (name) do update set calls = pacer.calls || array_fill(now(), array[p_limit]);
$$;

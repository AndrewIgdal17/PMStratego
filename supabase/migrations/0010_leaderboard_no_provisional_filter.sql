-- Remove the provisional filter from leaderboard
create or replace function get_leaderboard(p_limit integer default 25, p_offset integer default 0)
returns table (
  username text,
  rating integer,
  rating_provisional boolean,
  games_played integer,
  wins integer,
  losses integer,
  win_rate numeric,
  longest_streak integer
)
language sql
security definer
set search_path = public
as $$
  select
    p.username,
    p.rating,
    p.rating_provisional,
    p.games_played,
    ps.wins,
    ps.losses,
    case when (ps.wins + ps.losses + ps.draws) > 0
      then round(ps.wins::numeric / (ps.wins + ps.losses + ps.draws) * 100, 1)
      else 0 end as win_rate,
    ps.longest_streak
  from players p
  join player_stats ps on ps.player_id = p.id
  order by p.rating desc
  limit p_limit offset p_offset;
$$;

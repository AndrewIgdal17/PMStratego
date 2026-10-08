import { Link } from 'react-router-dom';

export type LeaderboardCategory =
  | 'rating'
  | 'spy_rate'
  | 'trade_efficiency'
  | 'reveal_efficiency'
  | 'bomb_craft';

export interface RatingLeaderboardRow {
  username: string;
  rating: number | string;
  wins: number | string;
  losses: number | string;
  winRate: number | string;
  longestStreak: number | string;
}

export interface MicroLeaderboardRow {
  username: string;
  value: number | string;
}

interface LeaderboardProps {
  category: LeaderboardCategory;
  onCategory: (category: LeaderboardCategory) => void;
  rows: RatingLeaderboardRow[] | MicroLeaderboardRow[];
  empty: boolean;
  loading: boolean;
}

const CATEGORIES: { key: LeaderboardCategory; label: string }[] = [
  { key: 'rating', label: 'Rating' },
  { key: 'spy_rate', label: 'Best Spy%' },
  { key: 'trade_efficiency', label: 'Trade King' },
  { key: 'reveal_efficiency', label: 'Fog Breaker' },
  { key: 'bomb_craft', label: 'Bomb Craft' },
];

const MICRO_PERCENT = new Set<LeaderboardCategory>(['spy_rate', 'reveal_efficiency', 'bomb_craft']);

function categoryLabel(category: LeaderboardCategory): string {
  return CATEGORIES.find((entry) => entry.key === category)?.label ?? 'Value';
}

function isRatingRow(
  row: RatingLeaderboardRow | MicroLeaderboardRow,
): row is RatingLeaderboardRow {
  return 'winRate' in row;
}

function isMicroRow(
  row: RatingLeaderboardRow | MicroLeaderboardRow,
): row is MicroLeaderboardRow {
  return 'value' in row;
}

export function Leaderboard({ category, onCategory, rows, empty, loading }: LeaderboardProps) {
  const ratingRows = category === 'rating' ? rows.filter(isRatingRow) : [];
  const microRows = category === 'rating' ? [] : rows.filter(isMicroRow);
  const suffix = MICRO_PERCENT.has(category) ? '%' : '';

  return (
    <section className="panel leaderboard-panel">
      <h2>Leaderboard</h2>
      <div className="leaderboard-tabs">
        {CATEGORIES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`lb-tab${key === category ? ' active' : ''}`}
            onClick={() => onCategory(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <table id="leaderboard-table" className="history-table">
        <thead>
          {category === 'rating' ? (
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Rating</th>
              <th>W/L</th>
              <th>Win%</th>
              <th>Streak</th>
            </tr>
          ) : (
            <tr>
              <th>#</th>
              <th>Player</th>
              <th colSpan={4}>{categoryLabel(category)}</th>
            </tr>
          )}
        </thead>
        <tbody id="leaderboard-body">
          {category === 'rating'
            ? ratingRows.map((row, index) => (
                <tr key={row.username}>
                  <td>{index + 1}</td>
                  <td>
                    <Link to={`/profile?user=${encodeURIComponent(row.username)}`}>{row.username}</Link>
                  </td>
                  <td>{row.rating}</td>
                  <td>
                    {row.wins}/{row.losses}
                  </td>
                  <td>{row.winRate}%</td>
                  <td>{row.longestStreak}</td>
                </tr>
              ))
            : microRows.map((row, index) => (
                <tr key={row.username}>
                  <td>{index + 1}</td>
                  <td>
                    <Link to={`/profile?user=${encodeURIComponent(row.username)}`}>{row.username}</Link>
                  </td>
                  <td colSpan={4}>
                    {row.value}
                    {suffix}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
      {loading ? <p className="hint-text">Loading...</p> : null}
      <p id="leaderboard-empty" className="hint-text" hidden={loading || !empty}>
        No ranked players yet.
      </p>
    </section>
  );
}

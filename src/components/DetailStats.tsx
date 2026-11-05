import type { Stat } from "../lib/plotStats";

export function DetailStats({ stats }: { stats: Stat[] }) {
  return (
    <div className="map-detail-stats">
      {stats.map(({ k, v, tone, title }) => (
        <div className="map-detail-stat" key={k} title={title}>
          <span>{k}</span>
          <b className={tone ? `stat-v tone-${tone}` : undefined}>{v}</b>
        </div>
      ))}
    </div>
  );
}

export const POWER_STATS = [
  {key: "attack", label: "Атака", description: "Урон от оружия, ударов и способностей."},
  {key: "defense", label: "Защита", description: "Стойкость, щиты, восстановление и выносливость."},
  {key: "speed", label: "Скорость", description: "Передвижение, реакция и темп боя."},
  {key: "technique", label: "Техника", description: "Мастерство, тактика и полезность особых способностей."}
];

// Ratings are editorial game values, not measurements from the source articles.
export function powerScore(rating) {
  const values = POWER_STATS.map(({key}) => rating?.stats?.[key]);
  return values.every(value => Number.isInteger(value) && value >= 1 && value <= 25)
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

export function preparePowerData(data, topics) {
  if (data?.version !== 1 || !data.sources || !data.characters) return null;
  const characters = {};
  for (const topic of topics) {
    for (const c of topic.characters) {
      const rating = data.characters[c.id];
      if (rating?.topicId !== topic.id || powerScore(rating) === null) continue;
      if (!rating.ability || !rating.form || !Array.isArray(rating.sources) || !rating.sources.length) continue;
      if (!rating.sources.every(id => {
        try {
          const source = data.sources[id];
          return source?.title && new URL(source.url).protocol === "https:";
        } catch { return false; }
      })) continue;
      characters[c.id] = rating;
    }
  }
  return {...data, characters};
}

export function teamPower(team, ratings = {}) {
  const stats = Object.fromEntries(POWER_STATS.map(({key}) => [key, 0]));
  const missing = [];
  let total = 0;
  for (const member of team) {
    const rating = ratings[member.id];
    const score = powerScore(rating);
    if (score === null) { missing.push(member.id); continue; }
    total += score;
    for (const {key} of POWER_STATS) stats[key] += rating.stats[key];
  }
  // Never silently count an unrated character as zero.
  return {total: missing.length ? null : total, stats: missing.length ? null : stats, missing};
}

export function compareTeamPower(players, ratings, size) {
  const teams = players.map(p => teamPower(p.team, ratings));
  const ready = players.length === 2 && Number.isInteger(size) && size > 0
    && players.every(p => p.team.length === size) && teams.every(t => t.total !== null);
  if (!ready) return {teams, winner: null, difference: null};
  const difference = Math.abs(teams[0].total - teams[1].total);
  return {teams, difference, winner: difference === 0 ? "tie" : teams[0].total > teams[1].total ? 0 : 1};
}

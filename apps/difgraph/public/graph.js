export function layoutGraph(commits) {
  const visible = new Set(commits.map(commit => commit.sha));
  let active = [];
  const rows = [];
  let maxLane = 0;
  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];
    let lane = active.indexOf(commit.sha);
    if (lane < 0) { lane = active.length; active.push(commit.sha); }
    const before = active.slice();
    const visibleParents = commit.parents.filter(parent => visible.has(parent));
    const next = active.slice();
    next[lane] = visibleParents[0] ?? null;
    for (const parent of visibleParents.slice(1)) {
      if (!next.includes(parent)) next.splice(lane + 1, 0, parent);
    }
    const compact = [];
    for (const item of next) if (item && !compact.includes(item)) compact.push(item);
    const edges = commit.parents.map((parent, index) => ({
      parent,
      fromLane: lane,
      toLane: visible.has(parent) ? compact.indexOf(parent) : lane,
      truncated: !visible.has(parent),
      primary: index === 0,
      continuation: false,
    }));
    for (let fromLane = 0; fromLane < before.length; fromLane++) {
      const pending = before[fromLane];
      if (pending === commit.sha) continue;
      const toLane = compact.indexOf(pending);
      if (toLane >= 0) edges.push({ parent: pending, fromLane, toLane, truncated: false, primary: false, continuation: true });
    }
    maxLane = Math.max(maxLane, lane, before.length - 1, compact.length - 1, ...edges.map(edge => edge.toLane));
    rows.push({ sha: commit.sha, row, lane, edges });
    active = compact;
  }
  return { rows, laneCount: maxLane + 1 };
}

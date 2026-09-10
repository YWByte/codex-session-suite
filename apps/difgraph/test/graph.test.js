import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from '../public/graph.js';

const commit = (sha, parents = []) => ({ sha, parents });
test('assigns one stable lane to linear history and marks boundary edges', () => {
  const layout = layoutGraph([commit('c', ['b']), commit('b', ['a'])]);
  assert.deepEqual(layout.rows.map(row => row.lane), [0, 0]);
  assert.equal(layout.rows[1].edges[0].truncated, true);
});
test('creates deterministic branch and merge edges', () => {
  const commits = [commit('m', ['a', 'b']), commit('a', ['root']), commit('b', ['root']), commit('root')];
  const first = layoutGraph(commits);
  const second = layoutGraph(commits);
  assert.deepEqual(first, second);
  assert.equal(first.rows[0].edges.length, 2);
  assert.ok(first.laneCount >= 2);
  assert.equal(first.rows[0].edges[1].toLane, 1);
});

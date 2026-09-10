import { execFile } from "node:child_process";

function execGit(cwd, args, { timeout = 8_000, maxBuffer = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout, maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || "").trim() || error.message));
        return;
      }
      resolve(String(stdout));
    });
  });
}

async function optionalGit(run, args) {
  try { return (await run(args)).trim(); } catch { return ""; }
}

function countNullSeparated(value) {
  return value ? value.split("\0").filter(Boolean).length : 0;
}

export function branchCreatedFrom(reflog) {
  const matches = [...String(reflog || "").matchAll(/(?:^|\n)branch: Created from (.+?)(?=\n|$)/g)];
  return matches.at(-1)?.[1]?.trim() || "";
}

async function verifiedRef(run, ref) {
  if (!ref) return "";
  return await optionalGit(run, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) ? ref : "";
}

async function remoteRefForSource(run, source) {
  if (!source || source === "HEAD") return "";
  const normalized = source.replace(/^refs\/remotes\//, "").replace(/^refs\/heads\//, "");
  if (source.startsWith("refs/remotes/") || normalized.includes("/")) return verifiedRef(run, normalized);
  const upstream = await optionalGit(run, ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${normalized}`]);
  if (upstream && await verifiedRef(run, upstream)) return upstream;
  return verifiedRef(run, `origin/${normalized}`);
}

async function configuredBase(run, branch) {
  const branchBase = await optionalGit(run, ["config", "--get", `branch.${branch}.session-view-base`]);
  return verifiedRef(run, branchBase || await optionalGit(run, ["config", "--get", "session-view.base"]));
}

async function inferredBase(run) {
  const candidates = [];
  const remoteHeads = await optionalGit(run, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/*/HEAD"]);
  candidates.push(...remoteHeads.split("\n").map((value) => value.trim()).filter(Boolean));
  candidates.push("origin/main", "origin/master", "upstream/main", "upstream/master");
  let best = null;
  for (const candidate of [...new Set(candidates)]) {
    if (!await verifiedRef(run, candidate)) continue;
    const mergeBase = await optionalGit(run, ["merge-base", candidate, "HEAD"]);
    if (!mergeBase) continue;
    const distance = Number.parseInt(await optionalGit(run, ["rev-list", "--count", `${mergeBase}..HEAD`]), 10);
    if (Number.isFinite(distance) && (!best || distance < best.distance)) best = { ref: candidate, mergeBase, distance };
  }
  return best;
}

export async function readGitContext(cwd, { runGit = (args) => execGit(cwd, args) } = {}) {
  if (await optionalGit(runGit, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return { available: false, reason: "当前 cwd 不是 Git 仓库" };
  }
  const root = await optionalGit(runGit, ["rev-parse", "--show-toplevel"]);
  const branch = await optionalGit(runGit, ["branch", "--show-current"]);
  const head = await optionalGit(runGit, ["rev-parse", "--short", "HEAD"]);
  const stagedFiles = countNullSeparated(await optionalGit(runGit, ["diff", "--cached", "--name-only", "-z"]));
  let base = "";
  let baseSource = "";
  let mergeBase = "";
  if (branch) {
    base = await configuredBase(runGit, branch);
    if (base) baseSource = "configured";
    if (!base) {
      base = await remoteRefForSource(runGit, branchCreatedFrom(await optionalGit(runGit, ["reflog", "show", "--format=%gs", branch])));
      if (base) baseSource = "reflog";
    }
    if (!base) {
      const inferred = await inferredBase(runGit);
      if (inferred) ({ ref: base, mergeBase, } = inferred);
      if (inferred) baseSource = "inferred";
    }
  }
  if (base && !mergeBase) mergeBase = await optionalGit(runGit, ["merge-base", base, "HEAD"]);
  return {
    available: true,
    root,
    branch: branch || `detached@${head || "unknown"}`,
    detached: !branch,
    base: base || null,
    baseSource: baseSource || null,
    mergeBase: mergeBase || null,
    stagedFiles,
    committedCommits: mergeBase ? Number.parseInt(await optionalGit(runGit, ["rev-list", "--count", `${mergeBase}..HEAD`]), 10) || 0 : 0,
    committedFiles: mergeBase ? countNullSeparated(await optionalGit(runGit, ["diff", "--name-only", "-z", mergeBase, "HEAD"])) : 0,
  };
}

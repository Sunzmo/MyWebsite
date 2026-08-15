const siteOwner = "Sunzmo";
const notesOwner = "Sunzmo";
const notesRepo = "ai-pm-wiki";
const siteRepo = "MyWebsite";
const projectRepos = new Set([siteRepo, notesRepo]);
const apiBase = "https://api.github.com";
const rawBase = "https://raw.githubusercontent.com";
const ignoredNotePaths = new Set(["index.md", "log.md"]);

type Env = {
  GITHUB_TOKEN?: string;
};

type GitHubRepo = {
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
  archived: boolean;
  pushed_at: string;
  topics?: string[];
};

type GitTreeItem = {
  path: string;
  type: "blob" | "tree";
  size?: number;
};

type GitTreeResponse = {
  tree: GitTreeItem[];
};

type GitHubFileResponse = {
  content: string;
  encoding: string;
};

type GitCommit = {
  commit: {
    message: string;
    committer: {
      date: string;
    };
  };
};

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300",
    },
  });
}

function headers(env: Env) {
  const requestHeaders: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "sunzmo-personal-site-runtime",
  };

  if (env.GITHUB_TOKEN) {
    requestHeaders.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  return requestHeaders;
}

async function fetchJson<T>(url: string, env: Env): Promise<T> {
  const response = await fetch(url, { headers: headers(env) });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${url}`);
  }

  return response.json() as Promise<T>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatActivityDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function cleanTitle(path: string) {
  const fileName = decodeURIComponent(path)
    .split("/")
    .pop()
    ?.replace(/\.md$/i, "");

  return fileName?.replace(/^\d+\s+/, "") || path;
}

function categoryFromPath(path: string) {
  const parts = decodeURIComponent(path).split("/").filter(Boolean);

  if (parts[0] === "AI产品" && parts.length >= 3) {
    return parts[1];
  }

  return parts[0] || "笔记";
}

function slugFromPath(path: string) {
  return path.replace(/\.md$/i, "");
}

function noteHref(slug: string) {
  return `/notes/${slug
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}/`;
}

function githubBlobUrl(path: string) {
  return `https://github.com/${notesOwner}/${notesRepo}/blob/main/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function githubRawUrl(path: string) {
  return `${rawBase}/${notesOwner}/${notesRepo}/main/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function estimateReadingTimeFromBytes(bytes = 0) {
  const minutes = Math.max(1, Math.ceil(bytes / 1200));
  return `约 ${minutes} 分钟`;
}

type NoteIndexEntry = {
  title: string;
  category: string;
  excerpt: string;
};

function normalizeNoteTitle(value: string) {
  return value.trim().replace(/\.md$/i, "").toLocaleLowerCase("zh-CN");
}

function parseNoteIndex(markdown: string) {
  const entries = new Map<string, NoteIndexEntry>();

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\s*\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/.exec(
      line,
    );
    if (!match) continue;

    entries.set(normalizeNoteTitle(match[1]), {
      title: match[1].trim(),
      category: match[2].trim(),
      excerpt: match[3].trim(),
    });
  }

  return entries;
}

async function loadNoteIndex(env: Env) {
  try {
    const response = await fetch(githubRawUrl("index.md"), { headers: headers(env) });
    if (response.ok) return parseNoteIndex(await response.text());
  } catch (error) {
    // Fall through to the authenticated API when the raw host is unavailable.
  }

  try {
    const file = await fetchJson<GitHubFileResponse>(
      `${apiBase}/repos/${notesOwner}/${notesRepo}/contents/index.md?ref=main`,
      env,
    );
    if (file.encoding !== "base64") return new Map<string, NoteIndexEntry>();

    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), (char) =>
      char.charCodeAt(0),
    );
    return parseNoteIndex(new TextDecoder().decode(bytes));
  } catch (error) {
    return new Map<string, NoteIndexEntry>();
  }
}

function notePathFromIndexEntry(entry: NoteIndexEntry) {
  const directory = entry.category === "导航" ? "AI产品" : `AI产品/${entry.category}`;
  return `${directory}/${entry.title}.md`;
}

function repoStatus(repo: GitHubRepo) {
  if (repo.archived) return "已归档";

  const daysSincePush =
    (Date.now() - new Date(repo.pushed_at).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSincePush < 14) return "维护中";
  if (daysSincePush < 90) return "稳定";
  return "存档";
}

function repoDescription(repo: GitHubRepo) {
  if (repo.name === siteRepo) return "个人网站源码仓库，记录页面设计、内容同步和持续迭代";
  if (repo.name === notesRepo) return "我的 Obsidian 笔记仓库，整理 AI 产品课程、实践记录和工具方法";
  if (repo.description) return repo.description;
  return "公开项目仓库，保留代码、说明和持续更新的记录";
}

function describeCommit(message: string, source: "site" | "notes") {
  const subject = message.split("\n")[0].trim().toLowerCase();

  if (source === "notes") {
    if (subject.includes("readme")) return "整理笔记仓库说明";
    if (subject.includes("add")) return "新增一批笔记内容";
    if (subject.includes("update") || subject.includes("sync")) return "更新笔记内容并同步到网站";
    return "整理并同步公开笔记";
  }

  if (subject.includes("sidebar")) return "优化页面侧边栏";
  if (subject.includes("github")) return "调整 GitHub 内容同步";
  if (subject.includes("deploy")) return "部署网站更新";
  return "更新网站内容和界面细节";
}

function createChartDays(endDate: Date) {
  return Array.from({ length: 21 }, (_, index) => {
    const date = new Date(endDate);
    date.setUTCDate(endDate.getUTCDate() - (20 - index));

    return {
      date: dateKey(date),
      label: formatShortDate(date),
      count: 0,
      website: 0,
      notes: 0,
      height: 14,
    };
  });
}

function normalizeChartHeights(days: ReturnType<typeof createChartDays>) {
  const maxCount = Math.max(1, ...days.map((day) => day.count));

  return days.map((day) => ({
    ...day,
    height: day.count ? Math.max(18, Math.round((day.count / maxCount) * 100)) : 8,
  }));
}

async function loadProjects(env: Env) {
  const repos = await fetchJson<GitHubRepo[]>(
    `${apiBase}/users/${siteOwner}/repos?sort=pushed&per_page=100`,
    env,
  );

  return repos
    .filter((repo) => !repo.fork && projectRepos.has(repo.name))
    .map((repo) => ({
      name: repo.name === notesRepo ? "我的笔记" : repo.name,
      description: repoDescription(repo),
      stack:
        repo.name === notesRepo
          ? ["Obsidian", "Markdown", "GitHub"]
          : [repo.language || "Repository", ...(repo.topics || []).slice(0, 2)],
      meta:
        repo.name === notesRepo
          ? `Obsidian / 我的笔记 / ${formatDate(repo.pushed_at)}`
          : `${repo.language || "GitHub"} / ${repo.stargazers_count} 个标星 / ${formatDate(repo.pushed_at)}`,
      status: repoStatus(repo),
      link: `https://github.com/${siteOwner}/${repo.name}`,
      homepage: repo.homepage,
      updatedAt: repo.pushed_at,
    }))
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

async function loadNotes(env: Env) {
  const noteIndex = await loadNoteIndex(env);
  let noteItems: GitTreeItem[] = [];

  try {
    const tree = await fetchJson<GitTreeResponse>(
      `${apiBase}/repos/${notesOwner}/${notesRepo}/git/trees/main?recursive=1`,
      env,
    );
    noteItems = tree.tree
      .filter((item) => item.type === "blob" && item.path.endsWith(".md"))
      .filter((item) => !item.path.startsWith("."))
      .filter((item) => !ignoredNotePaths.has(item.path));
  } catch (error) {
    // index.md is enough to reconstruct this repository's public note paths.
  }

  if (!noteItems.length && noteIndex.size) {
    noteItems = Array.from(noteIndex.values()).map((entry) => ({
      path: notePathFromIndexEntry(entry),
      type: "blob",
    }));
  }

  return noteItems
    .map((item) => {
      const title = cleanTitle(item.path);
      const indexed = noteIndex.get(normalizeNoteTitle(title));
      const category = indexed?.category || categoryFromPath(item.path);
      const slug = slugFromPath(item.path);

      return {
        title,
        meta: `${category} / ${estimateReadingTimeFromBytes(item.size)}`,
        category,
        excerpt:
          indexed?.excerpt ||
          `收在「${category}」里的 AI 产品笔记，适合快速理解概念与实践方法`,
        link: noteHref(slug),
        sourceUrl: githubBlobUrl(item.path),
        rawUrl: githubRawUrl(item.path),
        path: item.path,
        slug,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category, "zh-CN"));
}

async function loadActivities(env: Env) {
  const [initialSiteCommits, initialNoteCommits] = await Promise.all([
    fetchJson<GitCommit[]>(
      `${apiBase}/repos/${siteOwner}/${siteRepo}/commits?per_page=100&page=1`,
      env,
    ),
    fetchJson<GitCommit[]>(
      `${apiBase}/repos/${notesOwner}/${notesRepo}/commits?per_page=100&page=1`,
      env,
    ),
  ]);

  const activities = [
    ...initialSiteCommits.slice(0, 2).map((commit) => [
      formatActivityDate(commit.commit.committer.date),
      "更新个人网站",
      describeCommit(commit.commit.message, "site"),
    ]),
    ...initialNoteCommits.slice(0, 2).map((commit) => [
      formatActivityDate(commit.commit.committer.date),
      "同步笔记仓库",
      describeCommit(commit.commit.message, "notes"),
    ]),
  ];

  const allCommits = [...initialSiteCommits, ...initialNoteCommits];
  const latestCommitDate = allCommits.reduce((latest, commit) => {
    const date = new Date(commit.commit.committer.date);
    return date > latest ? date : latest;
  }, new Date(0));
  const chartEnd = latestCommitDate.getTime() > 0 ? latestCommitDate : new Date();
  chartEnd.setUTCHours(0, 0, 0, 0);

  const chartStart = new Date(chartEnd);
  chartStart.setUTCDate(chartEnd.getUTCDate() - 20);
  const [siteCommits, noteCommits] = await Promise.all([
    fetchCommitsForChart(siteOwner, siteRepo, initialSiteCommits, chartStart, env),
    fetchCommitsForChart(notesOwner, notesRepo, initialNoteCommits, chartStart, env),
  ]);

  const days = createChartDays(chartEnd);
  const dayMap = new Map(days.map((day) => [day.date, day]));

  for (const commit of siteCommits) {
    const day = dayMap.get(dateKey(new Date(commit.commit.committer.date)));
    if (!day) continue;
    day.website += 1;
    day.count += 1;
  }

  for (const commit of noteCommits) {
    const day = dayMap.get(dateKey(new Date(commit.commit.committer.date)));
    if (!day) continue;
    day.notes += 1;
    day.count += 1;
  }

  return {
    activities: activities.slice(0, 4),
    activityChart: normalizeChartHeights(days),
  };
}

async function fetchCommitsForChart(
  repoOwner: string,
  repo: string,
  firstPage: GitCommit[],
  chartStart: Date,
  env: Env,
): Promise<GitCommit[]> {
  const commits = [...firstPage];
  const oldestDate = (items: GitCommit[]) =>
    items.reduce(
      (oldest, item) => {
        const date = new Date(item.commit.committer.date);
        return date < oldest ? date : oldest;
      },
      new Date(),
    );

  for (let page = 2; page <= 10 && commits.length; page += 1) {
    if (oldestDate(commits) <= chartStart) break;

    const nextPage = await fetchJson<GitCommit[]>(
      `${apiBase}/repos/${repoOwner}/${repo}/commits?per_page=100&page=${page}`,
      env,
    );
    if (!nextPage.length) break;
    commits.push(...nextPage);
  }

  return commits;
}

export async function onRequestGet({ env }: { env: Env }) {
  try {
    const [projects, notes, activityData] = await Promise.all([
      loadProjects(env),
      loadNotes(env),
      loadActivities(env),
    ]);

    return json({
      generatedAt: new Date().toISOString(),
      projects,
      notes,
      ...activityData,
    });
  } catch (error) {
    return json(
      {
        error: "runtime-sync-failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      502,
    );
  }
}

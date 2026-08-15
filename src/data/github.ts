import {
  activities as fallbackActivities,
  notes as fallbackNotes,
  projects as fallbackProjects,
} from "./content";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const siteOwner = "ltyqa";
const notesOwner = "Sunzmo";
const notesRepo = "ai-pm-wiki";
const siteRepo = "MyWebsite";
const apiBase = "https://api.github.com";
const rawBase = "https://raw.githubusercontent.com";
const ignoredNotePaths = new Set(["index.md", "log.md"]);
const execFileAsync = promisify(execFile);
let notesCache: Promise<SiteNote[]> | undefined;
let projectsCache: Promise<Awaited<ReturnType<typeof loadGitHubProjects>>> | undefined;
let activitiesCache: Promise<string[][]> | undefined;
let activityChartCache: Promise<ActivityChartItem[]> | undefined;

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
  updated_at: string;
  topics?: string[];
};

type GitTreeItem = {
  path: string;
  type: "blob" | "tree";
  url: string;
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
  sha: string;
  commit: {
    message: string;
    committer: {
      date: string;
    };
  };
};

type GitCommitDetails = GitCommit & {
  files?: Array<{
    filename: string;
  }>;
};

type LocalGitCommit = {
  date: string;
  message: string;
};

export type ActivityChartItem = {
  date: string;
  label: string;
  count: number;
  website: number;
  notes: number;
  height: number;
};

export type SiteNote = {
  title: string;
  meta: string;
  category: string;
  excerpt: string;
  link: string;
  sourceUrl: string;
  rawUrl: string;
  path: string;
  slug: string;
  updatedAt?: string;
};

const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "sunzmo-personal-site",
};

if (import.meta.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${import.meta.env.GITHUB_TOKEN}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${url}`);
  }

  return response.json() as Promise<T>;
}

function logFallback(message: string) {
  console.warn(`[site data] ${message}`);
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

function describeCommit(message: string, source: "site" | "notes") {
  const subject = message.split("\n")[0].trim().toLowerCase();

  if (source === "notes") {
    if (subject.includes("test") || subject.includes("retest")) return "验证笔记同步是否正常触发";
    if (subject.includes("readme")) return "整理笔记仓库说明";
    if (subject.includes("add")) return "新增一批笔记内容";
    if (subject.includes("update") || subject.includes("sync")) return "更新笔记内容并同步到网站";
    return "整理并同步公开笔记";
  }

  if (subject.includes("metric")) return "调整首页数据卡片的排版";
  if (subject.includes("fake activity")) return "移除活跃图表里的模拟数据";
  if (subject.includes("fallback")) return "修正项目列表的备用数据";
  if (subject.includes("sidebar")) return "优化项目和笔记页的侧边栏";
  if (subject.includes("icon")) return "统一首页图标风格";
  if (subject.includes("note filter")) return "修复笔记筛选交互";
  if (subject.includes("github")) return "调整 GitHub 内容同步";
  return "更新网站内容和界面细节";
}

async function loadLocalGitCommits(limit: number): Promise<LocalGitCommit[]> {
  try {
    const { stdout } = await execFileAsync("git", [
      "log",
      `-${limit}`,
      "--pretty=format:%cI%x09%s",
    ]);

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [date, ...messageParts] = line.split("\t");

        return {
          date,
          message: messageParts.join("\t"),
        };
      })
      .filter((commit) => commit.date && commit.message);
  } catch (error) {
    return [];
  }
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

function fallbackNoteHref(title: string) {
  return `/notes/local/${encodeURIComponent(title)}/`;
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

function decodeGitHubFile(file: GitHubFileResponse) {
  if (file.encoding !== "base64") return undefined;

  const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), (char) =>
    char.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}

async function fetchNoteFileFromApi(path: string) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const file = await fetchJson<GitHubFileResponse>(
    `${apiBase}/repos/${notesOwner}/${notesRepo}/contents/${encodedPath}?ref=main`,
  );
  return decodeGitHubFile(file);
}

async function loadNoteIndex() {
  try {
    const response = await fetch(githubRawUrl("index.md"), { headers });
    if (response.ok) return parseNoteIndex(await response.text());
  } catch (error) {
    logFallback("Raw note index unavailable, retrying through GitHub API.");
  }

  try {
    const markdown = await fetchNoteFileFromApi("index.md");
    return markdown
      ? parseNoteIndex(markdown)
      : new Map<string, NoteIndexEntry>();
  } catch (error) {
    return new Map<string, NoteIndexEntry>();
  }
}

function notePathFromIndexEntry(entry: NoteIndexEntry) {
  const directory = entry.category === "导航" ? "AI产品" : `AI产品/${entry.category}`;
  return `${directory}/${entry.title}.md`;
}

function getFallbackNotes(): SiteNote[] {
  return fallbackNotes.map((note) => ({
    ...note,
    link: fallbackNoteHref(note.title),
    sourceUrl: `https://github.com/${notesOwner}/${notesRepo}`,
    rawUrl: "",
    path: `local/${note.title}.md`,
    slug: `local/${note.title}`,
  }));
}

function estimateReadingTimeFromBytes(bytes = 0) {
  const minutes = Math.max(1, Math.ceil(bytes / 1200));
  return `约 ${minutes} 分钟`;
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
  if (repo.description) return repo.description;
  if (repo.name === siteRepo) return "个人网站的源码仓库，记录页面设计、内容同步和持续迭代";
  if (repo.name === notesRepo) return "公开笔记仓库，整理课程笔记、设计记录和工具方法";
  return "公开项目仓库，保留代码、说明和持续更新的记录";
}

async function loadGitHubProjects() {
  try {
    const repos = await fetchJson<GitHubRepo[]>(
      `${apiBase}/users/${siteOwner}/repos?sort=pushed&per_page=100`,
    );

    const projects = repos
      .filter((repo) => !repo.fork && repo.name !== notesRepo)
      .map((repo) => ({
        name: repo.name,
        description: repoDescription(repo),
        stack: [repo.language || "Repository", ...(repo.topics || []).slice(0, 2)],
        meta: `${repo.language || "GitHub"} / ${repo.stargazers_count} 个标星 / ${formatDate(repo.pushed_at)}`,
        status: repoStatus(repo),
        link: repo.html_url,
        homepage: repo.homepage,
        updatedAt: repo.pushed_at,
      }))
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

    return projects.length ? projects : fallbackProjects;
  } catch (error) {
    logFallback("GitHub projects unavailable, using local fallback.");
    return fallbackProjects;
  }
}

async function loadGitHubNotes(): Promise<SiteNote[]> {
  const noteIndex = await loadNoteIndex();
  let noteItems: GitTreeItem[] = [];

  try {
    const tree = await fetchJson<GitTreeResponse>(
      `${apiBase}/repos/${notesOwner}/${notesRepo}/git/trees/main?recursive=1`,
    );
    noteItems = tree.tree
      .filter((item) => item.type === "blob" && item.path.endsWith(".md"))
      .filter((item) => !item.path.startsWith("."))
      .filter((item) => !ignoredNotePaths.has(item.path));
  } catch (error) {
    logFallback("GitHub note tree unavailable, rebuilding paths from index.md.");
  }

  if (!noteItems.length && noteIndex.size) {
    noteItems = Array.from(noteIndex.values()).map((entry) => ({
      path: notePathFromIndexEntry(entry),
      type: "blob",
      url: "",
    }));
  }

  const notes: SiteNote[] = noteItems.map((item) => {
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
  });

  if (!notes.length) {
    logFallback("GitHub notes unavailable, using local fallback.");
    return getFallbackNotes();
  }

  try {
    const recentCommits = await fetchJson<GitCommit[]>(
      `${apiBase}/repos/${notesOwner}/${notesRepo}/commits?per_page=8`,
    );
    const commitDetailResults = await Promise.allSettled(
      recentCommits.map((commit) =>
        fetchJson<GitCommitDetails>(
          `${apiBase}/repos/${notesOwner}/${notesRepo}/commits/${commit.sha}`,
        ),
      ),
    );
    const commitDetails = commitDetailResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const updatedAtByPath = new Map<string, string>();

    for (const commit of commitDetails) {
      for (const file of commit.files || []) {
        if (!file.filename.endsWith(".md") || updatedAtByPath.has(file.filename)) continue;
        updatedAtByPath.set(file.filename, commit.commit.committer.date);
      }
    }

    notes.forEach((note) => {
      note.updatedAt = updatedAtByPath.get(note.path);
    });
  } catch (error) {
    logFallback("GitHub note commits unavailable, keeping index order.");
  }

  notes.sort((a, b) => {
    const dateOrder = (b.updatedAt || "").localeCompare(a.updatedAt || "");
    return dateOrder || a.category.localeCompare(b.category, "zh-CN");
  });

  return notes;
}

export async function getGitHubNoteBySlug(slug: string) {
  const notes = await getGitHubNotes();
  const note = notes.find((item) => item.slug === slug);

  if (!note) {
    return undefined;
  }

  if (!note.rawUrl) {
    return {
      ...note,
      markdown: `# ${note.title}\n\n${note.excerpt}`,
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(note.rawUrl, { headers });
      if (response.ok) {
        return {
          ...note,
          markdown: await response.text(),
        };
      }
    } catch (error) {
      if (attempt === 0) continue;
    }
  }

  logFallback(`Raw note unavailable for ${note.path}, retrying through GitHub API.`);

  try {
    const markdown = await fetchNoteFileFromApi(note.path);
    if (markdown) return { ...note, markdown };
  } catch (error) {
    logFallback(`GitHub API note fallback unavailable for ${note.path}.`);
  }

  return {
    ...note,
    markdown: `# ${note.title}\n\n${note.excerpt}\n\n[在 GitHub 查看原始笔记](${note.sourceUrl})`,
  };
}

async function loadGitHubActivities() {
  try {
    const commits = await fetchJson<GitCommit[]>(
      `${apiBase}/repos/${siteOwner}/${siteRepo}/commits?per_page=2`,
    );
    const noteCommits = await fetchJson<GitCommit[]>(
      `${apiBase}/repos/${notesOwner}/${notesRepo}/commits?per_page=2`,
    );

    const items = [
      ...commits.map((commit) => [
        formatActivityDate(commit.commit.committer.date),
        "更新个人网站",
        describeCommit(commit.commit.message, "site"),
      ]),
      ...noteCommits.map((commit) => [
        formatActivityDate(commit.commit.committer.date),
        "同步笔记仓库",
        describeCommit(commit.commit.message, "notes"),
      ]),
    ];

    return items.length ? items.slice(0, 4) : fallbackActivities;
  } catch (error) {
    const localCommits = await loadLocalGitCommits(4);

    if (localCommits.length) {
      logFallback("GitHub activity unavailable, using local git commits.");
      return localCommits.map((commit) => [
        formatActivityDate(commit.date),
        "更新个人网站",
        describeCommit(commit.message, "site"),
      ]);
    }

    logFallback("GitHub activity unavailable, using local fallback.");
    return fallbackActivities;
  }
}

async function loadGitHubActivityChart(): Promise<ActivityChartItem[]> {
  try {
    const [initialSiteCommits, initialNoteCommits] = await Promise.all([
      fetchJson<GitCommit[]>(
        `${apiBase}/repos/${siteOwner}/${siteRepo}/commits?per_page=100&page=1`,
      ),
      fetchJson<GitCommit[]>(
        `${apiBase}/repos/${notesOwner}/${notesRepo}/commits?per_page=100&page=1`,
      ),
    ]);
    const allCommits = [...initialSiteCommits, ...initialNoteCommits];
    const latestCommitDate = allCommits.reduce((latest, commit) => {
      const date = new Date(commit.commit.committer.date);
      return date > latest ? date : latest;
    }, new Date(0));
    const chartEnd = latestCommitDate.getTime() > 0 ? latestCommitDate : new Date();
    chartEnd.setUTCHours(0, 0, 0, 0);

    // Recent automated syncs can fill a page in only a few days. Keep paging
    // until the entire 21-day chart window is covered.
    const chartStart = new Date(chartEnd);
    chartStart.setUTCDate(chartEnd.getUTCDate() - 20);
    const [siteCommits, noteCommits] = await Promise.all([
      fetchCommitsForChart(siteOwner, siteRepo, initialSiteCommits, chartStart),
      fetchCommitsForChart(notesOwner, notesRepo, initialNoteCommits, chartStart),
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

    return normalizeChartHeights(days);
  } catch (error) {
    const localCommits = await loadLocalGitCommits(60);
    const latestCommitDate = localCommits.reduce((latest, commit) => {
      const date = new Date(commit.date);
      return date > latest ? date : latest;
    }, new Date(0));

    const chartEnd = latestCommitDate.getTime() > 0 ? latestCommitDate : new Date();
    chartEnd.setUTCHours(0, 0, 0, 0);
    const days = createChartDays(chartEnd);

    if (!localCommits.length) {
      logFallback("GitHub activity chart unavailable, showing empty chart.");
      return normalizeChartHeights(days);
    }

    logFallback("GitHub activity chart unavailable, using local git commits.");

    const dayMap = new Map(days.map((day) => [day.date, day]));

    for (const commit of localCommits) {
      const day = dayMap.get(dateKey(new Date(commit.date)));
      if (!day) continue;
      day.website += 1;
      day.count += 1;
    }

    return normalizeChartHeights(days);
  }
}

async function fetchCommitsForChart(
  repoOwner: string,
  repo: string,
  firstPage: GitCommit[],
  chartStart: Date,
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

  // GitHub returns commits newest first. Ten pages is a deliberate guard
  // against an unexpectedly large repository while comfortably covering the
  // chart window for this site.
  for (let page = 2; page <= 10 && commits.length; page += 1) {
    if (oldestDate(commits) <= chartStart) break;

    const nextPage = await fetchJson<GitCommit[]>(
      `${apiBase}/repos/${repoOwner}/${repo}/commits?per_page=100&page=${page}`,
    );
    if (!nextPage.length) break;
    commits.push(...nextPage);
  }

  return commits;
}

function createChartDays(endDate: Date): ActivityChartItem[] {
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

function normalizeChartHeights(days: ActivityChartItem[]) {
  const maxCount = Math.max(1, ...days.map((day) => day.count));

  return days.map((day) => ({
    ...day,
    height: day.count ? Math.max(18, Math.round((day.count / maxCount) * 100)) : 8,
  }));
}

export async function getGitHubProjects() {
  projectsCache ||= loadGitHubProjects();
  return projectsCache;
}

export async function getGitHubNotes() {
  notesCache ||= loadGitHubNotes();
  return notesCache;
}

export async function getGitHubActivities() {
  activitiesCache ||= loadGitHubActivities();
  return activitiesCache;
}

export async function getGitHubActivityChart() {
  activityChartCache ||= loadGitHubActivityChart();
  return activityChartCache;
}

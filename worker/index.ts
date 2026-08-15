import { onRequestGet as getSiteData } from "../functions/api/site-data";
import {
  onRequestGet as rejectChatGet,
  onRequestPost as postChat,
} from "../functions/api/openclaw-chat";
import { onRequestPost as postFeedback } from "../functions/api/openclaw-feedback";
import { onRequestGet as getHealth } from "../functions/api/openclaw-health";
import { onRequestGet as getNote } from "../functions/notes/[[slug]]";
import { onRequestGet as getWeeklyIssue } from "../functions/weekly/[issue]";
import { onRequestGet as getWeeklyImage } from "../functions/weekly-image";

type WorkerEnv = {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  GITHUB_TOKEN?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_BASE_URL?: string;
  AI_SYSTEM_PROMPT?: string;
};

function methodNotAllowed(allowed: string) {
  return Response.json(
    { error: "method-not-allowed", message: `仅支持 ${allowed} 请求。` },
    { status: 405, headers: { Allow: allowed, "Cache-Control": "no-store" } },
  );
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/openclaw-health") {
      return request.method === "GET" ? getHealth({ env }) : methodNotAllowed("GET");
    }

    if (pathname === "/api/openclaw-chat") {
      if (request.method === "POST") return postChat({ request, env });
      if (request.method === "GET") return rejectChatGet();
      return methodNotAllowed("GET, POST");
    }

    if (pathname === "/api/openclaw-feedback") {
      return request.method === "POST" ? postFeedback({ request }) : methodNotAllowed("POST");
    }

    if (pathname === "/api/site-data") {
      return request.method === "GET" ? getSiteData({ env }) : methodNotAllowed("GET");
    }

    if (pathname === "/weekly-image") {
      return request.method === "GET" ? getWeeklyImage({ request }) : methodNotAllowed("GET");
    }

    if (request.method === "GET" && pathname.startsWith("/notes/")) {
      return getNote({ request, env });
    }

    if (request.method === "GET" && pathname.startsWith("/weekly/")) {
      const issue = pathname.replace(/^\/weekly\//, "").replace(/\/$/, "");
      return getWeeklyIssue({ request, env, params: { issue } });
    }

    return env.ASSETS.fetch(request);
  },
};

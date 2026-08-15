type Env = {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
};

export async function onRequestGet({ env }: { env: Env }) {
  if (!env.DEEPSEEK_API_KEY) {
    return Response.json({ ok: false, status: "unconfigured" }, { status: 503 });
  }

  try {
    const baseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    return Response.json(
      { ok: response.ok, status: response.ok ? "online" : "unavailable" },
      { status: response.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, status: "offline" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

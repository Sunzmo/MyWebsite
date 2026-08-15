import { onRequestPost } from "../functions/api/openclaw-feedback.js";

export function POST(request: Request) {
  return onRequestPost({ request });
}

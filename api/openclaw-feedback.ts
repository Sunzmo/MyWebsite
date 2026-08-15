import { onRequestPost } from "../functions/api/openclaw-feedback";

export function POST(request: Request) {
  return onRequestPost({ request });
}

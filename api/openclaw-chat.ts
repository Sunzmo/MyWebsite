import {
  onRequestGet,
  onRequestPost,
} from "../functions/api/openclaw-chat";

export const maxDuration = 60;

export function GET() {
  return onRequestGet();
}

export function POST(request: Request) {
  return onRequestPost({ request, env: process.env });
}

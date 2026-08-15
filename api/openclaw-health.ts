import { onRequestGet } from "../functions/api/openclaw-health.js";

export function GET() {
  return onRequestGet({ env: process.env });
}

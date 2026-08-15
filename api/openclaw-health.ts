import { onRequestGet } from "../functions/api/openclaw-health";

export function GET() {
  return onRequestGet({ env: process.env });
}

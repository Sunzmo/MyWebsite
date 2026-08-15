import { onRequestGet } from "../functions/api/site-data.js";

export const maxDuration = 60;

export function GET() {
  return onRequestGet({ env: process.env });
}

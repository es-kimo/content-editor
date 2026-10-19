import type { NextRequest } from "next/server";

import { handleLogout } from "@/lib/auth";

export function POST(request: NextRequest) {
  return handleLogout(request);
}

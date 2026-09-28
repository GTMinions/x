import { NextResponse, type NextRequest } from "next/server";
import { listComments } from "@/app/_platform/wishes";

/** GET /api/wishes/<id>/comments — the activity thread. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ comments: await listComments(Number(id)) });
}

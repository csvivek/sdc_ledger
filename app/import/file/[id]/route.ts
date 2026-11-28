// Download the original file of one import. Admin only: requireAdmin here,
// and the storage bucket's own policies, both refuse anyone else.
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const file = await getStore().getImportFile(id);
  if (!file) return new Response("No copy of this file was kept. Imports made before copies were kept have none.", { status: 404 });
  const type = file.name.toLowerCase().endsWith(".xlsx")
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "application/vnd.ms-excel";
  const safe = file.name.replace(/[^A-Za-z0-9._ -]+/g, "_");
  return new Response(new Blob([file.data as BlobPart], { type }), {
    headers: {
      "Content-Disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

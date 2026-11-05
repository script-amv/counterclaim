import { CaseWorkspace } from "@/ui/case";
export default async function CasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <CaseWorkspace id={(await params).id} />;
}

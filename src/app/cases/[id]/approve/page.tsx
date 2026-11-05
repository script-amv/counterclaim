import { CaseWorkspace } from "@/ui/case";
export default async function ApprovePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <CaseWorkspace id={(await params).id} review />;
}

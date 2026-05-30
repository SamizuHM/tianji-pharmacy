import { RegionsManagement } from "@/components/admin/regions-management";
import { listRegions } from "@/lib/services/regions";

export default async function AdminRegionsPage() {
  const regions = await listRegions();
  return <RegionsManagement initialRegions={regions} />;
}

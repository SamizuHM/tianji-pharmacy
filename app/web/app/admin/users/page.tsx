import { UsersManagement } from "@/components/admin/users-management";
import { prisma } from "@/lib/db";
import { listManagedUsers } from "@/lib/services/users";

export default async function AdminUsersPage() {
  const [users, departments] = await Promise.all([
    listManagedUsers(),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);

  return <UsersManagement initialUsers={users} departments={departments} />;
}

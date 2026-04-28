import "dotenv/config";

import { drainKnowledgeIndexTasks } from "@/lib/services/knowledge-index";

async function main() {
  const result = await drainKnowledgeIndexTasks({ limit: 100 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

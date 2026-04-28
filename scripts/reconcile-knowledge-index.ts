import "dotenv/config";

import { reconcileKnowledgeIndex } from "@/lib/services/knowledge-index";

async function main() {
  const result = await reconcileKnowledgeIndex();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import "dotenv/config";

import { collectKnowledgeSourceFiles, importKnowledgeFromFiles } from "@/lib/services/knowledge";

async function main() {
  const files = await collectKnowledgeSourceFiles();
  const result = await importKnowledgeFromFiles(files);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


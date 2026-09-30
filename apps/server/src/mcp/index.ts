import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { def as listCategoriesDef, handler as listCategoriesHandler } from "./tools/list-categories";
import { def as addTransactionsDef, handler as addTransactionsHandler } from "./tools/add-transactions";
import { def as getMerchantDef, handler as getMerchantHandler } from "./tools/get-merchant";
import {
  def as setMerchantCategoryDef,
  handler as setMerchantCategoryHandler,
} from "./tools/set-merchant-category";
import { def as reassignDef, handler as reassignHandler } from "./tools/reassign-line-items";
import { def as getSummaryDef, handler as getSummaryHandler } from "./tools/get-summary";
import { def as listAssetsDef, handler as listAssetsHandler } from "./tools/list-assets";
import { def as recordAssetDef, handler as recordAssetHandler } from "./tools/record-asset";

const server = new McpServer({ name: "paragon", version: "0.0.1" });

server.registerTool(listCategoriesDef.name, listCategoriesDef.config, listCategoriesHandler);
server.registerTool(addTransactionsDef.name, addTransactionsDef.config, addTransactionsHandler);
server.registerTool(getMerchantDef.name, getMerchantDef.config, getMerchantHandler);
server.registerTool(
  setMerchantCategoryDef.name,
  setMerchantCategoryDef.config,
  setMerchantCategoryHandler,
);
server.registerTool(reassignDef.name, reassignDef.config, reassignHandler);
server.registerTool(getSummaryDef.name, getSummaryDef.config, getSummaryHandler);
server.registerTool(listAssetsDef.name, listAssetsDef.config, listAssetsHandler);
server.registerTool(recordAssetDef.name, recordAssetDef.config, recordAssetHandler);

const transport = new StdioServerTransport();
await server.connect(transport);

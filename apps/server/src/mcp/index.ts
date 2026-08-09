import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { def as listCategoriesDef, handler as listCategoriesHandler } from "./tools/list-categories";
import { def as addTransactionsDef, handler as addTransactionsHandler } from "./tools/add-transactions";

const server = new McpServer({ name: "paragon", version: "0.0.1" });

server.registerTool(listCategoriesDef.name, listCategoriesDef.config, listCategoriesHandler);
server.registerTool(addTransactionsDef.name, addTransactionsDef.config, addTransactionsHandler);

const transport = new StdioServerTransport();
await server.connect(transport);

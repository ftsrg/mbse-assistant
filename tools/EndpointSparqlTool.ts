import "dotenv/config";
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * EndpointSparqlTool
 * ------------------
 * A LangChain tool that executes SPARQL queries against a single configured endpoint
 * (typically an Apache Jena Fuseki endpoint).
 *
 * Design goals:
 * - Keep the API extremely simple for the LLM: input is a query string, output is compact JSON.
 * - Add dataset-specific PREFIX/BASE headers automatically (SysML vs BPMN) to reduce prompt burden.
 * - Truncate returned rows inside the tool to keep tool outputs small and safe for context limits.
 *
 * IMPORTANT (benchmarking):
 * - The benchmark runner should persist ONLY the query and a small summary (rowCount / boolean).
 * - Returned rows are for reasoning context only and must not be stored long-term.
 */

export type DatasetKind = "sysml" | "bpmn" | "generic";

const SYSML_PREFIX_HEADER = `BASE <http://api.koneksys.com/cameo/>
PREFIX vocab: <http://api.koneksys.com/cameo/vocab/>
PREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
`;

const BPMN_PREFIX_HEADER = `
prefix bbo: <http://www.onto-bpo.eu/ontologies/bbo#>
prefix bboExt: <http://www.onto-bpo.eu/ontologies/bboExtension#>
prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>
prefix tai: <https://www.teamingai-project.eu/>
prefix xsd: <http://www.w3.org/2001/XMLSchema#>
`;

function stripPrefixBaseLines(rawQuery: string): string {
  // Normalize input and remove any user-provided BASE/PREFIX lines.
  // We do this so the tool can inject the canonical header for the selected dataset.
  let q = (rawQuery ?? "").trim();
  q = q.replace(/^\s*(BASE|PREFIX)\b[^\n]*\n/igm, "").trim();
  return q;
}

function buildFinalQuery(rawQuery: string, datasetKind: DatasetKind): string {
  // For generic datasets we do not inject any header.
  if (datasetKind === "generic") return (rawQuery ?? "").trim() + "\n";

  // For known datasets we remove any user headers and prepend our canonical prefixes.
  const body = stripPrefixBaseLines(rawQuery);
  const header = datasetKind === "sysml" ? SYSML_PREFIX_HEADER : BPMN_PREFIX_HEADER;
  return header + body + "\n";
}

export class EndpointSparqlTool extends StructuredTool {
  name = "sparql_query";
  description =
    "Run a SPARQL SELECT/ASK query against a configured endpoint. " +
    'Input: {"query":"SELECT ..."}. Output: JSON string with status/type/rowCount and truncated rows.';

  schema = z.object({
    query: z.string().describe("The full SPARQL query (SELECT or ASK)"),
  });

  private endpoint: string;
  private datasetKind: DatasetKind;
  private rowSampleLimit: number;
  /** The exact query string that was executed (after prefix/header normalization). */
  public lastExecutedQuery: string | null = null;

  constructor(opts: { endpoint: string; datasetKind?: DatasetKind; rowSampleLimit?: number }) {
    super();
    if (!opts?.endpoint) throw new Error("EndpointSparqlTool: missing endpoint");

    // Store configuration. The tool instance is bound to a single endpoint.
    this.endpoint = opts.endpoint;

    // Controls which canonical PREFIX header is injected (or none for "generic").
    this.datasetKind = opts.datasetKind ?? "generic";

    // Maximum number of result rows to return to the LLM for context.
    this.rowSampleLimit = opts.rowSampleLimit ?? 20;
  }

  async _call({ query }: { query: string; includeNeighbours?: boolean }): Promise<string> {
    // Build the final query that will be executed (includes canonical prefixes for known datasets).
    const qFinal = buildFinalQuery(query, this.datasetKind);
    this.lastExecutedQuery = qFinal;

    // Fuseki (and many SPARQL endpoints) can return results as SPARQL Results JSON.
    const headers: Record<string, string> = { Accept: "application/sparql-results+json" };

    try {
      // For Fuseki, a simple HTTP GET with ?query=... is enough.
      const res = await fetch(`${this.endpoint}?query=${encodeURIComponent(qFinal)}`, { headers });
      const text = await res.text();

      if (!res.ok) {
        // Endpoint returned an HTTP error. We return a compact error JSON for the LLM.
        return JSON.stringify({
          status: "error",
          error: "endpoint_error",
          httpStatus: res.status,
          message: text?.slice(0, 600) ?? "",
        });
      }

      let data: any;
      try {
        // Parse SPARQL Results JSON.
        data = JSON.parse(text);
      } catch (e: any) {
        // Sometimes endpoints return HTML or plain-text error payloads even with 200 OK.
        return JSON.stringify({
          status: "error",
          error: "parse_error",
          message: String(e?.message ?? e),
          raw: text?.slice(0, 600) ?? "",
        });
      }

      // ASK
      if (typeof data?.boolean === "boolean") {
        // ASK queries return { boolean: true/false }
        return JSON.stringify({ status: "ok", type: "ask", boolean: data.boolean });
      }

      // SELECT
      // SELECT queries return head.vars + results.bindings.
      const vars: string[] = Array.isArray(data?.head?.vars) ? data.head.vars : [];
      const bindings: any[] = Array.isArray(data?.results?.bindings) ? data.results.bindings : [];

      // Convert SPARQL JSON bindings into a plain row object with simple string values.
      // Example binding cell: { type: "literal", value: "..." }
      const rows = bindings.map((b: any) => {
        const row: Record<string, any> = {};
        for (const [k, v] of Object.entries<any>(b)) {
          row[k] = v && typeof v === "object" ? v.value : v;
        }
        return row;
      });

      if (rows.length === 0) {
        // A valid SELECT query that returned no rows.
        return JSON.stringify({ status: "empty", error: "empty", rows: 0, vars });
      }

      // Return only a sample of the rows to avoid flooding the model context.
      const shortRows = rows.slice(0, this.rowSampleLimit);
      return JSON.stringify({
        status: "ok",
        type: "select",
        rowCount: rows.length,
        vars,
        rows: shortRows,
        rowsTruncated: rows.length > shortRows.length,
      });
    } catch (e: any) {
      // Network-level or fetch-level failure.
      return JSON.stringify({
        status: "error",
        error: "network_error",
        message: String(e?.message ?? e),
      });
    }
  }
}

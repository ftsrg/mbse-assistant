import path from "node:path";
import { pathToFileURL } from "node:url";

export type KeywordProvider = {
  getKeywords(questionId: string): string[];
};

/**
 * Convert question ids like q001, q002, ... into zero-based indices.
 * Returns null if the id does not follow the expected qNNN format.
 */
function questionIdToIndex(questionId: string): number | null {
  const m = /^q(\d+)$/i.exec(String(questionId).trim());
  if (!m) return null;

  const idx = parseInt(m[1], 10) - 1;
  return Number.isFinite(idx) && idx >= 0 ? idx : null;
}

/**
 * Normalize any unknown nested keyword structure into string[][].
 * Each outer element corresponds to one question.
 * Each inner element is the keyword list for that question.
 */
function normalizeKeywordTable(candidate: any): string[][] {
  if (!Array.isArray(candidate)) {
    throw new Error("Keyword source is not an array.");
  }

  return candidate.map((row: any) =>
    Array.isArray(row)
      ? row.map((x: any) => String(x).trim()).filter(Boolean)
      : []
  );
}

/**
 * Load a keyword table from a TS/JS module.
 *
 * Supported export shapes:
 * - default export
 * - named export: KEYWORDS
 * - named export: KEYWORDS_BPMN
 * - named export: KEYWORDS_SYSML
 */
async function loadKeywordTableFromModule(keywordFileAbs: string): Promise<string[][]> {
  const modUrl = pathToFileURL(path.resolve(keywordFileAbs)).href;
  const mod: any = await import(modUrl);

  const candidate =
    mod.default ??
    mod.KEYWORDS ??
    mod.KEYWORDS_BPMN ??
    mod.KEYWORDS_SYSML ??
    null;

  if (candidate == null) {
    throw new Error(
      `Keyword module does not export any supported keyword table: ${keywordFileAbs}`
    );
  }

  return normalizeKeywordTable(candidate);
}

/**
 * Create a keyword provider from an optional keyword source file.
 *
 * If no keyword file is provided, the provider returns an empty keyword list
 * for every question.
 */
export async function createKeywordProvider(
  keywordFileAbs?: string | null
): Promise<KeywordProvider> {
  if (!keywordFileAbs) {
    return {
      getKeywords(): string[] {
        return [];
      },
    };
  }

  const table = await loadKeywordTableFromModule(keywordFileAbs);

  return {
    getKeywords(questionId: string): string[] {
      const idx = questionIdToIndex(questionId);
      if (idx == null) return [];
      return table[idx] ?? [];
    },
  };
}
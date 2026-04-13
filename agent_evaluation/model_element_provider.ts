import fs from "node:fs/promises";

export type ModelElementProvider = {
  getModelElementIds(questionId: string): string[];
};

type ModelElementMappingFile = {
  questions?: Array<{
    questionId?: string;
    model_element_uris?: string[];
  }>;
};

class EmptyModelElementProvider implements ModelElementProvider {
  getModelElementIds(_questionId: string): string[] {
    return [];
  }
}

class JsonModelElementProvider implements ModelElementProvider {
  constructor(private readonly map: Map<string, string[]>) {}

  getModelElementIds(questionId: string): string[] {
    return this.map.get(questionId) ?? [];
  }
}

export async function createModelElementProvider(
  filePath: string | null
): Promise<ModelElementProvider> {
  if (!filePath) {
    return new EmptyModelElementProvider();
  }

  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as ModelElementMappingFile;

  const map = new Map<string, string[]>();

  for (const item of parsed.questions ?? []) {
    const questionId = typeof item?.questionId === "string" ? item.questionId.trim() : "";
    if (!questionId) continue;

    const uris = Array.isArray(item?.model_element_uris)
      ? item.model_element_uris
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim())
          .filter((x) => x.length > 0)
      : [];

    map.set(questionId, uris);
  }

  return new JsonModelElementProvider(map);
}
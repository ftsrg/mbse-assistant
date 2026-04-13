import path from "node:path";
import { env } from "@huggingface/transformers";

// Keep HF/Transformers cache OUTSIDE node_modules, stable across installs.
// Repo-local cache:
env.cacheDir = path.resolve(process.cwd(), ".cache", "transformers");

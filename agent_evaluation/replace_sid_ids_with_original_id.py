#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Replace model IDs inside benchmark question JSON files with original BPMN file names.

===============================================================================
RUN GUIDE
===============================================================================

Purpose
-------
This script replaces SID-style model IDs inside benchmark question JSON files
with the corresponding original BPMN file names from meta_data.csv.

By default, the script does NOT modify the original dataset folder in place.

Instead, it:

1. renames:
       automated_test_results/sap-sam-export_aggregated
   to:
       automated_test_results/sap-sam-export_aggregated_deprecated_ids
   (only on the first run, if the deprecated folder does not yet exist)

2. recreates:
       automated_test_results/sap-sam-export_aggregated
   as a fresh copy of:
       automated_test_results/sap-sam-export_aggregated_deprecated_ids

3. then performs all JSON replacements under:
       automated_test_results/sap-sam-export_aggregated/runs

For each run folder, it looks for a: questions/ subfolder, and then processes
every: *.json file inside that folder.

Replacement logic
-----------------
The script searches for tokens that:

1. start with:
       sid_
   or:
       sid-

2. continue with one or more characters from:
       A-Z, a-z, 0-9, underscore (_), hyphen (-)

3. are NOT immediately preceded by a forward slash (/)

After a token is found:
- it is converted to lowercase
- that lowercase value is looked up in meta_data.csv, in the "model" column
- if a match is found, the token is replaced with the corresponding
  "original_file" value, but with the trailing ".bpmn" removed

Safety behavior
---------------
The script is designed to preserve the original benchmark run dataset.

Default behavior:
- copy original dataset folder
- transform only the copied folder
- leave the source folder unchanged

If the target copy already exists, it is deleted first and recreated from the source.

Expected locations
------------------
This script assumes:
- the script itself is inside:
      agent_evaluation/
- the metadata CSV is by default:
      agent_evaluation/meta_data.csv
- the source dataset folder is by default:
      automated_test_results/sap-sam-export_aggregated
- the generated working copy is by default:
      automated_test_results/sap-sam-export_aggregated
- the processed runs root is by default:
      automated_test_results/sap-sam-export_aggregated/runs

Optional override
-----------------
You may explicitly provide:
    --runs-root <path>

In that case, the script skips the default copy-based dataset selection logic
and processes the provided runs root directly.

How to run from the project root
--------------------------------
Recommended command:

    python3 agent_evaluation/replace_sid_ids_with_original_id.py

Optional custom runs root:

    python3 agent_evaluation/replace_sid_ids_with_original_id.py --runs-root "C:\\some\\other\\runs"

What the script prints
----------------------
At the end, the script prints:
- number of mappings loaded from meta_data.csv
- number of JSON files visited
- number of JSON files changed
- total number of replacements made

It may also print:
- which runs root is being processed
- which JSON files were changed

Important rule
--------------
- Never modify JSON values stored under a key named exactly "query".
- This is needed because SPARQL queries are stored there and must remain unchanged.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
import shutil


SCRIPT_DIR = Path(__file__).resolve().parent
ACTIVE_DATASET_DIR = SCRIPT_DIR.parent / "automated_test_results" / "sap-sam-export_aggregated"
DEPRECATED_DATASET_DIR = SCRIPT_DIR.parent / "automated_test_results" / "sap-sam-export_aggregated_deprecated_ids"


def prepare_rotated_dataset(active_dir: Path, deprecated_dir: Path) -> Path:
    """
    Preserve the original dataset under a deprecated name, then recreate the
    active dataset folder as a fresh copy and process that copy.

    Final state after default execution:
    - preserved original:
          <deprecated_dir>
    - recreated working copy:
          <active_dir>

    Behavior:
    - If deprecated_dir does not exist yet:
        rename active_dir -> deprecated_dir
        then copy deprecated_dir -> active_dir

    - If deprecated_dir already exists:
        treat deprecated_dir as the preserved original source
        delete active_dir if it exists
        then copy deprecated_dir -> active_dir

    Returns:
        <active_dir>/runs
    """
    if not active_dir.exists() and not deprecated_dir.exists():
        raise FileNotFoundError(
            f"Neither active dataset nor deprecated dataset exists. "
            f"Active: {active_dir} | Deprecated: {deprecated_dir}"
        )

    if not deprecated_dir.exists():
        if not active_dir.exists():
            raise FileNotFoundError(f"Active dataset folder not found: {active_dir}")

        active_dir.rename(deprecated_dir)

    if active_dir.exists():
        shutil.rmtree(active_dir)

    shutil.copytree(deprecated_dir, active_dir)

    target_runs_dir = active_dir / "runs"
    if not target_runs_dir.exists():
        raise FileNotFoundError(f"Runs folder not found after recreation: {target_runs_dir}")

    return target_runs_dir


# Match:
#   sid_...
#   sid-...
# but NOT if immediately preceded by "/"
SID_TOKEN_PATTERN = re.compile(r"(?<!/)sid[_-][A-Za-z0-9_-]+", re.IGNORECASE)


def load_mapping(meta_csv_path: Path) -> dict[str, str]:
    """
    Load model -> original_file mapping from meta_data.csv.

    Expected CSV columns:
        - model
        - original_file

    Stored form:
        lowercase(model) -> original_file without trailing ".bpmn"
    """
    mapping: dict[str, str] = {}

    with meta_csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)

        if not reader.fieldnames or "model" not in reader.fieldnames or "original_file" not in reader.fieldnames:
            raise ValueError(
                f"Missing required CSV columns. Expected: 'model', 'original_file'. "
                f"Available columns: {reader.fieldnames}"
            )

        for row in reader:
            model = (row.get("model") or "").strip()
            original_file = (row.get("original_file") or "").strip()

            if not model or not original_file:
                continue

            model_key = model.lower()
            original_without_ext = re.sub(r"\.bpmn$", "", original_file, flags=re.IGNORECASE)

            if model_key in mapping and mapping[model_key] != original_without_ext:
                raise ValueError(
                    f"Conflicting mapping for model key {model_key!r}: "
                    f"{mapping[model_key]!r} vs {original_without_ext!r}"
                )

            mapping[model_key] = original_without_ext

    return mapping


def replace_sid_tokens_in_text(text: str, mapping: dict[str, str]) -> tuple[str, int]:
    """
    Replace eligible SID tokens inside a plain text string.

    Rules:
    - Match only sid_... or sid-... tokens
    - Do not match if directly preceded by "/"
    - Lowercase the matched token before lookup
    - If no mapping exists, leave the token unchanged

    Returns:
        (new_text, replacement_count)
    """
    replacement_count = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal replacement_count
        token = match.group(0)
        token_key = token.lower()

        replacement = mapping.get(token_key)
        if replacement is None:
            return token

        replacement_count += 1
        return replacement

    new_text = SID_TOKEN_PATTERN.sub(repl, text)
    return new_text, replacement_count


def replace_in_json_value(value, mapping: dict[str, str], current_key: str | None = None):
    """
    Recursively walk a JSON-like Python structure and replace SID tokens in string values.

    Critical rule:
    - If the current value belongs to a key named exactly "query",
      return it unchanged.
    - This protects SPARQL query text such as:
          request.query
      from any replacement.

    Behavior by type:
    - dict  -> recurse into values
    - list  -> recurse into elements
    - str   -> replace SID tokens unless current_key == "query"
    - other -> leave unchanged

    Returns:
        (new_value, replacement_count)
    """
    # Protect SPARQL query bodies.
    if current_key == "query":
        return value, 0

    if isinstance(value, dict):
        new_obj = {}
        total = 0
        for key, child in value.items():
            new_child, child_count = replace_in_json_value(child, mapping, current_key=key)
            new_obj[key] = new_child
            total += child_count
        return new_obj, total

    if isinstance(value, list):
        new_list = []
        total = 0
        for item in value:
            new_item, item_count = replace_in_json_value(item, mapping, current_key=None)
            new_list.append(new_item)
            total += item_count
        return new_list, total

    if isinstance(value, str):
        return replace_sid_tokens_in_text(value, mapping)

    return value, 0


def process_file(file_path: Path, mapping: dict[str, str]) -> int:
    """
    Process a single JSON file structurally.

    Why this version is safer than raw text replacement:
    - It can skip specific JSON fields by key name
    - Here we skip every field named exactly "query"

    Notes:
    - The file is parsed as JSON
    - The transformed JSON is written back with indent=2
    - Unicode characters are preserved via ensure_ascii=False
    - The file is rewritten only if at least one replacement happened

    Returns:
        number of replacements made in this file
    """
    original_text = file_path.read_text(encoding="utf-8")
    obj = json.loads(original_text)

    new_obj, replacement_count = replace_in_json_value(obj, mapping)

    if replacement_count > 0:
        file_path.write_text(
            json.dumps(new_obj, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    return replacement_count


def find_question_json_files(runs_root: Path) -> list[Path]:
    """
    Find all JSON files under:

        <runs_root>/<run_dir>/questions/*.json
    """
    result: list[Path] = []

    if not runs_root.exists():
        raise FileNotFoundError(f"Runs root folder not found: {runs_root}")

    for run_dir in sorted(p for p in runs_root.iterdir() if p.is_dir()):
        questions_dir = run_dir / "questions"
        if not questions_dir.is_dir():
            continue

        for json_file in sorted(questions_dir.glob("*.json")):
            result.append(json_file)

    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Replace SID-style model IDs in benchmark question JSON files, except inside 'query' fields."
    )

    parser.add_argument(
        "--meta",
        type=Path,
        default=SCRIPT_DIR / "meta_data.csv",
        help="Path to meta_data.csv",
    )

    parser.add_argument(
        "--runs-root",
        type=Path,
        default=None,
        help="Optional path to the benchmark runs root. If omitted, the script preserves "
            "'sap-sam-export_aggregated' as 'sap-sam-export_aggregated_deprecated_ids', "
            "recreates 'sap-sam-export_aggregated' as a fresh copy, and processes that runs folder.",
    )
    

    args = parser.parse_args()

    meta_path = args.meta.resolve()

    if not meta_path.exists():
        raise FileNotFoundError(f"meta_data.csv not found: {meta_path}")

    if args.runs_root is not None:
        runs_root = args.runs_root.resolve()
    else:
        runs_root = prepare_rotated_dataset(ACTIVE_DATASET_DIR, DEPRECATED_DATASET_DIR)

    print(f"Processing runs root: {runs_root}")

    mapping = load_mapping(meta_path)
    json_files = find_question_json_files(runs_root)

    total_files = 0
    changed_files = 0
    total_replacements = 0

    for file_path in json_files:
        total_files += 1
        replacements = process_file(file_path, mapping)

        if replacements > 0:
            changed_files += 1
            total_replacements += replacements
            print(f"[CHANGED] {file_path}  ({replacements} replacements)")

    print()
    print(f"Loaded metadata mappings: {len(mapping)}")
    print(f"Visited JSON files:       {total_files}")
    print(f"Modified JSON files:      {changed_files}")
    print(f"Total replacements:       {total_replacements}")


if __name__ == "__main__":
    main()
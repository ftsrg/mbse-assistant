from __future__ import annotations

"""
Create grouped benchmark bar charts and original-vs-mutant scatter plots
from one aggregated metrics CSV.

Overview
--------
This script reads the `metrics_results.csv` file produced by the aggregation step,
joins each question to a human-defined question category, filters the rows based
on optional CLI parameters, and generates charts into a fresh timestamped output
folder on every invocation.

Supported diagram types
-----------------------
1) Bar charts
   Visual grouping:
       llmModel -> datasetKind -> question category

   One bar represents:
       average(metric value)
   for one exact combination of:
       llmModel + datasetKind + question category + metric

2) Scatter plots
   A scatter point represents one original question and its mutant pair for one
   exact combination of:
       llmModel + datasetKind + questionId + question category + metric

   X axis:
       metric value on the original question set

   Y axis:
       metric value on the mutant question set

   Important assumption:
       This script assumes the question-set naming convention
       `<name>_questions` -> `<name>_mutant_questions`.
       Example:
           bpmn_questions -> bpmn_mutant_questions

       The script detects scatter-compatible pairs only from this naming rule.

Expected input CSV
------------------
The summary directory must contain:
    <summary_dir>/metrics_results.csv

The CSV must contain at least these columns for bar charts:
    runId, llmModel, datasetKind, questionId, metric, value, status

Additional column required for scatter plots:
    questionSet

Expected category files
-----------------------
For every datasetKind that appears in the filtered data, the script expects a
matching category JSON file under:
    questions/question_categories/<datasetKind>_categories.json

Examples:
    questions/question_categories/sap-sam-export_aggregated_categories.json
    questions/question_categories/sysml_categories.json

Each category JSON file is expected to contain a list of objects like:
    [
      {
        "name": "Junior",
        "displayName": "SysML Junior",
        "questions": ["q001", "q005", ...]
      }
    ]

Output folders
--------------
Every invocation creates a new timestamped output folder under:
    <summary_dir>/plots/<timestamp>/

Inside that timestamped folder the script creates:
    <summary_dir>/plots/<timestamp>/bar/
    <summary_dir>/plots/<timestamp>/scatter/

This allows repeated runs with different filters without overwriting previous
results.

CLI usage
---------
Basic usage:
    python3 agent_evaluation/create_result_plots.py <summary_dir>

Example:
    python3 agent_evaluation/create_result_plots.py automated_test_results/_summary/2026-04-03T21-37-27

Optional filters
----------------
You can restrict the plotted data with these optional filters:

1) Filter by datasetKind
    --datasetkind <value1> <value2> ...

2) Filter by category
    --category <value1> <value2> ...

3) Filter by llmModel
    --llm-model <value1> <value2> ...

4) Choose diagram type
    --diagramtype <bar|scatter|matrix|heatmap>

If `--diagramtype` is omitted, bar, scatter, matrix and heatmap plots are generated.

All list-like filters accept either:
- space-separated values
- comma-separated values
- or a mix of both

Examples:
    python3 agent_evaluation/create_result_plots.py automated_test_results/_summary/2026-04-03T21-37-27

    python3 agent_evaluation/create_result_plots.py automated_test_results/_summary/2026-04-03T21-37-27 --diagramtype bar

    python3 agent_evaluation/create_result_plots.py automated_test_results/_summary/2026-04-03T21-37-27 \
        --diagramtype scatter

    python3 agent_evaluation/create_result_plots.py automated_test_results/_summary/2026-04-03T21-37-27 \
        --datasetkind sap-sam-export_aggregated sysml

    python3 agent_evaluation/create_result_plots.py automated_test_results/_summary/2026-04-03T21-37-27 \
        --llm-model openai/gpt-5-mini minimax/minimax-m2.5

    python3 agent_evaluation/create_result_plots.py automated_test_results/_summary/2026-04-03T21-37-27 \
        --category Junior Senior

Category filter matching rules
------------------------------
A category filter value may match any of these forms:
- raw category name
- category displayName
- datasetKind::category name
- datasetKind::category displayName

Examples:
    --category Junior
    --category "SysML Junior"
    --category "sysml::Junior"
    --category "sysml::SysML Junior"

What happens when no filters are given
--------------------------------------
If you run the script without optional filters:
- all dataset kinds found in the CSV are included
- all LLM models found in the CSV are included
- all categories from the matching category JSON files are considered
- one bar chart is generated for every metric found in the CSV
- one scatter plot is generated for every metric and every detected
  original-vs-mutant question-set pair

Notes
-----
- Missing category files raise an error when the corresponding dataset is needed.
- Questions that are not present in any category are ignored with a warning.
- If a requested filter value does not exist in the data, the script stops with
  a clear error message.
- Scatter plots require the `questionSet` column in `metrics_results.csv`.
"""

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
import pandas as pd

import textwrap


# Directory that stores the category definition JSON files.
# The expected naming convention is:
#   questions/question_categories/<datasetKind>_categories.json
CATEGORY_DIR = Path("questions") / "question_categories"


# Human-friendly chart titles for the known metrics.
# If a metric name is missing here, the raw metric name will be used as the title.
"""METRIC_DISPLAY_NAMES = {
    "keyword_count_exact_match": "Keyword Count (Exact Match)",
    "keyword_counter_agent": "Keyword Count (Agent)",
    "rouge_l_f1": "ROUGE-L",
    "chrf": "chrF",
    "bertscore": "BERT Score",
    "llm_judge_majority": "Majority LLM Judge",
    "llm_judge_score_avg": "Scaling LLM Judge",
    "cosine_similarity": "Cosine Similarity",
    "model_element_uri_recall": "Model Element URI Recall",
    "model_element_uri_precision": "Model Element URI Precision"
}"""

METRIC_DISPLAY_NAMES = {
    "keyword_count_exact_match": "KW_EM",
    "keyword_counter_agent": "KW_LLM",
    "rouge_l_f1": "ROUGE",
    "chrf": "CHRF",
    "bertscore": "BERT",
    "llm_judge_majority": "J_2o3",
    "llm_judge_score_avg": "J_1-5",
    "cosine_similarity": "COS",
    "model_element_uri_recall": "REC",
    "model_element_uri_precision": "PREC"
}


# Fixed axis limits for metrics where a stable scale is useful.
# This keeps charts visually comparable across different runs.
METRIC_Y_LIMITS = {
    "keyword_count_exact_match": (0, 1),
    "keyword_counter_agent": (0, 1),
    "rouge_l_f1": (0, 1),
    "chrf": (0, 1),
    "bertscore": (0, 1),
    "llm_judge_majority": (0, 1),
    "llm_judge_score_avg": (1, 5),
    "cosine_similarity": (0, 1),
    "model_element_uri_recall": (0, 1),
    "model_element_uri_precision": (0, 1),
}




# Fixed category palette.
# Colors are assigned deterministically to category keys, so a category keeps
# the same color across bar and scatter charts.
CATEGORY_PALETTE = [
    "tab:blue",
    "tab:orange",
    "tab:green",
    "tab:red",
    "tab:purple",
    "tab:brown",
    "tab:pink",
    "tab:gray",
    "tab:olive",
    "tab:cyan",
]


# Marker pool for different LLM models in scatter plots.
# A heuristic preference is applied first for known model families, and the
# remaining markers are assigned deterministically.
MODEL_MARKER_POOL = ["o", "v", "s", "D", "^", "P", "X", "<", ">", "*", "h", "8"]


# Layout constants controlling bar width and the spacing between logical groups.
BAR_WIDTH = 0.8
BAR_STEP = 1.0
DATASET_GAP = 0.9
MODEL_GAP = 1.8


# The aggregated CSV must contain at least these columns.
REQUIRED_COLUMNS = {
    "runId",
    "llmModel",
    "datasetKind",
    "questionId",
    "metric",
    "value",
    "status",
}


def slugify(text: str) -> str:
    """Convert arbitrary text into a filesystem-safe file name fragment."""
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_") or "plot"


def normalize_text(text: str) -> str:
    """Normalize text for case-insensitive matching in filters and lookups."""
    return re.sub(r"\s+", " ", str(text).strip().lower())


def format_category_legend_label(label: str) -> str:
    """
    Format category legend labels so they stay wider and flatter.
    The goal is to avoid very tall legend entries.
    """
    return textwrap.fill(
        str(label),
        width=34,
        break_long_words=False,
        break_on_hyphens=False,
    )


def flatten_cli_values(values: list[str] | None) -> list[str] | None:
    """
    Normalize CLI filter values.

    Supports both:
    - space-separated arguments
    - comma-separated values inside one argument

    Example:
        ["a", "b,c"] -> ["a", "b", "c"]
    """
    if not values:
        return None

    out: list[str] = []
    for raw in values:
        for part in str(raw).split(","):
            part = part.strip()
            if part:
                out.append(part)

    return out or None


def unique_keep_order(values: list[str]) -> list[str]:
    """Remove duplicates while preserving the original order."""
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        key = normalize_text(value)
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def load_categories_for_dataset(dataset_name: str) -> list[dict[str, Any]]:
    """
    Load the category JSON for one dataset.

    Expected path:
        questions/question_categories/<dataset_name>_categories.json
    """
    json_path = CATEGORY_DIR / f"{dataset_name}_categories.json"
    if not json_path.exists():
        raise FileNotFoundError(f"Missing category file: {json_path}")
    return json.loads(json_path.read_text(encoding="utf-8"))


def build_category_infos(dataset_name: str) -> list[dict[str, Any]]:
    """
    Normalize one dataset's category JSON into a stable internal structure.

    Output fields:
    - key: unique key in the form `datasetKind::name`
    - datasetKind
    - name
    - displayName
    - questions
    """
    raw_categories = load_categories_for_dataset(dataset_name)
    infos: list[dict[str, Any]] = []

    for category in raw_categories:
        raw_name = str(category.get("name", "")).strip()
        raw_display = str(category.get("displayName", raw_name)).strip()
        questions = [str(q).strip() for q in category.get("questions", []) if str(q).strip()]

        # Skip malformed empty category records.
        if not raw_name and not raw_display:
            continue

        key = f"{dataset_name}::{raw_name or raw_display}"
        infos.append(
            {
                "key": key,
                "datasetKind": dataset_name,
                "name": raw_name,
                "displayName": raw_display or raw_name,
                "questions": questions,
            }
        )

    return infos


def build_question_to_category_map(
    category_infos_by_dataset: dict[str, list[dict[str, Any]]],
) -> dict[tuple[str, str], dict[str, Any]]:
    """
    Build a reverse lookup from `(datasetKind, questionId)` to category info.

    The mapping must be one-to-one within a dataset. If the same question appears
    in multiple categories of the same dataset, the script stops with an error.
    """
    out: dict[tuple[str, str], dict[str, Any]] = {}

    for dataset_name, infos in category_infos_by_dataset.items():
        for info in infos:
            for question_id in info["questions"]:
                map_key = (dataset_name, question_id)
                if map_key in out:
                    prev = out[map_key]["displayName"]
                    curr = info["displayName"]
                    raise ValueError(
                        f"Question {question_id!r} in dataset {dataset_name!r} appears in multiple categories: "
                        f"{prev!r} and {curr!r}."
                    )
                out[map_key] = info

    return out


def build_global_color_map(
    category_infos_by_dataset: dict[str, list[dict[str, Any]]],
    dataset_order: list[str],
) -> dict[str, str]:
    """
    Assign fixed colors to categories in a deterministic order.

    The order is:
    - datasets in `dataset_order`
    - categories in the order found in each dataset JSON

    This ensures that repeated runs generate stable category colors.
    """
    ordered_categories: list[dict[str, Any]] = []
    for dataset_name in dataset_order:
        ordered_categories.extend(category_infos_by_dataset.get(dataset_name, []))

    color_map: dict[str, str] = {}
    for idx, info in enumerate(ordered_categories):
        color_map[info["key"]] = CATEGORY_PALETTE[idx % len(CATEGORY_PALETTE)]
    return color_map


def build_filter_suffix(
    dataset_filters: list[str] | None,
    category_filters: list[str] | None,
    llm_filters: list[str] | None,
) -> str:
    """Create a stable output file-name suffix from the active filters."""
    parts: list[str] = []
    if dataset_filters:
        parts.append("dataset_" + slugify("_".join(dataset_filters)))
    if category_filters:
        parts.append("category_" + slugify("_".join(category_filters)))
    if llm_filters:
        parts.append("llm_" + slugify("_".join(llm_filters)))
    return "__" + "__".join(parts) if parts else ""


def resolve_dataset_order(df: pd.DataFrame, requested: list[str] | None) -> list[str]:
    """
    Resolve requested datasetKind filters against the values available in the CSV.

    If no filter is provided, all datasets found in the CSV are returned in
    sorted order.
    """
    available = df["datasetKind"].dropna().astype(str).unique().tolist()
    available_map = {normalize_text(name): name for name in available}

    if not requested:
        return sorted(available)

    resolved: list[str] = []
    missing: list[str] = []
    for raw in requested:
        key = normalize_text(raw)
        if key in available_map:
            resolved.append(available_map[key])
        else:
            missing.append(raw)

    if missing:
        raise ValueError(
            "Unknown datasetKind filter value(s): "
            + ", ".join(missing)
            + ". Available values: "
            + ", ".join(sorted(available))
        )

    return unique_keep_order(resolved)


def resolve_llm_order(df: pd.DataFrame, requested: list[str] | None) -> list[str]:
    """
    Resolve requested llmModel filters against the values available in the CSV.

    If no filter is provided, all models found in the CSV are returned in
    sorted order.
    """
    available = df["llmModel"].dropna().astype(str).unique().tolist()
    available_map = {normalize_text(name): name for name in available}

    if not requested:
        return sorted(available)

    resolved: list[str] = []
    missing: list[str] = []
    for raw in requested:
        key = normalize_text(raw)
        if key in available_map:
            resolved.append(available_map[key])
        else:
            missing.append(raw)

    if missing:
        raise ValueError(
            "Unknown llmModel filter value(s): "
            + ", ".join(missing)
            + ". Available values: "
            + ", ".join(sorted(available))
        )

    return unique_keep_order(resolved)


def resolve_category_keys(
    requested: list[str] | None,
    category_infos_by_dataset: dict[str, list[dict[str, Any]]],
    dataset_order: list[str],
) -> list[str] | None:
    """
    Resolve category filter strings to internal category keys.

    A user-provided category filter may match:
    - category name
    - category displayName
    - datasetKind::category name
    - datasetKind::category displayName
    """
    if not requested:
        return None

    lookup: dict[str, list[str]] = {}
    for dataset_name in dataset_order:
        for info in category_infos_by_dataset.get(dataset_name, []):
            candidates = {
                normalize_text(info["name"]),
                normalize_text(info["displayName"]),
                normalize_text(f"{dataset_name}::{info['name']}"),
                normalize_text(f"{dataset_name}::{info['displayName']}")
            }
            for candidate in candidates:
                if not candidate:
                    continue
                lookup.setdefault(candidate, []).append(info["key"])

    resolved: list[str] = []
    missing: list[str] = []
    for raw in requested:
        key = normalize_text(raw)
        matches = lookup.get(key, [])
        if not matches:
            missing.append(raw)
            continue
        for match in matches:
            if match not in resolved:
                resolved.append(match)

    if missing:
        available_labels: list[str] = []
        for dataset_name in dataset_order:
            for info in category_infos_by_dataset.get(dataset_name, []):
                available_labels.append(f"{dataset_name}::{info['displayName']}")
        raise ValueError(
            "Unknown category filter value(s): "
            + ", ".join(missing)
            + ". Available values: "
            + ", ".join(available_labels)
        )

    return resolved

def break_before_third_word(text: str) -> str:
    """
    Insert a line break before the 3rd word.

    Examples:
        "Keyword Count Automatic" -> "Keyword Count\nAutomatic"
        "Model Element URI Recall" -> "Model Element\nURI Recall"
    """
    parts = str(text).split()
    if len(parts) < 3:
        return str(text)
    elif (len(parts) < 5):
        return " ".join(parts[:2]) + "\n" + " ".join(parts[2:])
    else:
        return " ".join(parts[:2]) + "\n" + " ".join(parts[2:4]) + "\n" + " ".join(parts[4:])

def resolve_diagram_types(requested: list[str] | None) -> list[str]:
    """Resolve diagram type requests. Supported values: bar, scatter, matrix, heatmap."""
    allowed = {"bar", "scatter", "matrix", "heatmap"}
    if not requested:
        return ["bar", "scatter", "matrix", "heatmap"]

    resolved: list[str] = []
    invalid: list[str] = []
    for raw in requested:
        value = normalize_text(raw)
        if value in allowed:
            if value not in resolved:
                resolved.append(value)
        else:
            invalid.append(raw)

    if invalid:
        raise ValueError(
            "Unknown diagram type(s): "
            + ", ".join(invalid)
            + ". Allowed values: bar, scatter, matrix, heatmap"
        )

    return resolved


def metric_sort_key(metric_name: str) -> tuple[int, str]:
    """Keep known metrics first and sort unknown ones alphabetically after them."""
    ordered = list(METRIC_DISPLAY_NAMES.keys())
    if metric_name in ordered:
        return (0, str(ordered.index(metric_name)))
    return (1, metric_name)


def build_timestamped_output_dirs(summary_dir: Path) -> tuple[Path, Path, Path, Path, Path]:
    """Create a fresh timestamped plot output structure for the current invocation."""
    ts = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    root = summary_dir / "plots" / ts
    bar_dir = root / "bar"
    scatter_dir = root / "scatter"
    matrix_dir = root / "matrix"
    heatmap_dir = root / "heatmap"

    bar_dir.mkdir(parents=True, exist_ok=True)
    scatter_dir.mkdir(parents=True, exist_ok=True)
    matrix_dir.mkdir(parents=True, exist_ok=True)
    heatmap_dir.mkdir(parents=True, exist_ok=True)

    return root, bar_dir, scatter_dir, matrix_dir, heatmap_dir


def infer_question_set_pairs(question_sets: list[str]) -> list[tuple[str, str]]:
    """
    Detect original-vs-mutant question-set pairs.

    Assumption:
        `<name>_questions` pairs with `<name>_mutant_questions`.
    """
    normalized = sorted({str(qs) for qs in question_sets if str(qs).strip()})
    available = set(normalized)
    pairs: list[tuple[str, str]] = []

    for qs in normalized:
        if not qs.endswith("_questions"):
            continue
        if qs.endswith("_mutant_questions"):
            continue
        mutant = qs[: -len("_questions")] + "_mutant_questions"
        if mutant in available:
            pairs.append((qs, mutant))

    return pairs


def build_llm_marker_map(llm_models: list[str]) -> dict[str, str]:
    """
    Assign one stable marker to each llmModel.

    Known families get preferred markers first:
    - GPT/OpenAI -> circle
    - MiniMax -> downward triangle
    - Qwen -> square
    - Gemini/Google -> diamond

    Remaining models get the next free marker from the marker pool.
    """
    marker_map: dict[str, str] = {}
    used: set[str] = set()

    def preferred_markers(model_name: str) -> list[str]:
        name = normalize_text(model_name)
        prefs: list[str] = []
        if "gpt" in name or "openai" in name:
            prefs.append("o")
        if "minimax" in name:
            prefs.append("v")
        if "qwen" in name:
            prefs.append("s")
        if "gemini" in name or "google" in name:
            prefs.append("D")
        return prefs

    for model_name in llm_models:
        assigned = None
        for marker in preferred_markers(model_name):
            if marker not in used:
                assigned = marker
                break
        if assigned is None:
            for marker in MODEL_MARKER_POOL:
                if marker not in used:
                    assigned = marker
                    break
        if assigned is None:
            assigned = "o"
        marker_map[model_name] = assigned
        used.add(assigned)

    return marker_map


def plot_bar_charts(
    agg_df: pd.DataFrame,
    metrics: list[str],
    selected_llm_models: list[str],
    selected_dataset_kinds: list[str],
    selected_category_keys: list[str] | None,
    category_infos_by_dataset: dict[str, list[dict[str, Any]]],
    category_color_map: dict[str, str],
    category_display_lookup: dict[str, str],
    filter_suffix: str,
    out_dir: Path,
) -> None:
    """Generate one grouped bar chart per metric."""
    for metric in metrics:
        metric_df = agg_df[agg_df["metric"] == metric].copy()
        if metric_df.empty:
            continue

        # Fast lookup for the average value of one exact bar.
        value_lookup = {
            (row["llmModel"], row["datasetKind"], row["categoryKey"]): float(row["avgValue"])
            for _, row in metric_df.iterrows()
        }

        # Data collected for the actual matplotlib call.
        bar_positions: list[float] = []
        bar_values: list[float] = []
        bar_colors: list[str] = []
        bar_category_keys: list[str] = []

        # Extra label helper structures.
        dataset_centers: list[tuple[float, str]] = []
        model_centers: list[tuple[float, str]] = []
        model_boundaries: list[tuple[float, float]] = []

        current_x = 0.0

        # Build bars in the requested visual order:
        # llmModel -> datasetKind -> category.
        for llm_model in selected_llm_models:
            model_block_left: float | None = None
            model_block_right: float | None = None

            for dataset_name in selected_dataset_kinds:
                categories = category_infos_by_dataset.get(dataset_name, [])

                # Keep only categories that are allowed by the optional category filter.
                visible_categories = [
                    info
                    for info in categories
                    if selected_category_keys is None or info["key"] in selected_category_keys
                ]

                # If this dataset has no visible categories at all, skip it.
                if not visible_categories:
                    continue

                # Keep only categories that actually have a bar for the current
                # llmModel + datasetKind + category combination.
                plotted_categories = [
                    info
                    for info in visible_categories
                    if (llm_model, dataset_name, info["key"]) in value_lookup
                ]

                # If nothing is plotted for this dataset in the current model block,
                # skip the dataset box entirely.
                if not plotted_categories:
                    continue

                # Reserve a logical dataset box width based on all visible categories,
                # not only on the categories that happen to have values.
                # This allows the plotted bars to be centered within the dataset box.
                dataset_start_x = current_x
                dataset_slot_count = len(visible_categories)

                dataset_block_left = dataset_start_x
                dataset_block_right = dataset_start_x + (dataset_slot_count - 1) * BAR_STEP
                dataset_block_center = (dataset_block_left + dataset_block_right) / 2.0

                # Compute the width actually occupied by the plotted bars and place them
                # symmetrically inside the reserved dataset box.
                plotted_span = (len(plotted_categories) - 1) * BAR_STEP
                full_span = (dataset_slot_count - 1) * BAR_STEP
                left_offset = (full_span - plotted_span) / 2.0

                x = dataset_start_x + left_offset

                for info in plotted_categories:
                    lookup_key = (llm_model, dataset_name, info["key"])
                    avg_value = value_lookup[lookup_key]

                    bar_positions.append(x)
                    bar_values.append(avg_value)
                    bar_colors.append(category_color_map[info["key"]])
                    bar_category_keys.append(info["key"])

                    x += BAR_STEP

                dataset_centers.append((dataset_block_center, dataset_name))

                if model_block_left is None:
                    model_block_left = dataset_block_left
                model_block_right = dataset_block_right

                # Move to the next dataset box.
                current_x = dataset_start_x + dataset_slot_count * BAR_STEP + DATASET_GAP

            # Use full model block boundaries instead of only actual bar positions.
            if model_block_left is not None and model_block_right is not None:
                model_centers.append(((model_block_left + model_block_right) / 2.0, llm_model))
                model_boundaries.append((model_block_left, model_block_right))
                current_x += MODEL_GAP

        if not bar_positions:
            continue

        chart_title = METRIC_DISPLAY_NAMES.get(metric, metric)
        fig_width = max(12, len(bar_positions) * 0.65 + 4)
        fig, ax = plt.subplots(figsize=(fig_width, 7))

        # Draw the bars.
        ax.bar(bar_positions, bar_values, color=bar_colors, width=BAR_WIDTH)

        # Main chart labels.
        ax.set_title(chart_title, pad=28)
        ax.set_ylabel("Average score")

        # Hide category labels on the x-axis.
        # Categories are represented by color and legend only.
        ax.set_xticks(bar_positions)
        ax.set_xticklabels([""] * len(bar_positions))
        ax.tick_params(axis="x", length=0)

        # Use fixed y-limits where explicitly defined.
        if metric in METRIC_Y_LIMITS:
            ax.set_ylim(*METRIC_Y_LIMITS[metric])
        else:
            ax.set_ylim(bottom=0)

        # Dataset labels are printed below the bars, between the title and the plot area.
        for center, dataset_name in dataset_centers:
            ax.text(
                center,
                1.02,
                dataset_name,
                ha="center",
                va="bottom",
                transform=ax.get_xaxis_transform(),
                fontsize=10,
            )

        # Model labels are printed below the bars.
        for center, llm_model in model_centers:
            ax.text(
                center,
                -0.18,
                llm_model,
                ha="center",
                va="top",
                transform=ax.get_xaxis_transform(),
                fontsize=8,
                fontweight="bold",
            )

        # Draw dashed separators between llmModel groups.
        for idx in range(len(model_boundaries) - 1):
            left_end = model_boundaries[idx][1]
            right_start = model_boundaries[idx + 1][0]
            separator_x = (left_end + right_start) / 2
            ax.axvline(separator_x, linestyle="--", linewidth=1)

        # Build a legend for the categories that are actually present on the current chart.
        legend_handles: list[Patch] = []
        seen_legend: set[str] = set()
        for category_key in bar_category_keys:
            if category_key in seen_legend:
                continue
            seen_legend.add(category_key)
            legend_handles.append(
                Patch(
                    label=category_display_lookup[category_key],
                    facecolor=category_color_map[category_key],
                )
            )

        if legend_handles:
            ax.legend(
                handles=legend_handles,
                title="Question category",
                loc="upper left",
                bbox_to_anchor=(1.01, 1.0),
                borderaxespad=0,
            )

        # Leave enough room for the extra dataset/model labels and the legend.
        plt.subplots_adjust(top=0.82, bottom=0.24, right=0.78)

        # Save one PNG per metric.
        out_name = slugify(chart_title) + filter_suffix + ".png"
        plt.savefig(out_dir / out_name, dpi=200, bbox_inches="tight")
        plt.close(fig)

        print(f"Saved: {out_dir / out_name}")

def build_scatter_frame_all_datasets(
    df: pd.DataFrame,
    metric: str,
) -> pd.DataFrame:
    """
    Build one combined scatter frame across all detected original-vs-mutant
    question-set pairs together.

    One point = one config:
        llmModel + categoryKey

    X axis:
        average metric value on original question sets

    Y axis:
        average metric value on mutant question sets
    """
    if "questionSet" not in df.columns:
        raise ValueError("Scatter plots require the 'questionSet' column in metrics_results.csv.")

    available_question_sets = sorted(df["questionSet"].dropna().astype(str).unique())
    question_set_pairs = infer_question_set_pairs(available_question_sets)

    if not question_set_pairs:
        return pd.DataFrame()

    original_sets = sorted({orig for orig, _ in question_set_pairs})
    mutant_sets = sorted({mut for _, mut in question_set_pairs})

    metric_df = df[df["metric"] == metric].copy()
    if metric_df.empty:
        return pd.DataFrame()

    original_df = (
        metric_df[metric_df["questionSet"].isin(original_sets)]
        .groupby(["llmModel", "categoryKey"], as_index=False)["value"]
        .mean()
        .rename(columns={"value": "xValue"})
    )

    mutant_df = (
        metric_df[metric_df["questionSet"].isin(mutant_sets)]
        .groupby(["llmModel", "categoryKey"], as_index=False)["value"]
        .mean()
        .rename(columns={"value": "yValue"})
    )

    paired_df = original_df.merge(
        mutant_df,
        on=["llmModel", "categoryKey"],
        how="inner",
    )

    return paired_df

def plot_scatter_charts(
    df: pd.DataFrame,
    metrics: list[str],
    selected_llm_models: list[str],
    category_color_map: dict[str, str],
    category_display_lookup: dict[str, str],
    filter_suffix: str,
    out_dir: Path,
) -> None:
    """Generate original-vs-mutant scatter plots for each metric and question-set pair."""
    if "questionSet" not in df.columns:
        raise ValueError(
            "Scatter plots require the 'questionSet' column in metrics_results.csv."
        )

    available_question_sets = sorted(df["questionSet"].dropna().astype(str).unique())
    question_set_pairs = infer_question_set_pairs(available_question_sets)

    if not question_set_pairs:
        print("Warning: no original-vs-mutant question-set pairs were detected. No scatter plots were generated.")
        return

    marker_map = build_llm_marker_map(selected_llm_models)

    # Use only the columns needed for point pairing.
    scatter_df = df.copy()
    scatter_df["questionSet"] = scatter_df["questionSet"].astype(str)

    for metric in metrics:
        metric_df = scatter_df[scatter_df["metric"] == metric].copy()
        if metric_df.empty:
            continue

        for original_qs, mutant_qs in question_set_pairs:
            original_df = (
                metric_df[metric_df["questionSet"] == original_qs]
                .groupby(["llmModel", "categoryKey"], as_index=False)["value"]
                .mean()
                .rename(columns={"value": "xValue"})
            )

            mutant_df = (
                metric_df[metric_df["questionSet"] == mutant_qs]
                .groupby(["llmModel", "categoryKey"], as_index=False)["value"]
                .mean()
                .rename(columns={"value": "yValue"})
            )

            paired_df = original_df.merge(
                mutant_df,
                on=["llmModel", "categoryKey"],
                how="inner",
            )

            if paired_df.empty:
                continue

            chart_title = METRIC_DISPLAY_NAMES.get(metric, metric)
            pair_title = f"{original_qs} vs {mutant_qs}"
            fig, ax = plt.subplots(figsize=(16, 8))

            # Draw one scatter layer per llmModel so each model can keep its own marker.
            for llm_model in selected_llm_models:
                model_points = paired_df[paired_df["llmModel"] == llm_model].copy()
                if model_points.empty:
                    continue

                point_colors = [category_color_map[key] for key in model_points["categoryKey"]]
                ax.scatter(
                    model_points["xValue"],
                    model_points["yValue"],
                    c=point_colors,
                    marker=marker_map[llm_model],
                    s=70,
                    alpha=0.85,
                    edgecolors="black",
                    linewidths=0.5,
                )

            # Keep both axes on the same scale where possible.
            if metric in METRIC_Y_LIMITS:
                low, high = METRIC_Y_LIMITS[metric]
                ax.set_xlim(low, high)
                ax.set_ylim(low, high)
                diag_low, diag_high = low, high
            else:
                min_value = min(paired_df["xValue"].min(), paired_df["yValue"].min())
                max_value = max(paired_df["xValue"].max(), paired_df["yValue"].max())
                padding = (max_value - min_value) * 0.05 if max_value > min_value else 0.05
                ax.set_xlim(min_value - padding, max_value + padding)
                ax.set_ylim(min_value - padding, max_value + padding)
                diag_low, diag_high = min_value - padding, max_value + padding

            # Reference diagonal where original == mutant.
            ax.plot([diag_low, diag_high], [diag_low, diag_high], linestyle="--", linewidth=1)

            ax.set_xlabel(f"Original ({original_qs})")
            ax.set_ylabel(f"Mutant ({mutant_qs})")

            # Build category legend using the categories that actually appear on this plot.
            category_handles: list[Patch] = []
            seen_categories: set[str] = set()
            for category_key in paired_df["categoryKey"].astype(str).tolist():
                if category_key in seen_categories:
                    continue
                seen_categories.add(category_key)
                category_handles.append(
                    Patch(
                        label=break_before_third_word(category_display_lookup[category_key]),
                        facecolor=category_color_map[category_key],
                    )
                )

            # Build a separate legend for llmModel markers.
            model_handles: list[Line2D] = []
            for llm_model in selected_llm_models:
                if llm_model not in paired_df["llmModel"].astype(str).unique():
                    continue
                model_handles.append(
                    Line2D(
                        [0],
                        [0],
                        marker=marker_map[llm_model],
                        color="none",
                        label=llm_model,
                        markerfacecolor="white",
                        markeredgecolor="black",
                        markersize=9,
                    )
                )

            if category_handles:
                category_legend = ax.legend(
                    handles=category_handles,
                    title="Question category",
                    loc="upper left",
                    bbox_to_anchor=(1.01, 1.0),
                    borderaxespad=0,
                    fontsize=10,
                    title_fontsize=11,
                    labelspacing=0.45,
                    borderpad=0.5,
                )
                ax.add_artist(category_legend)

            if model_handles:
                ax.legend(
                    handles=model_handles,
                    title="LLM model",
                    loc="lower left",
                    bbox_to_anchor=(1.01, 0.0),
                    borderaxespad=0,
                    fontsize=11,
                    title_fontsize=12,
                )

            plt.subplots_adjust(right=0.72)

            out_name = (
                slugify(chart_title)
                + "__"
                + slugify(original_qs)
                + "_vs_"
                + slugify(mutant_qs)
                + filter_suffix
                + ".png"
            )
            plt.savefig(out_dir / out_name, dpi=200, bbox_inches="tight")
            plt.close(fig)

            print(f"Saved: {out_dir / out_name}")
        # ------------------------------------------------------------------
    # Extra combined scatter across all selected datasets together.
    # ------------------------------------------------------------------
    for metric in metrics:
        paired_df = build_scatter_frame_all_datasets(df=df, metric=metric)

        if paired_df.empty:
            continue

        chart_title = METRIC_DISPLAY_NAMES.get(metric, metric)
        fig, ax = plt.subplots(figsize=(11, 6.2))

        for llm_model in selected_llm_models:
            model_points = paired_df[paired_df["llmModel"] == llm_model].copy()
            if model_points.empty:
                continue

            point_colors = [category_color_map[key] for key in model_points["categoryKey"]]
            ax.scatter(
                model_points["xValue"],
                model_points["yValue"],
                c=point_colors,
                marker=marker_map[llm_model],
                s=130,
                alpha=0.85,
                edgecolors="black",
                linewidths=0.8,
            )

        if metric in METRIC_Y_LIMITS:
            low, high = METRIC_Y_LIMITS[metric]
            ax.set_xlim(low, high)
            ax.set_ylim(low, high)
            diag_low, diag_high = low, high
        else:
            min_value = min(paired_df["xValue"].min(), paired_df["yValue"].min())
            max_value = max(paired_df["xValue"].max(), paired_df["yValue"].max())
            padding = (max_value - min_value) * 0.05 if max_value > min_value else 0.05
            ax.set_xlim(min_value - padding, max_value + padding)
            ax.set_ylim(min_value - padding, max_value + padding)
            diag_low, diag_high = min_value - padding, max_value + padding

        ax.plot([diag_low, diag_high], [diag_low, diag_high], linestyle="--", linewidth=1)

        ax.set_xlabel("Original", fontsize=13)
        ax.set_ylabel("Mutant", fontsize=13)
        ax.tick_params(axis="both", labelsize=12)

        category_handles: list[Patch] = []
        seen_categories: set[str] = set()
        for category_key in paired_df["categoryKey"].astype(str).tolist():
            if category_key in seen_categories:
                continue
            seen_categories.add(category_key)
            category_handles.append(
                Patch(
                    label=break_before_third_word(category_display_lookup[category_key]),
                    facecolor=category_color_map[category_key],
                )
            )

        model_handles: list[Line2D] = []
        for llm_model in selected_llm_models:
            if llm_model not in paired_df["llmModel"].astype(str).unique():
                continue
            model_handles.append(
                Line2D(
                    [0],
                    [0],
                    marker=marker_map[llm_model],
                    color="none",
                    label=llm_model,
                    markerfacecolor="white",
                    markeredgecolor="black",
                    markersize=9,
                )
            )

        if category_handles:
            category_legend = ax.legend(
                handles=category_handles,
                title="Question category",
                loc="upper left",
                bbox_to_anchor=(1.01, 1.0),
                borderaxespad=0,
                fontsize=10,
                title_fontsize=11,
                labelspacing=0.45,
                borderpad=0.5,
            )
            ax.add_artist(category_legend)

        if model_handles:
            ax.legend(
                handles=model_handles,
                title="LLM model",
                loc="lower left",
                bbox_to_anchor=(1.01, 0.0),
                borderaxespad=0,
                fontsize=11,
                title_fontsize=12,
            )

        plt.subplots_adjust(right=0.72)

        out_name = slugify(chart_title) + "__all_selected_datasets" + filter_suffix + ".png"
        plt.savefig(out_dir / out_name, dpi=200, bbox_inches="tight")
        plt.close(fig)

        print(f"Saved: {out_dir / out_name}")


# if only orig
"""
    Build one config-level wide table for a single original-vs-mutant question-set pair.

    One row = one config:
        llmModel + categoryKey

    One column = one metric, using ONLY the original question set.

    Important assumption:
        We assume question-set pairs follow:
            <name>_questions -> <name>_mutant_questions
"""
"""
def build_matrix_frame_for_pair(
    df: pd.DataFrame,
    metrics: list[str],
    original_qs: str,
    mutant_qs: str,
) -> pd.DataFrame:
    
    pair_df = df[
        (df["questionSet"] == original_qs)
        & (df["metric"].isin(metrics))
    ].copy()

    if pair_df.empty:
        return pd.DataFrame()

    grouped = (
        pair_df.groupby(["llmModel", "categoryKey", "metric"], as_index=False)["value"]
        .mean()
    )

    wide = grouped.pivot_table(
        index=["llmModel", "categoryKey"],
        columns="metric",
        values="value",
        aggfunc="mean",
    )

    return wide.reset_index()
"""

# if only mutant
"""
    Build one config-level wide table for a single original-vs-mutant question-set pair.

    One row = one config:
        llmModel + categoryKey

    One column = one metric, using ONLY the mutant question set.

    Important assumption:
        We assume question-set pairs follow:
            <name>_questions -> <name>_mutant_questions
"""
"""
def build_matrix_frame_for_pair(
    df: pd.DataFrame,
    metrics: list[str],
    original_qs: str,
    mutant_qs: str,
) -> pd.DataFrame:
    pair_df = df[
        (df["questionSet"] == mutant_qs)
        & (df["metric"].isin(metrics))
    ].copy()

    if pair_df.empty:
        return pd.DataFrame()

    grouped = (
        pair_df.groupby(["llmModel", "categoryKey", "metric"], as_index=False)["value"]
        .mean()
    )

    wide = grouped.pivot_table(
        index=["llmModel", "categoryKey"],
        columns="metric",
        values="value",
        aggfunc="mean",
    )

    return wide.reset_index()
"""


# if orig + mutant
"""
    Build one config-level wide table for a single original-vs-mutant question-set pair.

    One row = one config:
        llmModel + categoryKey

    One column = one metric, using the average of original + mutant question sets.
"""

def build_matrix_frame_for_pair(
    df: pd.DataFrame,
    metrics: list[str],
    original_qs: str,
    mutant_qs: str,
) -> pd.DataFrame:
    
    pair_df = df[
        (df["questionSet"].isin([original_qs, mutant_qs]))
        & (df["metric"].isin(metrics))
    ].copy()

    if pair_df.empty:
        return pd.DataFrame()

    grouped = (
        pair_df.groupby(["llmModel", "categoryKey", "metric"], as_index=False)["value"]
        .mean()
    )

    wide = grouped.pivot_table(
        index=["llmModel", "categoryKey"],
        columns="metric",
        values="value",
        aggfunc="mean",
    )

    return wide.reset_index()


def select_question_sets_from_pairs(
    question_set_pairs: list[tuple[str, str]],
    question_set_mode: str,
) -> list[str]:
    """
    Select question sets from detected original-vs-mutant pairs.

    question_set_mode:
        - "orig"         -> only original question sets
        - "mutant"       -> only mutant question sets
        - "orig+mutant"  -> both
    """
    if question_set_mode not in {"orig", "mutant", "orig+mutant"}:
        raise ValueError(
            "Invalid question_set_mode. Allowed values: 'orig', 'mutant', 'orig+mutant'."
        )

    if question_set_mode == "orig":
        selected_question_sets = [orig for orig, _ in question_set_pairs]
    elif question_set_mode == "mutant":
        selected_question_sets = [mut for _, mut in question_set_pairs]
    else:
        selected_question_sets = [
            qs
            for orig, mut in question_set_pairs
            for qs in (orig, mut)
        ]

    return sorted(set(selected_question_sets))

def build_heatmap_frame_for_dataset(
    df: pd.DataFrame,
    metrics: list[str],
    selected_llm_models: list[str],
    dataset_name: str,
    question_set_mode: str,
) -> pd.DataFrame:
    """
    Build one heatmap table for a single dataset.

    Rows:
        metrics

    Columns:
        llmModel values

    Cell value:
        average metric score for the given dataset + question-set mode +
        llmModel + metric, averaged across all matching rows.
    """
    if "questionSet" not in df.columns:
        raise ValueError("Heatmap plots require the 'questionSet' column in metrics_results.csv.")

    dataset_df = df[df["datasetKind"] == dataset_name].copy()
    if dataset_df.empty:
        return pd.DataFrame()

    available_question_sets = sorted(dataset_df["questionSet"].dropna().astype(str).unique())
    question_set_pairs = infer_question_set_pairs(available_question_sets)

    if not question_set_pairs:
        return pd.DataFrame()

    selected_question_sets = select_question_sets_from_pairs(
        question_set_pairs=question_set_pairs,
        question_set_mode=question_set_mode,
    )

    heat_df = dataset_df[
        (dataset_df["questionSet"].isin(selected_question_sets))
        & (dataset_df["metric"].isin(metrics))
        & (dataset_df["llmModel"].isin(selected_llm_models))
    ].copy()

    if heat_df.empty:
        return pd.DataFrame()

    grouped = (
        heat_df.groupby(["metric", "llmModel"], as_index=False)["value"]
        .mean()
    )

    wide = grouped.pivot_table(
        index="metric",
        columns="llmModel",
        values="value",
        aggfunc="mean",
    )

    metric_order = [metric for metric in metrics if metric in wide.index]
    wide = wide.reindex(index=metric_order, columns=selected_llm_models)

    return wide

def normalize_heatmap_rows(wide: pd.DataFrame) -> pd.DataFrame:
    norm = wide.copy().astype(float)

    for metric in norm.index:
        row = pd.to_numeric(norm.loc[metric], errors="coerce")
        row_min = row.min()
        row_max = row.max()

        if pd.isna(row_min) or pd.isna(row_max) or row_max <= row_min:
            norm.loc[metric] = 0.5
        else:
            norm.loc[metric] = (row - row_min) / (row_max - row_min)

    return norm.clip(0, 1)

def normalize_heatmap_columns(wide: pd.DataFrame) -> pd.DataFrame:
    """
    Normalize each heatmap column independently to the [0, 1] range.

    Use this when the displayed heatmap layout is:
        rows = LLMs
        columns = metrics

    This makes colors comparable only within the same metric column.
    """
    norm = wide.copy().astype(float)

    for metric in norm.columns:
        col = pd.to_numeric(norm[metric], errors="coerce")

        col_min = col.min()
        col_max = col.max()

        if pd.isna(col_min) or pd.isna(col_max) or col_max <= col_min:
            norm[metric] = 0.5
        else:
            norm[metric] = (col - col_min) / (col_max - col_min)

    return norm.clip(0, 1)

def normalize_heatmap_by_metric(wide: pd.DataFrame) -> pd.DataFrame:
    """
    Normalize heatmap values row-wise (metric-wise), so each metric uses its own scale.

    Priority:
    1) If the metric has a fixed range in METRIC_Y_LIMITS, use that.
    2) Otherwise, fall back to row-wise min-max normalization.

    Output values are clipped to [0, 1].
    """
    norm = wide.copy().astype(float)

    for metric in norm.index:
        row = pd.to_numeric(norm.loc[metric], errors="coerce")

        if metric in METRIC_Y_LIMITS:
            low, high = METRIC_Y_LIMITS[metric]
            span = high - low
            if span <= 0:
                norm.loc[metric] = 0.5
            else:
                norm.loc[metric] = (row - low) / span
        else:
            row_min = row.min()
            row_max = row.max()

            if pd.isna(row_min) or pd.isna(row_max) or row_max <= row_min:
                norm.loc[metric] = 0.5
            else:
                norm.loc[metric] = (row - row_min) / (row_max - row_min)

    return norm.clip(0, 1)

def build_matrix_frame_all_datasets(
    df: pd.DataFrame,
    metrics: list[str],
    question_set_pairs: list[tuple[str, str]],
    question_set_mode: str = "orig+mutant",
) -> pd.DataFrame:
    """
    Build one config-level wide table across all detected original-vs-mutant
    question-set pairs together.

    One row = one config:
        llmModel + categoryKey

    One column = one metric.

    question_set_mode:
        - "orig"         -> use only original question sets
        - "mutant"       -> use only mutant question sets
        - "orig+mutant"  -> use both and average together
    """
    if question_set_mode not in {"orig", "mutant", "orig+mutant"}:
        raise ValueError(
            "Invalid question_set_mode. Allowed values: 'orig', 'mutant', 'orig+mutant'."
        )

    if question_set_mode == "orig":
        selected_question_sets = [orig for orig, _ in question_set_pairs]
    elif question_set_mode == "mutant":
        selected_question_sets = [mut for _, mut in question_set_pairs]
    else:
        selected_question_sets = [
            qs
            for orig, mut in question_set_pairs
            for qs in (orig, mut)
        ]

    selected_question_sets = sorted(set(selected_question_sets))

    pair_df = df[
        (df["questionSet"].isin(selected_question_sets))
        & (df["metric"].isin(metrics))
    ].copy()

    if pair_df.empty:
        return pd.DataFrame()

    grouped = (
        pair_df.groupby(["llmModel", "categoryKey", "metric"], as_index=False)["value"]
        .mean()
    )

    wide = grouped.pivot_table(
        index=["llmModel", "categoryKey"],
        columns="metric",
        values="value",
        aggfunc="mean",
    )

    return wide.reset_index()
    
def plot_matrix_charts(
    df: pd.DataFrame,
    metrics: list[str],
    selected_llm_models: list[str],
    category_color_map: dict[str, str],
    category_display_lookup: dict[str, str],
    filter_suffix: str,
    out_dir: Path,
) -> None:
    """
    Generate scatter-plot matrices based on rank positions of config-level averages.

    One point = one config:
        llmModel + categoryKey

    Color:
        question category

    Marker:
        llmModel

    Outer axes:
        metric1/orig ... metricN/orig ... metric1/mutant ... metricN/mutant

    Ranking logic:
        We do not correlate the raw metric values directly.
        Instead, we rank the config-level averages and scatter the rank positions.
    """
    if "questionSet" not in df.columns:
        raise ValueError("Matrix plots require the 'questionSet' column in metrics_results.csv.")

    available_question_sets = sorted(df["questionSet"].dropna().astype(str).unique())
    question_set_pairs = infer_question_set_pairs(available_question_sets)

    if not question_set_pairs:
        print("Warning: no original-vs-mutant question-set pairs were detected. No matrix plots were generated.")
        return

    marker_map = build_llm_marker_map(selected_llm_models)

    for original_qs, mutant_qs in question_set_pairs:
        wide = build_matrix_frame_for_pair(
            df=df,
            metrics=metrics,
            original_qs=original_qs,
            mutant_qs=mutant_qs,
        )

        if wide.empty:
            continue

        metric_vars = [metric for metric in metrics if metric in wide.columns]
        if not metric_vars:
            continue

        plot_df = wide.copy()


        n = len(metric_vars)
        fig, axes = plt.subplots(n, n, figsize=(2.6 * n + 4, 2.6 * n + 2))

        if n == 1:
            axes = [[axes]]

        for row_idx, y_var in enumerate(metric_vars):
            for col_idx, x_var in enumerate(metric_vars):
                ax = axes[row_idx][col_idx] if n == 1 else axes[row_idx, col_idx]

                # Diagonal: show only the metric name.
                if row_idx == col_idx:
                    ax.text(
                        0.5,
                        0.5,
                        METRIC_DISPLAY_NAMES.get(x_var, x_var),
                        ha="center",
                        va="center",
                        transform=ax.transAxes,
                        fontsize=30,
                        fontweight="bold",
                    )
                    ax.set_xticks([])
                    ax.set_yticks([])
                    continue

                cell_df = plot_df[["llmModel", "categoryKey", x_var, y_var]].dropna().copy()

                # Upper triangle: scatter plot.
                if row_idx < col_idx:
                    for _, row in cell_df.iterrows():
                        llm_model = str(row["llmModel"])
                        category_key = str(row["categoryKey"])

                        ax.scatter(
                            row[x_var],
                            row[y_var],
                            c=category_color_map[category_key],
                            marker=marker_map[llm_model],
                            s=30,
                            alpha=0.85,
                            edgecolors="black",
                            linewidths=0.4,
                        )

                    # Optional diagonal reference line
                    x_min = cell_df[x_var].min()
                    x_max = cell_df[x_var].max()
                    y_min = cell_df[y_var].min()
                    y_max = cell_df[y_var].max()
                    lo = min(x_min, y_min)
                    hi = max(x_max, y_max)
                    ax.plot([lo, hi], [lo, hi], linestyle="--", linewidth=0.6, alpha=0.3)

                # Lower triangle: Spearman rank correlation coefficient only.
                else:
                    if len(cell_df) >= 2:
                        rho = cell_df[[x_var, y_var]].corr(method="spearman").iloc[0, 1]
                        txt = f"{rho:.2f}"
                    else:
                        txt = "n/a"

                    ax.text(
                        0.5,
                        0.5,
                        txt,
                        ha="center",
                        va="center",
                        transform=ax.transAxes,
                        fontsize=20,
                        fontweight="bold",
                    )
                    ax.set_xticks([])
                    ax.set_yticks([])

                if row_idx < n - 1:
                    ax.set_xticklabels([])
                if col_idx > 0:
                    ax.set_yticklabels([])

                if row_idx == n - 1:
                    ax.set_xlabel(METRIC_DISPLAY_NAMES.get(x_var, x_var), fontsize=10)
                if col_idx == 0:
                    ax.set_ylabel(METRIC_DISPLAY_NAMES.get(y_var, y_var), fontsize=10)

        # Build category legend from used categories.
        category_handles: list[Patch] = []
        seen_categories: set[str] = set()
        for key in plot_df["categoryKey"].astype(str).tolist():
            if key in seen_categories:
                continue
            seen_categories.add(key)
            category_handles.append(
                Patch(
                    label=format_category_legend_label(category_display_lookup[key]),
                    facecolor=category_color_map[key],
                )
            )

        # Build model legend from used LLMs.
        model_handles: list[Line2D] = []
        used_models = set(plot_df["llmModel"].astype(str).tolist())

        for llm_model in selected_llm_models:
            if llm_model not in used_models:
                continue
            model_handles.append(
                Line2D(
                    [0],
                    [0],
                    marker=marker_map[llm_model],
                    color="none",
                    label=llm_model,
                    markerfacecolor="white",
                    markeredgecolor="black",
                    markersize=7,
                )
            )

        if category_handles:
            category_legend = fig.legend(
                handles=category_handles,
                title="Question category",
                loc="lower left",
                bbox_to_anchor=(0.02, 0.035),
                borderaxespad=0,
                ncol=3,
                fontsize=11,
                title_fontsize=12,
                columnspacing=1.6,
                handletextpad=0.6,
                labelspacing=0.8,
                frameon=True,
            )
            fig.add_artist(category_legend)

        if model_handles:
            fig.legend(
                handles=model_handles,
                title="LLM model",
                loc="lower right",
                bbox_to_anchor=(0.98, 0.035),
                borderaxespad=0,
                ncol=2,
                fontsize=13,
                title_fontsize=12,
                columnspacing=1.6,
                handletextpad=0.6,
                labelspacing=0.8,
                frameon=True,
            )

        plt.subplots_adjust(
            left=0.06,
            right=0.98,
            top=0.94,
            bottom=0.10,
            wspace=0.10,
            hspace=0.10,
        )
        out_name = (
            f"matrix__{slugify(original_qs)}_vs_{slugify(mutant_qs)}{filter_suffix}.png"
        )
        plt.savefig(out_dir / out_name, dpi=200, bbox_inches="tight")
        plt.close(fig)

        print(f"Saved: {out_dir / out_name}")
    
    # ------------------------------------------------------------------
    # Extra combined matrix across all selected datasets together.
    # ------------------------------------------------------------------
    combined_wide = build_matrix_frame_all_datasets(
        df=df,
        metrics=metrics,
        question_set_pairs=question_set_pairs,
        question_set_mode="orig+mutant",   # "orig", "mutant" or "orig+mutant"
    )

    if not combined_wide.empty:
        metric_vars = [metric for metric in metrics if metric in combined_wide.columns]

        if metric_vars:
            plot_df = combined_wide.copy()

            n = len(metric_vars)
            fig, axes = plt.subplots(n, n, figsize=(2.6 * n + 4, 2.6 * n + 2))

            if n == 1:
                axes = [[axes]]

            for row_idx, y_var in enumerate(metric_vars):
                for col_idx, x_var in enumerate(metric_vars):
                    ax = axes[row_idx][col_idx] if n == 1 else axes[row_idx, col_idx]

                    if row_idx == col_idx:
                        ax.text(
                            0.5,
                            0.5,
                            METRIC_DISPLAY_NAMES.get(x_var, x_var),
                            ha="center",
                            va="center",
                            transform=ax.transAxes,
                            fontsize=30,
                            fontweight="bold",
                        )
                        ax.set_xticks([])
                        ax.set_yticks([])
                        continue

                    cell_df = plot_df[["llmModel", "categoryKey", x_var, y_var]].dropna().copy()

                    if row_idx < col_idx:
                        for _, row in cell_df.iterrows():
                            llm_model = str(row["llmModel"])
                            category_key = str(row["categoryKey"])

                            ax.scatter(
                                row[x_var],
                                row[y_var],
                                c=category_color_map[category_key],
                                marker=marker_map[llm_model],
                                s=90,
                                alpha=0.85,
                                edgecolors="black",
                                linewidths=0.8,
                            )

                        x_min = cell_df[x_var].min()
                        x_max = cell_df[x_var].max()
                        y_min = cell_df[y_var].min()
                        y_max = cell_df[y_var].max()
                        lo = min(x_min, y_min)
                        hi = max(x_max, y_max)
                        ax.plot([lo, hi], [lo, hi], linestyle="--", linewidth=0.6, alpha=0.3)

                    else:
                        if len(cell_df) >= 2:
                            rho = cell_df[[x_var, y_var]].corr(method="spearman").iloc[0, 1]
                            txt = f"{rho:.2f}"
                        else:
                            txt = "n/a"

                        ax.text(
                            0.5,
                            0.5,
                            txt,
                            ha="center",
                            va="center",
                            transform=ax.transAxes,
                            fontsize=28,
                            fontweight="bold",
                        )
                        ax.set_xticks([])
                        ax.set_yticks([])

                    if row_idx < n - 1:
                        ax.set_xticklabels([])
                    if col_idx > 0:
                        ax.set_yticklabels([])


            category_handles: list[Patch] = []
            seen_categories: set[str] = set()
            for key in plot_df["categoryKey"].astype(str).tolist():
                if key in seen_categories:
                    continue
                seen_categories.add(key)
                category_handles.append(
                    Patch(
                        label=format_category_legend_label(category_display_lookup[key]),
                        facecolor=category_color_map[key],
                    )
                )

            model_handles: list[Line2D] = []
            used_models = set(plot_df["llmModel"].astype(str).tolist())

            for llm_model in selected_llm_models:
                if llm_model not in used_models:
                    continue
                model_handles.append(
                    Line2D(
                        [0],
                        [0],
                        marker=marker_map[llm_model],
                        color="none",
                        label=llm_model,
                        markerfacecolor="white",
                        markeredgecolor="black",
                        markersize=7,
                    )
                )

            if category_handles:
                category_legend = fig.legend(
                    handles=category_handles,
                    title="Question category",
                    loc="lower left",
                    bbox_to_anchor=(0.02, 0.035),
                    borderaxespad=0,
                    ncol=3,
                    fontsize=11,
                    title_fontsize=12,
                    columnspacing=1.6,
                    handletextpad=0.6,
                    labelspacing=0.8,
                    frameon=True,
                )
                fig.add_artist(category_legend)

            if model_handles:
                fig.legend(
                    handles=model_handles,
                    title="LLM model",
                    loc="lower right",
                    bbox_to_anchor=(0.98, 0.035),
                    borderaxespad=0,
                    ncol=2,
                    fontsize=13,
                    title_fontsize=12,
                    columnspacing=1.6,
                    handletextpad=0.6,
                    labelspacing=0.8,
                    frameon=True,
                )


            plt.subplots_adjust(
                left=0.06,
                right=0.98,
                top=0.94,
                bottom=0.10,
                wspace=0.10,
                hspace=0.10,
            )

            out_name = f"matrix__all_selected_datasets{filter_suffix}.png"
            plt.savefig(out_dir / out_name, dpi=200, bbox_inches="tight")
            plt.close(fig)

            print(f"Saved: {out_dir / out_name}")

def plot_heatmap_charts(
    df: pd.DataFrame,
    metrics: list[str],
    selected_llm_models: list[str],
    selected_dataset_kinds: list[str],
    filter_suffix: str,
    out_dir: Path,
) -> None:
    """
    Generate one heatmap PNG per:
        datasetKind x question-set mode

    This produces separate files instead of one multi-panel grid.
    """
    if "questionSet" not in df.columns:
        raise ValueError("Heatmap plots require the 'questionSet' column in metrics_results.csv.")

    mode_specs = [
        ("orig+mutant", "all_questions"),
        ("orig", "original_only"),
        ("mutant", "mutant_only"),
    ]

    dataset_names = list(selected_dataset_kinds)
    if not dataset_names:
        print("Warning: no dataset kinds selected. No heatmap plots were generated.")
        return

    for dataset_name in dataset_names:
        for mode_key, mode_slug in mode_specs:
            wide = build_heatmap_frame_for_dataset(
                df=df,
                metrics=metrics,
                selected_llm_models=selected_llm_models,
                dataset_name=dataset_name,
                question_set_mode=mode_key,
            )

            if wide.empty:
                print(f"Warning: no heatmap data for dataset={dataset_name}, mode={mode_key}")
                continue

            # Keep metric-wise normalization on the original layout:
            #   rows = metrics, columns = llmModel
            row_normalized_wide = normalize_heatmap_rows(wide)

            # Then transpose only for display:
            display_raw = wide.T
            display_color = normalize_heatmap_columns(display_raw)

            raw_matrix = display_raw.values
            color_matrix = display_color.values

            fig, ax = plt.subplots(
                figsize=(1.15 * max(len(metrics), 2) + 3.2, 0.25 * max(len(selected_llm_models), 2) + 2.2),
            )

            ax.imshow(color_matrix, aspect="auto", vmin=0, vmax=1)

            # X axis = metrics
            x_labels = [METRIC_DISPLAY_NAMES.get(metric, metric) for metric in display_raw.columns]
            ax.set_xticks(range(len(display_raw.columns)))
            ax.set_xticklabels(x_labels, rotation=0, ha="center", fontsize=10)

            # Y axis = LLM models
            ax.set_yticks(range(len(display_raw.index)))
            ax.set_yticklabels(list(display_raw.index), fontsize=9)

            ax.tick_params(axis="x", pad=8)
            ax.tick_params(axis="y", pad=10)

            ax.tick_params(axis="x", pad=8)
            ax.tick_params(axis="y", pad=10)


            for y in range(raw_matrix.shape[0]):
                for x in range(raw_matrix.shape[1]):
                    raw_value = raw_matrix[y, x]
                    if pd.isna(raw_value):
                        continue
                    ax.text(
                        x,
                        y,
                        f"{raw_value:.2f}",
                        ha="center",
                        va="center",
                        fontsize=9,
                        fontweight="bold",
                    )

            plt.subplots_adjust(
                left=0.30,
                right=0.96,
                top=0.88,
                bottom=0.22,
            )

            out_name = f"heatmap__{slugify(dataset_name)}__{mode_slug}{filter_suffix}.png"
            plt.savefig(out_dir / out_name, dpi=200, bbox_inches="tight")
            plt.close(fig)

            print(f"Saved: {out_dir / out_name}")

def main() -> None:
    """Parse CLI arguments, build aggregates, and generate charts."""
    parser = argparse.ArgumentParser(
        description=(
            "Create grouped bar charts and/or original-vs-mutant scatter plots from metrics_results.csv. "
            "Bars are grouped by llmModel, then by datasetKind, and colored by question category. "
            "Scatter plots use the same fixed category colors and model-specific point markers."
        )
    )

    parser.add_argument(
        "summary_dir",
        help="Folder containing metrics_results.csv",
    )

    parser.add_argument(
        "--datasetkind",
        nargs="+",
        help="Optional datasetKind filter. You can pass multiple values.",
    )

    parser.add_argument(
        "--category",
        nargs="+",
        help=(
            "Optional category filter. You can pass multiple values. "
            "Matches category name, displayName, or datasetKind::category."
        ),
    )

    parser.add_argument(
        "--llm-model",
        nargs="+",
        dest="llm_models",
        help="Optional llmModel filter. You can pass multiple values.",
    )

    parser.add_argument(
        "--diagramtype",
        nargs="+",
        help="Optional diagram type filter. Allowed values: bar, scatter, matrix, heatmap. If omitted, all are generated.",
    )

    args = parser.parse_args()

    # Normalize optional filter arguments so both comma-separated and
    # space-separated forms are accepted.
    dataset_filters = flatten_cli_values(args.datasetkind)
    category_filters = flatten_cli_values(args.category)
    llm_filters = flatten_cli_values(args.llm_models)
    diagramtype_filters = flatten_cli_values(args.diagramtype)
    selected_diagram_types = resolve_diagram_types(diagramtype_filters)

    summary_dir = Path(args.summary_dir)
    metrics_csv = summary_dir / "metrics_results.csv"
    output_root, bar_dir, scatter_dir, matrix_dir, heatmap_dir = build_timestamped_output_dirs(summary_dir)

    if not metrics_csv.exists():
        raise FileNotFoundError(f"Missing CSV: {metrics_csv}")

    # Load the aggregated long-form CSV.
    df = pd.read_csv(metrics_csv)

    # Validate the minimal expected schema before doing anything else.
    missing_columns = sorted(REQUIRED_COLUMNS - set(df.columns))
    if missing_columns:
        raise ValueError(
            "metrics_results.csv is missing required column(s): " + ", ".join(missing_columns)
        )

    # Keep only valid rows:
    # - status must be OK
    # - value must be numeric
    df = df[df["status"].astype(str) == "OK"].copy()
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df[df["value"].notna()].copy()

    # Normalize fields that are used later for grouping and filtering.
    df["metric"] = df["metric"].astype(str) #.map(normalize_metric_name)
    df["questionId"] = df["questionId"].astype(str)
    df["datasetKind"] = df["datasetKind"].astype(str)
    df["llmModel"] = df["llmModel"].astype(str)
    if "questionSet" in df.columns:
        df["questionSet"] = df["questionSet"].astype(str)

    if df.empty:
        raise ValueError("No usable rows found in metrics_results.csv after filtering status/value.")

    # Build category metadata for every dataset seen in the CSV before applying
    # filters. This keeps category color assignment globally stable.
    all_dataset_kinds = sorted(df["datasetKind"].dropna().astype(str).unique())
    category_infos_by_dataset: dict[str, list[dict[str, Any]]] = {
        dataset_name: build_category_infos(dataset_name)
        for dataset_name in all_dataset_kinds
    }

    # Build reverse lookup: (datasetKind, questionId) -> category.
    question_to_category = build_question_to_category_map(category_infos_by_dataset)

    # Build stable category colors.
    category_color_map = build_global_color_map(category_infos_by_dataset, all_dataset_kinds)

    # Attach category information to every row.
    category_keys: list[str | None] = []
    category_display_names: list[str | None] = []
    uncategorized_count = 0

    for dataset_name, question_id in zip(df["datasetKind"], df["questionId"]):
        info = question_to_category.get((dataset_name, question_id))
        if info is None:
            category_keys.append(None)
            category_display_names.append(None)
            uncategorized_count += 1
        else:
            category_keys.append(info["key"])
            category_display_names.append(info["displayName"])

    df["categoryKey"] = category_keys
    df["categoryDisplayName"] = category_display_names

    if uncategorized_count:
        print(
            f"Warning: {uncategorized_count} row(s) could not be mapped to any category and will be ignored."
        )

    # Ignore rows that cannot be mapped to a known category.
    df = df[df["categoryKey"].notna()].copy()

    if df.empty:
        raise ValueError("No categorized rows remained after joining question categories.")

    # Apply dataset filter first.
    selected_dataset_kinds = resolve_dataset_order(df, dataset_filters)
    df = df[df["datasetKind"].isin(selected_dataset_kinds)].copy()

    if df.empty:
        raise ValueError("No rows remained after datasetKind filtering.")

    # Apply category filter second.
    selected_category_keys = resolve_category_keys(
        category_filters,
        category_infos_by_dataset,
        selected_dataset_kinds,
    )
    if selected_category_keys is not None:
        df = df[df["categoryKey"].isin(selected_category_keys)].copy()

    if df.empty:
        raise ValueError("No rows remained after category filtering.")

    # Apply LLM model filter last.
    selected_llm_models = resolve_llm_order(df, llm_filters)
    df = df[df["llmModel"].isin(selected_llm_models)].copy()

    if df.empty:
        raise ValueError("No rows remained after llmModel filtering.")

    # Aggregate exactly one value per:
    #   metric + llmModel + datasetKind + category
    agg_df = (
        df.groupby(["metric", "llmModel", "datasetKind", "categoryKey"], as_index=False)["value"]
        .mean()
        .rename(columns={"value": "avgValue"})
    )

    # Restore human-readable category display names for legend labels.
    category_display_lookup = {
        info["key"]: info["displayName"]
        for dataset_name in all_dataset_kinds
        for info in category_infos_by_dataset.get(dataset_name, [])
    }
    agg_df["categoryDisplayName"] = agg_df["categoryKey"].map(category_display_lookup)

    # Determine which metrics to plot and build a file-name suffix from filters.
    metrics = sorted(agg_df["metric"].dropna().astype(str).unique(), key=metric_sort_key)
    filter_suffix = build_filter_suffix(dataset_filters, category_filters, llm_filters)

    if "bar" in selected_diagram_types:
        plot_bar_charts(
            agg_df=agg_df,
            metrics=metrics,
            selected_llm_models=selected_llm_models,
            selected_dataset_kinds=selected_dataset_kinds,
            selected_category_keys=selected_category_keys,
            category_infos_by_dataset=category_infos_by_dataset,
            category_color_map=category_color_map,
            category_display_lookup=category_display_lookup,
            filter_suffix=filter_suffix,
            out_dir=bar_dir,
        )

    if "scatter" in selected_diagram_types:
        plot_scatter_charts(
            df=df,
            metrics=metrics,
            selected_llm_models=selected_llm_models,
            category_color_map=category_color_map,
            category_display_lookup=category_display_lookup,
            filter_suffix=filter_suffix,
            out_dir=scatter_dir,
        )

    if "matrix" in selected_diagram_types:
        plot_matrix_charts(
            df=df,
            metrics=metrics,
            selected_llm_models=selected_llm_models,
            category_color_map=category_color_map,
            category_display_lookup=category_display_lookup,
            filter_suffix=filter_suffix,
            out_dir=matrix_dir,
        )

    if "heatmap" in selected_diagram_types:
        plot_heatmap_charts(
            df=df,
            metrics=metrics,
            selected_llm_models=selected_llm_models,
            selected_dataset_kinds=selected_dataset_kinds,
            filter_suffix=filter_suffix,
            out_dir=heatmap_dir,
        )

    print(f"Output root: {output_root}")


if __name__ == "__main__":
    main()

#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------------------
# Build the aggregated SAP-SAM TTL model for the BPMN benchmark.
#
# This script is intended to live in:
#   converters/bpmn-to-kg/build_sap_sam_aggregated_ttl.sh
#
# Run it from the repository root like this:
#   bash converters/bpmn-to-kg/build_sap_sam_aggregated_ttl.sh
#
# Manual prerequisites (NOT done by this script):
#
# 1) Clone the BPMN input-models repository manually into:
#      input-models/bpmn-sol-llm-benchmark
#
#    Example:
#      pushd input-models/
#      git clone --branch DLT4BPM https://github.com/fstiehle/bpmn-sol-llm-benchmark.git
#      popd
#
# 2) Download the SAP-SAM Zenodo archive manually from:
#      https://zenodo.org/records/7012043
#    and unpack it into:
#      input-models/sap_sam_2022
#
# What this script does:
#
# Step 1:
#   Uses the BPMN models already present under:
#     input-models/bpmn-sol-llm-benchmark/data/sap-sam/
#
# Step 2:
#   Normalizes BPMN XML prefixes:
#     ns0:  ->  bpmn:
#   and writes the normalized files into:
#     input-models/bpmn-sol-llm-benchmark/data/sap-sam-normalized/
#
# Step 3:
#   Fixes malformed boolean attribute declarations in the normalized BPMN files
#   directly in-place in:
#     input-models/bpmn-sol-llm-benchmark/data/sap-sam-normalized/
#
# Step 4:
#   Builds the BPMN->TTL Docker image and converts every normalized .bpmn file
#   into a per-model .ttl file under:
#     input-models/bpmn-sol-llm-benchmark/data/bpmns_to_ttls_from_repo/
#
# Step 5:
#   Generates:
#     converters/bpmn-to-kg/sap-sam-orig-metadata.csv
#   from the manually downloaded Zenodo SAP-SAM metadata.
#
# Step 6:
#   Aggregates all per-model TTL files into one final merged TTL graph and
#   writes the outputs into:
#     model_databases/SAP-SAM/
#
# Final outputs:
#   model_databases/SAP-SAM/aggregated_model.ttl
#   model_databases/SAP-SAM/aggregated_model_skipped_models.csv
#   model_databases/SAP-SAM/aggregated_model_matched_models.csv
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# Resolve important absolute paths based on the script location.
#
# SCRIPT_DIR:
#   the folder where this script itself lives, expected to be:
#   converters/bpmn-to-kg
#
# REPO_ROOT:
#   the repository root, two levels above SCRIPT_DIR
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ------------------------------------------------------------------------------
# Allow overriding the Python executable from the environment if needed.
#
# Default:
#   python3
#
# Example custom usage:
#   PYTHON_BIN=python bash converters/bpmn-to-kg/build_sap_sam_aggregated_ttl.sh
# ------------------------------------------------------------------------------
PYTHON_BIN="${PYTHON_BIN:-python3}"

# ------------------------------------------------------------------------------
# Docker image name used for BPMN -> TTL conversion.
# ------------------------------------------------------------------------------
DOCKER_IMAGE="bpmn_to_kg"

# ------------------------------------------------------------------------------
# Input directories from the manually prepared sources.
#
# INPUT_MODELS_REPO:
#   manually cloned BPMN input-models repository
#
# SAP_SAM_DIR:
#   original BPMN files used for the benchmark
#
# SAP_SAM_ZENODO_DIR:
#   manually downloaded and unpacked SAP-SAM Zenodo archive
# ------------------------------------------------------------------------------
INPUT_MODELS_REPO="$REPO_ROOT/input-models/bpmn-sol-llm-benchmark"
INPUT_MODELS_DATA_DIR="$INPUT_MODELS_REPO/data"
SAP_SAM_DIR="$INPUT_MODELS_DATA_DIR/sap-sam"
SAP_SAM_ZENODO_DIR="$REPO_ROOT/input-models/sap_sam_2022"

# ------------------------------------------------------------------------------
# Intermediate directories created and used by this script.
#
# SAP_SAM_NORMALIZED_DIR:
#   normalized BPMN files after ns0: -> bpmn: rewriting
#
# TTL_DIR:
#   per-model TTL files created by the Docker-based converter
# ------------------------------------------------------------------------------
SAP_SAM_NORMALIZED_DIR="$INPUT_MODELS_DATA_DIR/sap-sam-normalized"
TTL_DIR="$INPUT_MODELS_DATA_DIR/bpmns_to_ttls_from_repo"

# ------------------------------------------------------------------------------
# Important input/output files used later in the pipeline.
#
# META_CSV:
#   metadata already present in the cloned input-models repo
#
# ORIG_META_CSV:
#   metadata CSV generated from the Zenodo download
#
# MODEL_IDS_FILE:
#   helper file used while generating ORIG_META_CSV
#
# OUTPUT_TTL:
#   final merged TTL output; the two CSV report files will be written next to it
# ------------------------------------------------------------------------------
META_CSV="$SAP_SAM_DIR/meta_data.csv"
ORIG_META_CSV="$SCRIPT_DIR/sap-sam-orig-metadata.csv"
MODEL_IDS_FILE="$SCRIPT_DIR/sol-model-ids.txt"
OUTPUT_TTL="$REPO_ROOT/model_databases/SAP-SAM/aggregated_model.ttl"

# ------------------------------------------------------------------------------
# Tiny inline Python snippet used during metadata CSV generation.
#
# The source Zenodo CSV files contain a column that we intentionally drop.
# This snippet:
#   - reads CSV rows from stdin
#   - removes column index 4 (the 5th column)
#   - writes the remaining columns to stdout
#
# This reproduces the behavior of the earlier standalone helper workflow.
# ------------------------------------------------------------------------------
CSV_SKIP_COL_CODE='import sys,csv;csv.field_size_limit(sys.maxsize);w=csv.writer(sys.stdout);[w.writerow(r[:4]+r[5:]) for r in csv.reader(sys.stdin)]'

# ------------------------------------------------------------------------------
# Helper: require that a command exists on PATH.
# ------------------------------------------------------------------------------
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $1" >&2
    exit 1
  }
}

# ------------------------------------------------------------------------------
# Helper: require that a file exists.
# ------------------------------------------------------------------------------
require_file() {
  [ -f "$1" ] || {
    echo "ERROR: required file not found: $1" >&2
    exit 1
  }
}

# ------------------------------------------------------------------------------
# Helper: require that a directory exists.
# ------------------------------------------------------------------------------
require_dir() {
  [ -d "$1" ] || {
    echo "ERROR: required directory not found: $1" >&2
    exit 1
  }
}

# ------------------------------------------------------------------------------
# Preliminary validation.
#
# We fail early if:
#   - essential shell tools are missing
#   - Python/rdflib is not available
#   - the manually prepared input folders are missing
#   - required scripts/files from this repo are missing
# ------------------------------------------------------------------------------
echo "[check] Validating environment..."

require_cmd "$PYTHON_BIN"
require_cmd docker
require_cmd grep
require_cmd sed
require_cmd cut
require_cmd sort
require_cmd head
require_cmd realpath

# rdflib is required by aggregate_ttls.py
"$PYTHON_BIN" -c "import rdflib" >/dev/null 2>&1 || {
  echo "ERROR: Python package 'rdflib' is required. Install it with: pip install rdflib" >&2
  exit 1
}

# Validate manually prepared inputs
require_dir "$INPUT_MODELS_REPO"
require_dir "$SAP_SAM_DIR"
require_dir "$SAP_SAM_ZENODO_DIR"
require_dir "$SAP_SAM_ZENODO_DIR/models"

require_file "$META_CSV"
require_file "$SAP_SAM_ZENODO_DIR/models/0.csv"

# Validate repo-local tooling
require_file "$SCRIPT_DIR/bpmn_preprocessing_scripts/normalize_ns0_to_bpmn.py"
require_file "$SCRIPT_DIR/bpmn_preprocessing_scripts/fix_isImmediate_isInterrupting.py"
require_file "$SCRIPT_DIR/aggregate_ttls.py"
require_file "$SCRIPT_DIR/Dockerfile"

# ------------------------------------------------------------------------------
# Ensure intermediate/output directories exist before starting.
#
# SAP_SAM_NORMALIZED_DIR:
#   created if missing before Step 2
#
# TTL_DIR:
#   created if missing before Step 4
#
# dirname "$OUTPUT_TTL":
#   ensures model_databases/SAP-SAM exists before Step 6
# ------------------------------------------------------------------------------
mkdir -p "$SAP_SAM_NORMALIZED_DIR"
mkdir -p "$TTL_DIR"
mkdir -p "$(dirname "$OUTPUT_TTL")"

# ------------------------------------------------------------------------------
# Step 2: normalize ns0: -> bpmn:
#
# The original BPMN input files may use the ns0 prefix for the BPMN namespace,
# while the BPMN->KG converter expects the bpmn prefix.
#
# Input:
#   input-models/bpmn-sol-llm-benchmark/data/sap-sam/
#
# Output:
#   input-models/bpmn-sol-llm-benchmark/data/sap-sam-normalized/
# ------------------------------------------------------------------------------
echo "[1/6] Normalizing ns0: -> bpmn: prefixes..."
"$PYTHON_BIN" "$SCRIPT_DIR/bpmn_preprocessing_scripts/normalize_ns0_to_bpmn.py" \
  "$SAP_SAM_DIR" \
  "$SAP_SAM_NORMALIZED_DIR"

# ------------------------------------------------------------------------------
# Step 3: fix malformed boolean attributes in the normalized BPMN files.
#
# This updates the files in-place in:
#   input-models/bpmn-sol-llm-benchmark/data/sap-sam-normalized/
#
# The helper script fixes problematic declarations such as malformed
# isImmediate / isInterrupting boolean attributes before conversion.
# ------------------------------------------------------------------------------
echo "[2/6] Fixing malformed boolean attributes..."
"$PYTHON_BIN" "$SCRIPT_DIR/bpmn_preprocessing_scripts/fix_isImmediate_isInterrupting.py" \
  "$SAP_SAM_NORMALIZED_DIR"

# ------------------------------------------------------------------------------
# Step 4a: build the Docker image used for BPMN -> TTL conversion.
#
# The Docker build context is converters/bpmn-to-kg, where the Dockerfile lives.
# ------------------------------------------------------------------------------
echo "[3/6] Building Docker image..."
docker build -t "$DOCKER_IMAGE" "$SCRIPT_DIR"

# ------------------------------------------------------------------------------
# Step 4b: convert every normalized BPMN file to a per-model TTL file.
#
# For each:
#   input-models/bpmn-sol-llm-benchmark/data/sap-sam-normalized/<name>.bpmn
#
# we create:
#   input-models/bpmn-sol-llm-benchmark/data/bpmns_to_ttls_from_repo/<name>.ttl
#
# The Docker container sees:
#   $INPUT_MODELS_DATA_DIR  ->  /work
#
# Therefore inside the container:
#   /work/sap-sam-normalized/<name>.bpmn
#   /work/bpmns_to_ttls_from_repo/<name>.ttl
# ------------------------------------------------------------------------------
echo "[4/6] Converting BPMN files to TTL..."

for file in "$SAP_SAM_NORMALIZED_DIR"/*.bpmn; do
  # If the glob does not match anything, skip cleanly.
  [ -e "$file" ] || continue

  # Strip only the final .bpmn suffix to get the output base name.
  base_name="$(basename "${file%.bpmn}")"

  echo "  - converting: $(basename "$file")"

  docker run --rm \
    --mount type=bind,source="$(realpath "$INPUT_MODELS_DATA_DIR")",destination=/work \
    "$DOCKER_IMAGE:latest" \
    --bpmn-input "/work/sap-sam-normalized/$(basename "$file")" \
    --ontology bboExtension \
    --kg-output "/work/bpmns_to_ttls_from_repo/$base_name.ttl"
done

# ------------------------------------------------------------------------------
# Step 5: generate sap-sam-orig-metadata.csv from the manually downloaded
# Zenodo SAP-SAM archive.
#
# Logic:
#   1) Read the normalized/original-file mapping from meta_data.csv
#   2) Extract the relevant original model IDs
#   3) Build a filtered metadata CSV from the Zenodo models/*.csv files
#
# Outputs created in converters/bpmn-to-kg/:
#   - sol-model-ids.txt
#   - sap-sam-orig-metadata.csv
# ------------------------------------------------------------------------------
echo "[5/6] Generating sap-sam-orig-metadata.csv..."

# Extract the original BPMN filenames from the second CSV column, remove the
# .bpmn suffix, keep only 32-hex-character IDs, sort uniquely, and store them.
cut -f2 -d, "$META_CSV" \
  | sed 's/\.bpmn$//' \
  | grep -E '[0-9a-f]{32}' \
  | sort -u > "$MODEL_IDS_FILE"

# Write the header row from models/0.csv after dropping the unwanted column.
head -n1 "$SAP_SAM_ZENODO_DIR/models/0.csv" \
  | "$PYTHON_BIN" -c "$CSV_SKIP_COL_CODE" > "$ORIG_META_CSV"

# From all Zenodo metadata CSV files, keep only the rows whose model IDs match
# our selected benchmark subset, again dropping the unwanted column before
# appending the rows to the output CSV.
grep -hFf "$MODEL_IDS_FILE" "$SAP_SAM_ZENODO_DIR"/models/*.csv \
  | "$PYTHON_BIN" -c "$CSV_SKIP_COL_CODE" \
  | grep -Ff "$MODEL_IDS_FILE" >> "$ORIG_META_CSV"

# ------------------------------------------------------------------------------
# Step 6: aggregate the per-model TTL files into one final merged TTL graph.
#
# Inputs:
#   --ttl-dir       per-model TTL files created in Step 4
#   --meta-csv      metadata from the cloned input-models repo
#   --orig-meta-csv metadata generated from the Zenodo archive in Step 5
#
# Main output:
#   model_databases/SAP-SAM/aggregated_model.ttl
#
# Side outputs written next to the main TTL output:
#   model_databases/SAP-SAM/aggregated_model_skipped_models.csv
#   model_databases/SAP-SAM/aggregated_model_matched_models.csv
# ------------------------------------------------------------------------------
echo "[6/6] Aggregating TTL files..."
"$PYTHON_BIN" "$SCRIPT_DIR/aggregate_ttls.py" \
  --ttl-dir "$TTL_DIR" \
  --meta-csv "$META_CSV" \
  --orig-meta-csv "$ORIG_META_CSV" \
  --output-ttl "$OUTPUT_TTL"

# ------------------------------------------------------------------------------
# Final status summary.
# ------------------------------------------------------------------------------
echo
echo "Done."
echo "Merged TTL:   $OUTPUT_TTL"
echo "Skipped log:  ${OUTPUT_TTL%.ttl}_skipped_models.csv"
echo "Matched log:  ${OUTPUT_TTL%.ttl}_matched_models.csv"
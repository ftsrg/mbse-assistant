#!/usr/bin/env bash

BPMN_SOL_REPO="../../input-models/bpmn-sol-llm-benchmark"
SAP_SAM_FOLDER="../../input-models/sap_sam_2022"
MODEL_IDS_FILE="sol-model-ids.txt"
METADATA_OUTPUT="sap-sam-orig-metadata.csv"
CSV_SKIP_COL_CODE="import sys,csv;csv.field_size_limit(sys.maxsize);w=csv.writer(sys.stdout);[w.writerow(r[:4]+r[5:]) for r in csv.reader(sys.stdin)]"

cut -f2 -d,  "$BPMN_SOL_REPO/data/sap-sam/meta_data.csv" | sed 's/\.bpmn$//' | grep -E '[0-9a-f]{32}' | sort -u > "$MODEL_IDS_FILE"

head -n1 "$SAP_SAM_FOLDER"/models/0.csv | python -c "$CSV_SKIP_COL_CODE" > "$METADATA_OUTPUT"
grep -hFf "$MODEL_IDS_FILE" "$SAP_SAM_FOLDER"/models/*.csv | python -c "$CSV_SKIP_COL_CODE" | grep -Ff "$MODEL_IDS_FILE" >> "$METADATA_OUTPUT"

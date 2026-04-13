#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
How to run
==========

This script aggregates many per-model Turtle (.ttl) files into one large RDF graph,
then enriches that graph with:

1. Organization nodes created from `sap-sam-orig-metadata.csv`
2. Model nodes created from `meta_data.csv`
3. Links from each model to its organization
4. Selected metadata on the model nodes (`Name`, `Datetime`, `original_id`, `normalized_id`)
5. A link from the synthetic model node to the unique `Definitions` node found inside the
   parsed TTL graph of that model

Why this script exists
----------------------
The existing BPMN -> TTL mappings are still useful exactly as they are: they convert
one BPMN file into one TTL file. This script is intentionally a *post-processing /
aggregation* step executed *after* those per-file transformations.

It does NOT modify the BPMN -> TTL transformation logic.
It reads the already generated TTL files, joins them through the CSV metadata,
and writes one merged output TTL file.

Expected inputs
---------------
1. Directory with already converted TTL files
2. `meta_data.csv`
   - used to map the normalized model name to the original BPMN file name
3. `sap-sam-orig-metadata.csv`
   - used to map the original BPMN file name / Model ID to Organization ID, Datetime, Name

Before running the script, import the rdflib library if you don't have it already: pip install rdflib

Current skip policy
-------------------
The script uses two layers of protection:

A) Explicit skip list
   These original BPMN files are skipped on purpose:
   - _example.bpmn
   - Choreography.bpmn
   - sid_926e6635_4ca0_494a_9be5_5ebe28fa8c6d.bpmn
   - sid_bb98ad40_4367_4076_ba83_dc115385b31f.bpmn

B) Safety checks
   A model is also skipped if:
   - no matching row is found in `meta_data.csv`
   - no matching row is found in `sap-sam-orig-metadata.csv`
   - the TTL file cannot be parsed

Output files
------------
The script writes:
- one merged Turtle file
- one CSV log about skipped files and the reason
- one CSV log about matched files and the metadata used

Example command
---------------
python aggregate_ttls.py \
  --ttl-dir "input-models/bpmn-sol-llm-benchmark/data/bpmns_to_ttls_from_repo" \
  --meta-csv "input-models/bpmn-sol-llm-benchmark/data/sap-sam/meta_data.csv" \
  --orig-meta-csv "converters/bpmn-to-kg/sap-sam-orig-metadata.csv" \
  --output-ttl "converters/bpmn-to-kg/aggregated_model/aggregated_model.ttl"
  
Notes about the resulting graph
-------------------------------
This script creates *synthetic* Organization and Model nodes.
That design is intentional, because the original per-model TTL files and the external CSV metadata
live on two different layers: one layer describes the converted BPMN content, while the other layer
contains collection-level metadata such as organization, name, datetime, and stable technical identifiers.

To connect those two layers into one graph, the script links each synthetic model node to the parsed
TTL content of the same BPMN model.

For this corpus, the safest and most deterministic anchor is the BPMN `Definitions` node.
Therefore the script does not use a generic root heuristic anymore:

1. It searches for `Definitions` nodes inside the parsed TTL graph
2. If exactly one `Definitions` node is found, it links the synthetic model node to it
3. If none or multiple are found, the model is skipped with a warning

This keeps the aggregated graph connected while avoiding ambiguous graph attachment logic.
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote

from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import RDF, RDFS, XSD, DCTERMS


# --------------------------------------------------------------------------------------
# Configuration constants
# --------------------------------------------------------------------------------------

# These original BPMN filenames are intentionally excluded from aggregation.
# The user explicitly requested that these should not be processed.
EXPLICIT_SKIP_MODELS = {
    "_example.bpmn",
    "Choreography.bpmn",
    "sid_926e6635_4ca0_494a_9be5_5ebe28fa8c6d.bpmn",
    "sid_bb98ad40_4367_4076_ba83_dc115385b31f.bpmn",
}

# Base namespaces for newly created synthetic resources.
BASE = Namespace("https://www.teamingai-project.eu/kg/")

# --------------------------------------------------------------------------------------
# Small utility helpers
# --------------------------------------------------------------------------------------


def safe_stem(filename: str) -> str:
    """Return the filename without its last suffix.

    Example:
        "abc.bpmn" -> "abc"
        "abc.ttl"  -> "abc"
    """
    return Path(filename).stem



def quoted_uri_fragment(text: str) -> str:
    """Percent-encode text so it can safely appear inside a URI path segment."""
    return quote(text, safe="")



def normalize_datetime_literal(value: str) -> Literal:
    """Convert a datetime string into an RDF literal.

    The CSV currently uses a format like:
        2019-06-13 19:49:44

    We store it as xsd:dateTime when possible.
    If parsing is not possible in the future for some row, the function falls back to a plain literal.
    """
    value = (value or "").strip()
    if not value:
        return Literal("")

    # Replace the space between date and time with 'T' to get a standard xsd:dateTime lexical form.
    if " " in value and "T" not in value:
        value = value.replace(" ", "T", 1)

    return Literal(value, datatype=XSD.dateTime)


# --------------------------------------------------------------------------------------
# Namespace handling and URI rewriting
# --------------------------------------------------------------------------------------

BBO = Namespace("http://www.onto-bpo.eu/ontologies/bbo#")
BBOEXT = Namespace("http://www.onto-bpo.eu/ontologies/bboExtension#")
TAI = Namespace("https://www.teamingai-project.eu/")
RDF = Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#")
RDFS = Namespace("http://www.w3.org/2000/01/rdf-schema#")
XSD = Namespace("http://www.w3.org/2001/XMLSchema#")

# This mapping is needed to rewrite the old namespaces used in the per-model TTL files into the new namespaces used in the aggregated graph.
NS_REWRITE = {
    "https://www.irit.fr/recherches/MELODI/ontologies/BBO#": "http://www.onto-bpo.eu/ontologies/bbo#",
    "https://www.teamingai-project.eg/BBOExtension#": "http://www.onto-bpo.eu/ontologies/bboExtension#",
}

def rewrite_uri(term):
    """Rewrite a URIRef according to the NS_REWRITE mapping, if applicable."""
    if not isinstance(term, URIRef):
        return term
    s = str(term)
    for old_ns, new_ns in NS_REWRITE.items():
        if s.startswith(old_ns):
            return URIRef(new_ns + s[len(old_ns):])
    return term

def normalize_graph_namespaces(g: Graph) -> Graph:
    """Return a new graph with all URIs rewritten according to the NS_REWRITE mapping."""
    out = Graph()
    for s, p, o in g:
        out.add((rewrite_uri(s), rewrite_uri(p), rewrite_uri(o)))
    return out

def normalize_graph_structure(graph: Graph) -> Graph:
    """Normalize structure for query-friendly aggregated output.

    - rdfs:subClassOf  -> rdf:type
    - *:belongsToX     -> tai:belongsTo
    """
    out = Graph()

    for s, p, o in graph:
        new_p = p

        if p == RDFS.subClassOf:
            new_p = RDF.type

        elif isinstance(p, URIRef):
            p_str = str(p)
            local_name = p_str.rsplit("#", 1)[-1].rsplit("/", 1)[-1]

            if local_name.startswith("belongsTo") and local_name != "belongsTo":
                new_p = TAI.belongsTo

        out.add((s, new_p, o))

    return out


# --------------------------------------------------------------------------------------
# CSV loading and join-building
# --------------------------------------------------------------------------------------


def load_meta_mapping(meta_csv: Path) -> Dict[str, dict]:
    """Load `meta_data.csv` and index it by normalized model name.

    Important fields used here:
    - model
    - original_file

    The `model` column is expected to match the normalized BPMN / TTL base name.
    Example:
        model = "sid_00931e22_a013_48e2_abaa_24359dc59979"
        TTL file = "sid_00931e22_a013_48e2_abaa_24359dc59979.ttl"
    """
    mapping: Dict[str, dict] = {}

    with meta_csv.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            model_name = (row.get("model") or "").strip()
            original_file = (row.get("original_file") or "").strip()
            if not model_name:
                continue

            mapping[model_name] = {
                "model": model_name,
                "original_model_id": safe_stem(original_file) if original_file else "",
            }

    return mapping



def load_original_metadata(orig_meta_csv: Path) -> Dict[str, dict]:
    """Load `sap-sam-orig-metadata.csv` and index it by original Model ID.

    The original metadata table is keyed by the *original* model id, not by the normalized name.
    That is why the script first uses `meta_data.csv`, then uses `original_file`, then strips `.bpmn`,
    and only then joins to this dictionary.
    """
    mapping: Dict[str, dict] = {}

    with orig_meta_csv.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            model_id = (row.get("Model ID") or "").strip()
            if not model_id:
                continue
            mapping[model_id] = row

    return mapping


# --------------------------------------------------------------------------------------
# Root detection inside each TTL graph
# --------------------------------------------------------------------------------------

def find_definitions_nodes(graph: Graph) -> List[URIRef]:
    """Return all URI subjects that are typed as BPMN Definitions nodes."""
    candidates: List[URIRef] = []

    for subj, _, obj in graph.triples((None, RDF.type, None)):
        if not isinstance(subj, URIRef):
            continue
        obj_str = str(obj)
        if obj_str.endswith("#Definitions") or obj_str.endswith("/Definitions"):
            candidates.append(subj)

    seen = set()
    deduped = []
    for item in candidates:
        if item not in seen:
            deduped.append(item)
            seen.add(item)

    return deduped

# --------------------------------------------------------------------------------------
# Synthetic node creation
# --------------------------------------------------------------------------------------


def corpus_uri(corpus_id: str) -> URIRef:
    return URIRef(BASE + f"corpus/{quoted_uri_fragment(corpus_id)}")



def organization_uri(org_label: str) -> URIRef:
    return URIRef(BASE + f"organization/{quoted_uri_fragment(org_label)}")



def model_uri(model_name: str) -> URIRef:
    return URIRef(BASE + f"model/{quoted_uri_fragment(model_name)}")


# --------------------------------------------------------------------------------------
# Main aggregation logic
# --------------------------------------------------------------------------------------

def aggregate(
    ttl_dir: Path,
    meta_csv: Path,
    orig_meta_csv: Path,
    output_ttl: Path,
) -> Tuple[Path, Path, Path]:
    """Run the complete aggregation pipeline and return the generated file paths."""

    # Load both CSV sources first.
    # This allows us to validate the join before parsing a large number of TTL files.
    meta_mapping = load_meta_mapping(meta_csv)
    orig_mapping = load_original_metadata(orig_meta_csv)

    # We create a single final graph and then add every model graph into it.
    merged = Graph()

    # Bind namespaces so the output Turtle remains readable.

    merged.bind("bbo", BBO, override=True)
    merged.bind("bboExt", BBOEXT, override=True)
    merged.bind("tai", TAI, override=True)
    merged.bind("rdf", RDF, override=True)
    merged.bind("rdfs", RDFS, override=True)
    merged.bind("xsd", XSD, override=True)

    # We need deterministic organization labels Org1, Org2, ... based on ascending Organization ID.
    # But we can only compute that after seeing which rows actually survive the join and skip rules.
    eligible_rows: List[dict] = []
    skip_log: List[dict] = []

    ttl_files = sorted(ttl_dir.glob("*.ttl"), key=lambda p: p.name.lower())

    # --------------------------------------------------------------------------
    # Pass 1: validate each TTL file against the metadata joins, but do not parse yet.
    # --------------------------------------------------------------------------
    for ttl_path in ttl_files:
        normalized_model_name = ttl_path.stem

        meta_row = meta_mapping.get(normalized_model_name)
        if meta_row is None:
            skip_log.append(
                {
                    "ttl_file": ttl_path.name,
                    "normalized_model": normalized_model_name,
                    "reason": "no_meta_match",
                    "details": "No matching row in meta_data.csv for the TTL filename stem.",
                }
            )
            continue

        normalized_model_name = meta_row["model"]
        normalized_bpmn_name = f"{normalized_model_name}.bpmn"
        if normalized_bpmn_name in EXPLICIT_SKIP_MODELS:
            skip_log.append(
                {
                    "ttl_file": ttl_path.name,
                    "normalized_model": normalized_model_name,
                    "reason": "explicit_skip",
                    "details": f"Normalized BPMN file is on the explicit skip list: {normalized_bpmn_name}",
                }
            )
            continue

        original_model_id = meta_row["original_model_id"]
        orig_row = orig_mapping.get(original_model_id)
        if orig_row is None:
            skip_log.append(
                {
                    "ttl_file": ttl_path.name,
                    "normalized_model": normalized_model_name,
                    "reason": "no_org_match",
                    "details": f"No matching row in sap-sam-orig-metadata.csv for Model ID '{original_model_id}'.",
                }
            )
            continue

        eligible_rows.append(
            {
                "ttl_path": ttl_path,
                "normalized_model": normalized_model_name,
                "original_model_id": original_model_id,
                "organization_id": (orig_row.get("Organization ID") or "").strip(),
                "datetime": (orig_row.get("Datetime") or "").strip(),
                "name": (orig_row.get("Name") or "").strip(),
            }
        )

    # Deterministic organization label assignment: sort surviving Organization IDs ascending.
    organization_ids = sorted({row["organization_id"] for row in eligible_rows if row["organization_id"]})
    org_id_to_label = {org_id: f"Org{idx + 1}" for idx, org_id in enumerate(organization_ids)}

    # Create a single synthetic corpus root node so the aggregated graph has one
    # top-level entry point above all organizations.
    corpus_id = "sap-sam-aggregated-corpus"
    corpus_node = corpus_uri(corpus_id)
    corpus_label = "SAP-SAM Aggregated BPMN Corpus"
    corpus_description = (
        "Aggregated RDF graph built from normalized BPMN choreography models and linked organizational metadata."
    )

    merged.add((corpus_node, RDF.type, BBOEXT.Corpus))
    merged.add((corpus_node, RDFS.label, Literal(corpus_label, lang="en")))
    merged.add((corpus_node, TAI.corpusId, Literal(corpus_id)))
    merged.add((corpus_node, TAI.sourceDataset, Literal("sap-sam")))
    merged.add((corpus_node, TAI.description, Literal(corpus_description, lang="en")))

    match_log: List[dict] = []

    # --------------------------------------------------------------------------
    # Pass 2: parse TTL files, merge them, and add synthetic organization/model nodes.
    # --------------------------------------------------------------------------
    for row in eligible_rows:
        ttl_path = row["ttl_path"]
        normalized_model = row["normalized_model"]
        original_model_id = row["original_model_id"]
        organization_id = row["organization_id"]
        model_name = row["name"]
        model_datetime = row["datetime"]

        # Parse the per-model TTL into a temporary graph first.
        # This allows us to keep the file-level root detection local to that model.
        model_graph = Graph()
        try:
            model_graph.parse(ttl_path, format="turtle")
            model_graph = normalize_graph_namespaces(model_graph)
            model_graph = normalize_graph_structure(model_graph)
        except Exception as exc:
            skip_log.append(
                {
                    "ttl_file": ttl_path.name,
                    "normalized_model": normalized_model,
                    "reason": "ttl_parse_error",
                    "details": str(exc),
                }
            )
            continue

        # Merge the parsed model graph into the final graph.
        merged += model_graph

        # Build or reuse the synthetic organization node.
        org_label = org_id_to_label.get(organization_id, "OrgUnknown")
        org_node = organization_uri(org_label)

        merged.add((org_node, RDF.type, BBOEXT.Organization))
        merged.add((org_node, RDFS.label, Literal(org_label, lang="en")))
        merged.add((org_node, TAI.organizationId, Literal(organization_id)))
        merged.add((org_node, TAI.belongsTo, corpus_node))

        # Build the synthetic model node for this normalized model.
        # This node is intentionally stable and derived from the normalized filename stem.
        synthetic_model = model_uri(normalized_model)

        merged.add((synthetic_model, RDF.type, BBOEXT.Model))
        merged.add((synthetic_model, RDFS.label, Literal(normalized_model)))
        merged.add((synthetic_model, BBO.name, Literal(model_name)))
        merged.add((synthetic_model, TAI.normalizedId, Literal(normalized_model)))
        merged.add((synthetic_model, TAI.originalId, Literal(original_model_id)))
        if model_datetime:
            merged.add((synthetic_model, TAI.modelCreated, normalize_datetime_literal(model_datetime)))

        # Organization -> model link.
        merged.add((synthetic_model, TAI.belongsTo, org_node))

        # Connect the synthetic model node to the unique Definitions subject already present inside the TTL graph.
        # This is what turns the metadata layer into a graph that is actually attached to the converted content.
        definitions_nodes = find_definitions_nodes(model_graph)
        if len(definitions_nodes) != 1:
            skip_log.append(
                {
                    "ttl_file": ttl_path.name,
                    "normalized_model": normalized_model,
                    "reason": "missing_or_ambiguous_definitions_node",
                    "details": f"Expected exactly one Definitions node, found {len(definitions_nodes)}.",
                }
            )
            continue

        definitions_node = definitions_nodes[0]
        merged.add((definitions_node, TAI.belongsTo, synthetic_model))

        match_log.append(
            {
                "ttl_file": ttl_path.name,
                "normalized_model": normalized_model,
                "original_model_id": original_model_id,
                "organization_id": organization_id,
                "organization_label": org_label,
                "name": model_name,
                "datetime": model_datetime,
                "definitions_nodes_found": len(definitions_nodes),
            }
        )

    # --------------------------------------------------------------------------
    # Write the main TTL and the two report CSV files.
    # --------------------------------------------------------------------------
    output_ttl.parent.mkdir(parents=True, exist_ok=True)
    merged.serialize(destination=str(output_ttl), format="turtle")

    skipped_csv = output_ttl.with_name(output_ttl.stem + "_skipped_models.csv")
    matched_csv = output_ttl.with_name(output_ttl.stem + "_matched_models.csv")

    write_csv(
        skipped_csv,
        ["ttl_file", "normalized_model", "reason", "details"],
        skip_log,
    )
    write_csv(
        matched_csv,
        [
            "ttl_file",
            "normalized_model",
            "original_model_id",
            "organization_id",
            "organization_label",
            "name",
            "datetime",
            "definitions_nodes_found",
        ],
        match_log,
    )

    return output_ttl, skipped_csv, matched_csv


# --------------------------------------------------------------------------------------
# Reporting helper
# --------------------------------------------------------------------------------------


def write_csv(path: Path, fieldnames: Sequence[str], rows: Sequence[dict]) -> None:
    """Write a CSV file with a stable header even if `rows` is empty."""
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


# --------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Aggregate per-model TTL files into one graph and enrich them with organization/model metadata."
    )
    parser.add_argument(
        "--ttl-dir",
        required=True,
        type=Path,
        help="Directory containing the already generated per-model .ttl files.",
    )
    parser.add_argument(
        "--meta-csv",
        required=True,
        type=Path,
        help="Path to meta_data.csv (normalized model -> original file mapping).",
    )
    parser.add_argument(
        "--orig-meta-csv",
        required=True,
        type=Path,
        help="Path to sap-sam-orig-metadata.csv (original Model ID -> organization metadata).",
    )
    parser.add_argument(
        "--output-ttl",
        required=True,
        type=Path,
        help="Path of the final aggregated Turtle file to create.",
    )
    return parser



def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    # Basic input validation before doing any work.
    if not args.ttl_dir.exists() or not args.ttl_dir.is_dir():
        print(f"ERROR: TTL directory does not exist or is not a directory: {args.ttl_dir}", file=sys.stderr)
        return 1

    if not args.meta_csv.exists():
        print(f"ERROR: meta_data.csv not found: {args.meta_csv}", file=sys.stderr)
        return 1

    if not args.orig_meta_csv.exists():
        print(f"ERROR: sap-sam-orig-metadata.csv not found: {args.orig_meta_csv}", file=sys.stderr)
        return 1

    output_ttl, skipped_csv, matched_csv = aggregate(
        ttl_dir=args.ttl_dir,
        meta_csv=args.meta_csv,
        orig_meta_csv=args.orig_meta_csv,
        output_ttl=args.output_ttl,
    )

    print("Aggregation finished successfully.")
    print(f"Merged TTL:   {output_ttl}")
    print(f"Skipped log:  {skipped_csv}")
    print(f"Matched log:  {matched_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

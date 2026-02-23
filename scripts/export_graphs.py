#!/usr/bin/env python3
"""
Export graph artifacts (GraphML, meta, community_details) for each key_terms
in the iAgentBench dataset that has a run under ISAbench output/2025_seeds/.
Filenames use a short hash of key_terms (non-human-readable).
Run from repo root with ISAbench on PYTHONPATH or as sibling:
  PYTHONPATH=/path/to/ISAbench python scripts/export_graphs.py
"""
import hashlib
import json
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def slug_from_key_terms(key_terms: str) -> str:
    """Non-human-readable slug: first 16 hex chars of SHA256."""
    return hashlib.sha256(key_terms.strip().encode("utf-8")).hexdigest()[:16]


def get_unique_key_terms(dataset_path: Path) -> list[str]:
    with open(dataset_path, encoding="utf-8") as f:
        rows = json.load(f)
    seen = set()
    out = []
    for row in rows:
        kt = row.get("key_terms")
        if kt is None:
            continue
        if isinstance(kt, list):
            kt = kt[0] if kt else ""
        kt = str(kt).strip()
        if kt and kt not in seen:
            seen.add(kt)
            out.append(kt)
    return out


def find_latest_run(seeds_root: Path, key_terms: str) -> Path | None:
    """Return path to run_dir (timestamp dir) or None."""
    seed_dir = seeds_root / key_terms
    if not seed_dir.is_dir():
        return None
    runs = [d for d in seed_dir.iterdir() if d.is_dir() and len(d.name) == 15 and d.name.count("_") == 1]
    if not runs:
        return None
    runs.sort(key=lambda p: p.name, reverse=True)
    for run_dir in runs:
        ca = run_dir / "curated_artifacts"
        if (ca / "entities_pruned.parquet").exists() and (ca / "relationships_pruned.parquet").exists():
            return run_dir
    return None


def build_extended_graphml(nodes: list, edges: list, out_path: Path) -> None:
    """Write GraphML with d0-d6 (label, type, community, weight, label, description, full_description)."""
    graphml = ET.Element(
        "graphml",
        {
            "xmlns": "http://graphml.graphdrawing.org/xmlns",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "xsi:schemaLocation": "http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd",
        },
    )
    ET.SubElement(graphml, "key", {"id": "d0", "for": "node", "attr.name": "label", "attr.type": "string"})
    ET.SubElement(graphml, "key", {"id": "d1", "for": "node", "attr.name": "type", "attr.type": "string"})
    ET.SubElement(graphml, "key", {"id": "d2", "for": "node", "attr.name": "community", "attr.type": "string"})
    ET.SubElement(graphml, "key", {"id": "d3", "for": "edge", "attr.name": "weight", "attr.type": "double"})
    ET.SubElement(graphml, "key", {"id": "d4", "for": "edge", "attr.name": "label", "attr.type": "string"})
    ET.SubElement(graphml, "key", {"id": "d5", "for": "node", "attr.name": "description", "attr.type": "string"})
    ET.SubElement(graphml, "key", {"id": "d6", "for": "edge", "attr.name": "full_description", "attr.type": "string"})

    graph = ET.SubElement(graphml, "graph", {"id": "G", "edgedefault": "directed"})
    node_map = {}

    for i, node in enumerate(nodes):
        nid = node["id"]
        node_elem = ET.SubElement(graph, "node", {"id": str(i)})
        node_map[nid] = str(i)
        props = node.get("properties", {})

        def set_data(key, val):
            if val is None or (isinstance(val, float) and str(val) == "nan"):
                return
            d = ET.SubElement(node_elem, "data", {"key": key})
            d.text = str(val)

        set_data("d0", nid)
        set_data("d1", props.get("type"))
        set_data("d2", props.get("community"))
        set_data("d5", props.get("description"))

    for i, edge in enumerate(edges):
        src, tgt = edge["start"], edge["end"]
        if src not in node_map or tgt not in node_map:
            continue
        edge_elem = ET.SubElement(graph, "edge", {"id": "e" + str(i), "source": node_map[src], "target": node_map[tgt]})
        props = edge.get("properties", {})
        if props.get("weight") is not None:
            d = ET.SubElement(edge_elem, "data", {"key": "d3"})
            d.text = str(props["weight"])
        if props.get("short_label"):
            d = ET.SubElement(edge_elem, "data", {"key": "d4"})
            d.text = str(props["short_label"])
        if props.get("full_description"):
            d = ET.SubElement(edge_elem, "data", {"key": "d6"})
            d.text = str(props["full_description"])

    tree = ET.ElementTree(graphml)
    ET.indent(tree, space="  ")
    tree.write(out_path, encoding="utf-8", xml_declaration=True)


def build_meta_from_package(pkg_path: Path) -> dict:
    """Extract communities dict from curated_llm_package.json."""
    with open(pkg_path, encoding="utf-8") as f:
        pkg = json.load(f)
    communities = {}
    for section in pkg.get("communities", []):
        cid = section.get("community_id")
        if cid is None:
            continue
        key = str(int(cid))
        communities[key] = {
            "title": section.get("title", ""),
            "type": section.get("type", ""),
            "summary": section.get("summary", ""),
            "top_findings": section.get("top_findings", []),
        }
    return {"communities": communities}


def main():
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    dataset_path = repo_root / "assets" / "data" / "iAgentBench.json"
    out_dir = repo_root / "assets" / "data" / "graphs"

    isabench_root = Path(os.environ.get("ISABENCH_ROOT", repo_root.parent / "ISAbench"))
    seeds_root = isabench_root / "output" / "2025_seeds"
    if not seeds_root.is_dir():
        print("ISAbench seeds root not found:", seeds_root, file=sys.stderr)
        print("Set ISABENCH_ROOT if ISAbench is elsewhere.", file=sys.stderr)
        sys.exit(1)

    sys.path.insert(0, str(isabench_root))
    import pandas as pd
    from src.visualization import convert_entities_to_dicts, convert_relationships_to_dicts

    if not dataset_path.exists():
        print("Dataset not found:", dataset_path, file=sys.stderr)
        sys.exit(1)

    key_terms_list = get_unique_key_terms(dataset_path)
    print("Unique key_terms in dataset:", len(key_terms_list))

    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}

    for key_terms in key_terms_list:
        run_dir = find_latest_run(seeds_root, key_terms)
        if run_dir is None:
            continue
        slug = slug_from_key_terms(key_terms)
        curated = run_dir / "curated_artifacts"
        ent_path = curated / "entities_pruned.parquet"
        rel_path = curated / "relationships_pruned.parquet"
        if not ent_path.exists() or not rel_path.exists():
            continue

        entities_df = pd.read_parquet(ent_path)
        relationships_df = pd.read_parquet(rel_path)
        nodes = convert_entities_to_dicts(entities_df)
        edges = convert_relationships_to_dicts(relationships_df)

        build_extended_graphml(nodes, edges, out_dir / f"{slug}.graphml")

        pkg_path = curated / "curated_llm_package.json"
        if pkg_path.exists():
            meta = build_meta_from_package(pkg_path)
            with open(out_dir / f"{slug}_meta.json", "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)

        details_path = run_dir / "community_details.json"
        if details_path.exists():
            with open(details_path, encoding="utf-8") as f:
                details = json.load(f)
            with open(out_dir / f"{slug}_details.json", "w", encoding="utf-8") as f:
                json.dump(details, f, indent=0)

        manifest[key_terms] = slug
        print("  ", key_terms[:50], "->", slug)

    with open(out_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print("Wrote manifest with", len(manifest), "entries to", out_dir / "manifest.json")


if __name__ == "__main__":
    main()

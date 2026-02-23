#!/usr/bin/env python3
"""
Reorder iAgentBench by graph "demo suitability" (sweet-spot size) and diversity.

- Scores each row by graph size (nodes/edges): ideal band = not too small, not too large.
- Sorts by score (best first), then shuffles within score bands with a fixed seed for diversity.
- Reassigns id to 1..N (zero-padded) and writes to assets/data/reordered/rseed_{seed}/.

Usage (from repo root):
  python scripts/reorder_for_demo.py --seed 42
  python scripts/reorder_for_demo.py --seed 42 --input assets/data/iAgentBench.json
"""
import argparse
import json
import random
import sys
from pathlib import Path

import xml.etree.ElementTree as ET

# Demo "sweet spot": graphs in this range are preferred (not too simple, not too complex)
NODE_MIN, NODE_MAX = 25, 120
EDGE_MIN, EDGE_MAX = 40, 300
# Rows without a graph (key_terms not in manifest) get this score and sort last
NO_GRAPH_SCORE = 1_000_000


def normalize_key_terms(key_terms) -> str:
    if key_terms is None:
        return ""
    if isinstance(key_terms, list):
        return str(key_terms[0]).strip() if key_terms else ""
    return str(key_terms).strip()


def load_manifest(manifest_path: Path) -> dict[str, str]:
    with open(manifest_path, encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def _local_tag(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def graph_stats_from_graphml(path: Path) -> tuple[int, int] | None:
    """Return (num_nodes, num_edges) or None if file missing/invalid."""
    if not path.is_file():
        return None
    try:
        tree = ET.parse(path)
        root = tree.getroot()
        graph = None
        for el in root.iter():
            if _local_tag(el.tag) == "graph":
                graph = el
                break
        if graph is None:
            return None
        nodes = sum(1 for _ in graph.iter() if _local_tag(_.tag) == "node")
        edges = sum(1 for _ in graph.iter() if _local_tag(_.tag) == "edge")
        return (nodes, edges)
    except Exception:
        return None


def build_slug_stats(manifest: dict[str, str], graphs_dir: Path) -> dict[str, tuple[int, int]]:
    """Build slug -> (nodes, edges) for every slug in manifest."""
    out = {}
    for _key, slug in manifest.items():
        gpath = graphs_dir / f"{slug}.graphml"
        st = graph_stats_from_graphml(gpath)
        if st is not None:
            out[slug] = st
    return out


def score_graph(nodes: int, edges: int) -> float:
    """Lower is better. In-band = 0; outside = distance from nearest in-range point."""
    n_ok = NODE_MIN <= nodes <= NODE_MAX
    e_ok = EDGE_MIN <= edges <= EDGE_MAX
    if n_ok and e_ok:
        return 0.0
    n_dist = 0.0 if n_ok else min(abs(nodes - NODE_MIN), abs(nodes - NODE_MAX))
    e_dist = 0.0 if e_ok else min(abs(edges - EDGE_MIN), abs(edges - EDGE_MAX))
    return n_dist + e_dist


def band_thresholds(scores: list[float], num_bands: int = 5) -> list[float]:
    """Return sorted thresholds so we can bucket into num_bands (excluding NO_GRAPH_SCORE)."""
    finite = [s for s in scores if s < NO_GRAPH_SCORE]
    if not finite:
        return [NO_GRAPH_SCORE]
    finite.sort()
    n = len(finite)
    # Approximate quantile boundaries
    thresholds = []
    for i in range(1, num_bands):
        idx = min(int(n * i / num_bands), n - 1)
        thresholds.append(finite[idx])
    thresholds.append(NO_GRAPH_SCORE)
    return sorted(set(thresholds))


def main() -> None:
    parser = argparse.ArgumentParser(description="Reorder iAgentBench for demo (good graphs first, diverse).")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for deterministic band shuffle")
    parser.add_argument("--input", type=Path, default=Path("assets/data/iAgentBench.json"), help="Input JSON path")
    parser.add_argument("--manifest", type=Path, default=Path("assets/data/graphs/manifest.json"), help="Manifest path")
    parser.add_argument("--graphs-dir", type=Path, default=Path("assets/data/graphs"), help="Graphs directory")
    parser.add_argument("--output-dir", type=Path, default=Path("assets/data/reordered"), help="Base output directory")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    input_path = repo_root / args.input if not args.input.is_absolute() else args.input
    manifest_path = repo_root / args.manifest if not args.manifest.is_absolute() else args.manifest
    graphs_dir = repo_root / args.graphs_dir if not args.graphs_dir.is_absolute() else args.graphs_dir
    output_base = repo_root / args.output_dir if not args.output_dir.is_absolute() else args.output_dir

    if not input_path.is_file():
        print(f"Input not found: {input_path}", file=sys.stderr)
        sys.exit(1)
    if not manifest_path.is_file():
        print(f"Manifest not found: {manifest_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_path, encoding="utf-8") as f:
        rows = json.load(f)
    if not isinstance(rows, list):
        rows = getattr(rows, "rows", getattr(rows, "data", []))
        if not isinstance(rows, list):
            print("Expected a JSON array of rows", file=sys.stderr)
            sys.exit(1)

    manifest = load_manifest(manifest_path)
    slug_stats = build_slug_stats(manifest, graphs_dir)

    # Score each row (keep row dict + score)
    scored = []
    for row in rows:
        kt = normalize_key_terms(row.get("key_terms"))
        slug = manifest.get(kt)
        if slug and slug in slug_stats:
            n, e = slug_stats[slug]
            s = score_graph(n, e)
        else:
            s = NO_GRAPH_SCORE
        scored.append((s, row))

    # Sort by score ascending
    scored.sort(key=lambda x: x[0])

    # Band thresholds from scores (finite only)
    scores_only = [x[0] for x in scored]
    thresholds = band_thresholds(scores_only)

    def band_idx(score: float) -> int:
        for i, t in enumerate(thresholds):
            if score <= t:
                return i
        return len(thresholds)

    # Group by band
    bands: dict[int, list[tuple[float, dict]]] = {}
    for s, row in scored:
        b = band_idx(s)
        bands.setdefault(b, []).append((s, row))

    # Shuffle within each band with seed
    random.seed(args.seed)
    reordered = []
    for b in sorted(bands.keys()):
        band_list = bands[b]
        random.shuffle(band_list)
        reordered.extend(r for _, r in band_list)

    # Reassign id 1..N (zero-padded 4 digits)
    n = len(reordered)
    for i, row in enumerate(reordered, start=1):
        row["id"] = str(i).zfill(4)

    # Write to assets/data/reordered/rseed_{seed}/
    out_subdir = output_base / f"rseed_{args.seed}"
    out_subdir.mkdir(parents=True, exist_ok=True)
    out_json = out_subdir / "iAgentBench.json"
    out_seed_info = out_subdir / "seed_info.json"

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(reordered, f, indent=0, ensure_ascii=False)

    seed_info = {
        "seed": args.seed,
        "input_path": str(input_path),
        "output_path": str(out_json),
        "description": "Reordered by graph demo score (sweet-spot size), then banded shuffle for diversity; ids 1..N.",
    }
    with open(out_seed_info, "w", encoding="utf-8") as f:
        json.dump(seed_info, f, indent=2)

    print(f"Wrote {len(reordered)} rows to {out_json}")
    print(f"Seed info: {out_seed_info}")


if __name__ == "__main__":
    main()

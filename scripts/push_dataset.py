#!/usr/bin/env python3
"""
Push assets/data/iAgentBench.json to Hugging Face as the test split,
replacing the current data at preetam7/iAgentBench.

Requires write access to the repo (huggingface-cli login or HF_TOKEN).
Run from repo root: python scripts/push_dataset.py
"""
import json
import os
import sys


def main():
    try:
        from datasets import Dataset
    except ImportError:
        print("Install with: pip install datasets", file=sys.stderr)
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    in_path = os.path.join(repo_root, "assets", "data", "iAgentBench.json")

    if not os.path.isfile(in_path):
        print(f"Input not found: {in_path}", file=sys.stderr)
        sys.exit(1)

    with open(in_path, encoding="utf-8") as f:
        rows = json.load(f)
    if not isinstance(rows, list):
        print("Expected a JSON array of rows", file=sys.stderr)
        sys.exit(1)

    print(f"Loaded {len(rows)} rows from {in_path}")
    ds = Dataset.from_list(rows)
    print("Pushing to preetam7/iAgentBench (test split)...")
    ds.push_to_hub("preetam7/iAgentBench", config_name="default", split="test")
    print("Done. Test split updated on the Hub.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
One-time script to download preetam7/iAgentBench from Hugging Face
and save as assets/data/iAgentBench.json for the Explorer Demo.
Run: pip install datasets && python scripts/fetch_dataset.py
"""
import json
import os

def main():
    try:
        from datasets import load_dataset
    except ImportError:
        print("Install with: pip install datasets")
        raise SystemExit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    out_path = os.path.join(repo_root, "assets", "data", "iAgentBench.json")

    print("Loading preetam7/iAgentBench (split=test)...")
    ds = load_dataset("preetam7/iAgentBench", split="test")
    rows = [ds[i] for i in range(len(ds))]
    print("Got", len(rows), "rows.")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=0)
    print("Wrote", out_path)

if __name__ == "__main__":
    main()

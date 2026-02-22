# Scripts

## fetch_dataset.py

One-time (or occasional) script to download the iAgentBench dataset from Hugging Face and save it as `assets/data/iAgentBench.json` for the Explorer Demo page. This keeps the site fast without loading from Hugging Face on each visit.

**Usage:**

```bash
pip install datasets
python scripts/fetch_dataset.py
```

Then commit `assets/data/iAgentBench.json` if it changed.

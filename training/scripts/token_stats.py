#!/usr/bin/env python3
"""
Count tokens per example using tiktoken if available, otherwise fall back to a simple word-based heuristic.

Usage: python scripts/token_stats.py path/to/mtg_llm_training.jsonl
"""
import sys
import json
from pathlib import Path

def word_count_tokens(text):
    # simple heuristic: split on whitespace and punctuation
    import re
    toks = re.findall(r"\w+|[^\w\s]", text)
    return len(toks)

def load_tiktoken():
    try:
        import tiktoken
        return tiktoken
    except Exception:
        return None

def count_tokens_for_message(tiktoken_mod, model_name, message):
    text = message
    if tiktoken_mod:
        enc = tiktoken_mod.encoding_for_model(model_name) if hasattr(tiktoken_mod, 'encoding_for_model') else tiktoken_mod.get_encoding('cl100k_base')
        return len(enc.encode(text))
    return word_count_tokens(text)

def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/token_stats.py path/to/file.jsonl [model_name]")
        return
    p = Path(sys.argv[1])
    model_name = sys.argv[2] if len(sys.argv) > 2 else 'gpt-4o-mini'
    tiktoken_mod = load_tiktoken()

    counts = []
    total_tokens = 0
    max_tok = 0
    import statistics
    with p.open('r', encoding='utf-8') as f:
        for line in f:
            obj = json.loads(line)
            msgs = obj.get('messages', [])
            tok = 0
            for m in msgs:
                tok += count_tokens_for_message(tiktoken_mod, model_name, m.get('content',''))
            counts.append(tok)
            total_tokens += tok
            if tok > max_tok:
                max_tok = tok

    if counts:
        print(f"Examples: {len(counts)}")
        print(f"Total tokens: {total_tokens}")
        print(f"Mean tokens/example: {statistics.mean(counts):.1f}")
        print(f"Median tokens/example: {statistics.median(counts):.1f}")
        print(f"95th percentile: {statistics.quantiles(counts, n=100)[94]}")
        print(f"Max tokens: {max_tok}")
    else:
        print("No examples found.")

if __name__ == '__main__':
    main()

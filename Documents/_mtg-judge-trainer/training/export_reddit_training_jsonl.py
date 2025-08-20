#!/usr/bin/env python3
"""
export_reddit_training_jsonl.py

Usage:
  python export_reddit_training_jsonl.py --project stacksagemtg --output mtg_llm_training.jsonl --min-confidence 0.7 --limit 10000
"""
import argparse
import json
from google.cloud import firestore
from google.api_core import exceptions
from datetime import datetime

SYSTEM_PROMPT = "You are an expert Magic: The Gathering judge. Provide accurate, detailed answers about MTG rules and card interactions."

def doc_to_example(doc):
    d = doc.to_dict()
    question = d.get("question") or d.get("title") or ""
    answer = d.get("answer") or d.get("topAnswer") or ""
    confidence = float(d.get("confidence") or 0.0)
    metadata = {
        "confidence": confidence,
        "interaction_type": d.get("interaction_type") or d.get("interactionType") or None,
        "rule_references": d.get("rule_references") or d.get("ruleReferences") or []
    }
    example = {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": question},
            {"role": "assistant", "content": answer}
        ],
        "metadata": metadata
    }
    return example

def doc_to_example_with_opts(doc, include_fields=None, anonymize=False):
    # Build base example
    example = doc_to_example(doc)
    d = doc.to_dict()

    # Optionally include extra metadata fields from the document
    if include_fields:
        for f in include_fields:
            if f in d:
                example["metadata"][f] = d.get(f)

    # Basic anonymization: remove common PII-like fields from metadata
    if anonymize:
        pii_keys = ["author", "author_id", "user", "username", "post_id", "reddit_id", "id"]
        for k in pii_keys:
            if k in example["metadata"]:
                example["metadata"][k] = "REDACTED"

    return example

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", default="mtg_llm_training.jsonl")
    parser.add_argument("--min-confidence", type=float, default=0.7)
    parser.add_argument("--limit", type=int, default=10000, help="max docs to export")
    parser.add_argument("--collection", default="reddit_interactions")
    parser.add_argument("--include-fields", default="", help="comma-separated extra document fields to include in metadata")
    parser.add_argument("--anonymize", action="store_true", help="scrub common PII-like metadata fields")
    parser.add_argument("--split", default="0.8,0.1,0.1", help="train,val,test fractions, must sum to 1.0")
    parser.add_argument("--seed", type=int, default=42, help="random seed for dataset split")
    args = parser.parse_args()

    client = firestore.Client(project=args.project)
    coll = client.collection(args.collection)
    query = coll.where("confidence", ">=", args.min_confidence).order_by("timestamp", direction=firestore.Query.DESCENDING).limit(args.limit)

    include_fields = [f.strip() for f in args.include_fields.split(",") if f.strip()]
    split_parts = [float(x) for x in args.split.split(",")]
    if len(split_parts) != 3 or abs(sum(split_parts) - 1.0) > 1e-6:
        print("--split must be three comma-separated fractions that sum to 1.0")
        return

    import random
    random.seed(args.seed)

    examples = []
    try:
        for doc in query.stream():
            example = doc_to_example_with_opts(doc, include_fields=include_fields, anonymize=args.anonymize)
            # skip if answer or question missing
            if not example["messages"][1]["content"] or not example["messages"][2]["content"]:
                continue
            examples.append(example)
    except exceptions.GoogleAPICallError as e:
        print("Firestore API error:", e)
        return

    # Basic validation/stats
    total = len(examples)
    confidences = [e.get("metadata", {}).get("confidence", 0.0) for e in examples]
    interaction_types = {}
    rule_ref_counts = 0
    for e in examples:
        it = e.get("metadata", {}).get("interaction_type") or "unknown"
        interaction_types[it] = interaction_types.get(it, 0) + 1
        if e.get("metadata", {}).get("rule_references"):
            rule_ref_counts += 1

    # Write cleaned output
    with open(args.output, "w", encoding="utf-8") as out:
        for e in examples:
            out.write(json.dumps(e, ensure_ascii=False) + "\n")

    # Create deterministic splits
    indices = list(range(total))
    random.shuffle(indices)
    n_train = int(split_parts[0] * total)
    n_val = int(split_parts[1] * total)
    train_idx = set(indices[:n_train])
    val_idx = set(indices[n_train:n_train + n_val])
    test_idx = set(indices[n_train + n_val:])

    base = args.output.rsplit('.', 1)[0]
    train_path = base + ".train.jsonl"
    val_path = base + ".val.jsonl"
    test_path = base + ".test.jsonl"

    with open(train_path, "w", encoding="utf-8") as t, open(val_path, "w", encoding="utf-8") as v, open(test_path, "w", encoding="utf-8") as tt:
        for i, e in enumerate(examples):
            line = json.dumps(e, ensure_ascii=False) + "\n"
            if i in train_idx:
                t.write(line)
            elif i in val_idx:
                v.write(line)
            else:
                tt.write(line)

    # Print summary
    import statistics
    print(f"Wrote {total} examples to {args.output}")
    print(f" - train: {len(train_idx)}, val: {len(val_idx)}, test: {len(test_idx)}")
    if confidences:
        print(f" - confidence: mean={statistics.mean(confidences):.3f}, median={statistics.median(confidences):.3f}")
    print(f" - interaction_type counts: {interaction_types}")
    print(f" - examples with rule_references: {rule_ref_counts}")

if __name__ == "__main__":
    main()

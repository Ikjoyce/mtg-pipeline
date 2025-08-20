Training & Model Conversion Guide (mtg_llm_training)

This short README explains the downstream steps after exporting `mtg_llm_training.jsonl`, and provides quick guidance for fine-tuning and converting models for mobile/web.

Files produced by the exporter
- `mtg_llm_training.jsonl` — cleaned examples (JSONL, messages + metadata)
- `mtg_llm_training.train.jsonl`, `.val.jsonl`, `.test.jsonl` — deterministic splits

Recommended next steps
1. Validate & clean
   - Run basic schema checks (messages array has system,user,assistant). Remove empty answers/questions.
   - Spot-check rule references and remove malformed markup.

2. Tokenize & estimate size
   - Use the included `scripts/token_stats.py` to compute token counts and distributions.
   - Estimate total tokens in your training set to plan epochs and batch sizes.

3. Fine-tuning approach
   - Choose an LLM base with a context window >= the 95th percentile token length of your examples.
   - If examples are short (<512 tokens): a 2-4k context is fine; if many long examples, target 8k+.
   - Start with small batches (8–32) for GPU memory safety; increase if you have more VRAM.
   - Learning rate: typical finetune LR ranges (e.g., 1e-5 to 5e-5) depend on base; run small sweep.

4. Exported model conversion (SavedModel -> TFLite / TFJS / CoreML)
   - Train or export a TensorFlow SavedModel (recommended for full conversion control).
   - TFLite: Use TensorFlow Lite converter and consider post-training quantization (float16 or int8) for mobile size/perf.
   - TFJS: Use `tensorflowjs_converter` on SavedModel (or TFLite -> TFJS via tfjs converter) and place `model.json` + weights into `web/tfjs_model/`.
   - Core ML: Use `coremltools` from a SavedModel, or convert from TFLite if needed.

5. Web app integration
   - Add TFJS artifact to `web/tfjs_model/` and keep cloud `llmProxy` fallback for heavy queries.
   - Use a small client-side runtime to route low-confidence queries to cloud.

6. Security & keys
   - Do not embed API keys in the client. Use the Functions proxy with Secret Manager to call provider APIs.

Quick commands
- Token stats (local): `python scripts/token_stats.py mtg_llm_training.jsonl`
- Convert SavedModel -> TFJS: `tensorflowjs_converter --input_format=tf_saved_model /path/to/saved_model /path/to/web/tfjs_model` (see tensorflowjs docs)

If you want, I can produce a short `train.sh` which runs a small finetune job on a chosen base model and exports a SavedModel.

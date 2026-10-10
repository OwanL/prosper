# One pinned small-local primitive challenger

Implementation readiness, 2026-10-08. **No weights acquired, services started or inference performed by this implementation task.** Mock tests were authored but could not run under critically low fresh RAM measurements. The parent owns acquisition/execution and final integrated verification. No held-out suite, reference trajectories or authored strategies were read or used.

## Entrypoint and isolation

`npm.cmd exec -- tsx scripts/evaluate-small-local.ts` is offline: it prints the pinned plan only. It does not acquire, start a service, construct fixtures or infer. Explicit execution is `npm.cmd exec -- tsx scripts/evaluate-small-local.ts --confirm-small-local`, only after fresh resource admission. No package/config/default runtime changes.

The sole new challenger is **official IBM Granite-4.0-H-1B Q8_0**. Installed `qwen3.5:9b` remains unchanged at its 64K context, 6 GiB free RAM / 7 GiB free VRAM gate.

- Artifact repository `ibm-granite/granite-4.0-h-1b-GGUF`, revision `c2cb1972f511add21f3bae244990b8ff3a3ffb23`.
- File `granite-4.0-h-1b-Q8_0.gguf`, exactly **1,558,926,560 bytes**.
- SHA-256 `f29248184ca766350e56e6d161c2a637ad302a6d595e15d4a62cd58327a0ac0e`.
- [Immutable acquisition URL](https://huggingface.co/ibm-granite/granite-4.0-h-1b-GGUF/resolve/c2cb1972f511add21f3bae244990b8ff3a3ffb23/granite-4.0-h-1b-Q8_0.gguf).
- Publisher config/template revision `d18cca4c121edb87d022116d281ce212c9136f57`; [template](https://huggingface.co/ibm-granite/granite-4.0-h-1b/raw/d18cca4c121edb87d022116d281ce212c9136f57/chat_template.jinja) SHA-256 `9524df67b77a7b25a2dfee898f75b316a157eb9d855b51e32aeac79d7c8a83ce`.

Weights stream to an exclusive task-created OS-temp file with incremental hashing, exact length, partial-file cleanup and no resume/retry. GGUF inspection reads bounded metadata only after full streamed verification; it never initializes tensors. `/api/blobs` receives a file stream, not a whole-weight buffer. Ollama runs on its own loopback port, with `OLLAMA_NO_CLOUD=1` and an explicit canonical OS-temp-contained `OLLAMA_MODELS` directory. Each fixture has a new store/service lifecycle. Nothing is pulled into or changed in the shared Ollama store. The API import pins the exact local blob, template, context and stop string; local manifest hash/model layer identity reconcile with `/api/tags`. The service's exact canonical private store enters transport identity, and import requires that same store and the fixed Granite envelope.

## Native template and byte-bound admission

The grammar-constrained primitive JSON adapter is reused unchanged. This is **not native tool calling**: no `tools`, tool transcript or supplied strategy is sent. Only two complete string messages, system then user, are admitted. The explicit Go template renders each as:

```text
<|start_of_role|>${role}<|end_of_role|>${content}<|end_of_text|>\n
```

followed by `<|start_of_role|>assistant<|end_of_role|>`. This is the pinned publisher's no-tools/no-documents subset with a provided first system message, without an injected default system. The template and its hash are pinned in code. Embedded GGUF Jinja must equal the publisher hash; unknown/different conversion templates fail closed. Imported `/api/show` must expose the exact Go template, no system/messages injection, only the declared context/stop parameters, correct hybrid family, Q8_0 quantization and artifact-verified architecture/tokenizer scalars. `/api/tags` must match the imported manifest digest and size. Remote/cloud metadata fails closed.

Ollama **0.35.1** is explicitly checked. Its legacy `granite-instruct` template is not trusted for Granite 4.0; import supplies the template rather than relying on autodetection. [Ollama v0.35.1 template index](https://github.com/ollama/ollama/blob/v0.35.1/template/index.json), [model template detection](https://github.com/ollama/ollama/blob/v0.35.1/server/model.go). This tag uses llama.cpp **b11232**, whose [Granite hybrid implementation](https://github.com/ggml-org/llama.cpp/blob/b11232/src/models/granite-hybrid.cpp) supports Mamba2/attention. These are source compatibility evidence, **not actual local import/load verification**. API incompatibility or metadata mismatch blocks; there is no runtime/cloud fallback.

The Granite envelope is **131,072 total context**, **120,000 input reservation**, **256 output**, **110,000 complete messages-plus-schema UTF-8 bytes**, with the adapter's **4-entry / 32,000-byte history**. It does not use the earlier 1,024-byte history omission lane. Current observation and mechanics are not selectively trimmed. Every decision is byte-checked, including serialized full declared history and schema, fixed per-message/global header allowances and literal template bytes. Two public fixture shapes were previously measured at approximately 49,048 / 69,933 bytes; these are historical payload bytes, not token counts or universal maxima.

The GGUF must contain GPT2 BPE metadata, one of the explicitly admitted splitting-only pretokenizers, all 256 byte-alphabet base tokens, disabled automatic BOS and no space-prefix expansion. Otherwise the bound is unsupported and fails closed. The UTF-8 byte count with generous formatting allowances is a **conservative upper bound, not exact tokenization**; no bytes/4 estimate or reported post-generation input count substitutes for admission. `truncate:false` is also sent, but sufficient preflight capacity is the protection rather than assuming an API flag proves no truncation. Tokenizer normalization/render equivalence remains separate from exact counting work owned by another task.

## Conservative resource plan

Granite requires **6 GiB free host RAM and 5 GiB free VRAM**, freshly sampled before service creation, import and each generation. Monitoring stops below **1 GiB free RAM / 128 MiB free VRAM**, retaining existing abort, identity-tracked tree termination, exit verification and uncertain-operation accounting. The protected Qwen defaults do not change.

The [pinned scout report](local-primitive-model-scout.md), based on publisher [config](https://huggingface.co/ibm-granite/granite-4.0-h-1b/blob/d18cca4c121edb87d022116d281ce212c9136f57/config.json), gives 4 attention layers × 4 KV heads × 128 dimensions. At 128K, FP16 K+V is **1 GiB**. Add approximately **54 MiB** Mamba matrix state, **1.452 GiB** GGUF storage proxy and a heuristic **1.5 GiB** buffer allowance: under 4.1 GiB before margin, motivating a 5 GiB free-VRAM gate. Host planning allows two file equivalents (~2.904 GiB), 1.5 GiB staging/runtime and at least 1 GiB margin, rounded to 6 GiB. File size is not measured tensor residency; scratch, page mapping, backend copies and cold-loading peaks may exceed estimates.

**No hard containment claims:** this is cooperative process ownership plus periodic resource sampling, not a Windows Job Object, GPU allocation limit, hard RAM/CPU sandbox or guaranteed peak bound. HTTP abort alone does not establish inference stopped. Failed stop remains pending; reuse is forbidden until owned teardown succeeds. A source-supported budget is not evidence of measured laptop feasibility.

## Public evidence and bounded execution

Only `buy-meal` and `sell-buy-meal` public fixtures run, with fixed maxima of one call in the first and two in the second, **three total**, serialized. No retry, repair, fallback, reference strategy, training or sealed evaluation. Budget exhaustion is retained as an outcome rather than continued inference. One caller abort deadline covers both service startups, imports and generations within five minutes; import timeouts recompute remaining time after startup. Decisions remain 90 seconds and teardown 10 seconds. Acquisition has its own bounded deadline.

A unique OS-temp evidence directory retains at most 32 MiB of known public audit files per fixture (`initialization.json`, `trace.jsonl`, `report.json`), hashes, replay result, accounting, resource/service failures and bounded actual raw reply content. Oversize content keeps only byte count/hash; hidden thinking is not retained. Raw bounded content is captured even if token-receipt validation subsequently rejects it. Bounded audit files, report, hashes and raw replies are retained before fallible replay or accounting validation. Replay success or failure is recorded before original output cleanup, so invalid/failed attempts remain available. If retention itself fails, the original output directory is not deleted and its path/reason are recorded (or printed if evidence writing also fails). Model/store/service temp data are removed only after confirmed stop; unconfirmed teardown retains private logs and fails. These outputs are development evidence only, not model quality, strategic capability or sealed-suite generalization claims.

**Current blocker:** implementation tests/typechecking and real API import/load compatibility remain unverified. Fresh implementation-time RAM samples fell below 1 GiB (as low as single-digit MiB); no test runner, build, weight acquisition or service was launched. Final verification and any execution belong to the parent after fresh gates pass.

# Local primitive-model scout after the blocked Qwen probe

Research-only, **2026-10-08**. This report is the only repository file changed. No package/runtime/weight acquisition, inference, tokenizer experiment, service start, configuration/source change, workload unloading or durable Prosper-directory access occurred. Remote downloads were documentation and small metadata only; temporary research copies were removed. No helper sessions were used.

## Recommendation

**Measure the exact rendered prompt with the installed tokenizer before acquiring another model.** There is a source-backed vocabulary-only route that needs no tensor loading or generation. It could replace the coarse reservation with a count for the **same information**, but the actual count and Ollama-rendering equivalence have not been measured. This is a proposed, separately approved experiment, not permission to reduce any existing gate.

For a subsequent bounded model comparison, use this **four-candidate test order**, not a demonstrated quality ranking:

1. **IBM Granite-4.0-H-1B, official Q8_0 GGUF:** strongest *new* tiny Apache-licensed challenger. General instruction/math and function-call evidence, documented 128K context, and only four attention layers make it more relevant to the present large prompt than its dense 1B sibling. Hybrid loading/state behavior still needs measurement.
2. **Liquid LFM2.5-1.2B-Instruct, official Q8_0 GGUF:** smallest download here and retained tiny general-agent comparator. Its documented **32,768-token** limit makes exact counting an eligibility gate, not merely an optimization. Do not substitute a larger `lfm2.5:latest` alias or infer 128K support from its config.
3. **Qwen3.5-4B, text-only Q6_K GGUF:** retained family/size comparator, with low attention-cache cost. Greater host loading risk than either tiny model; no claim that it will outperform the installed 9B.
4. **IBM Granite-4.2-3B, official Q6_K GGUF:** genuinely newer, **2026-08-25**, general reasoning/tool-use candidate. More relevant than repeating Granite 4.1 as the newest model. Dense KV, default thinking, and publisher sampling recommendations make it conditional rather than the first low-memory experiment.

**No candidate is certified feasible with only 1.81 GiB free host RAM.** The original preflight correctly stopped before any generation: RAM 1.81 GiB < 6 GiB, VRAM 7.19 GiB > 7 GiB. Those transient measurements do not establish that Qwen 9B is inherently unsuitable. Keep it as the installed reference; primitive capability and latency remain unmeasured. [P1–P4]

## 1. What changed the shortlist

This extends, rather than replaces or repeats, [the earlier tool-call report](local-tool-call-models.md). The additional primary-source pass was bounded to small IBM Granite models, SmolLM3 and Phi-4-mini. It found two useful Granite alternatives and a newer 4.2 release; it did not turn into an unrestricted model hunt.

| Candidate | Publisher evidence supporting general reasoning **and** tool composition | Counterevidence / transfer limit |
|---|---|---|
| **Granite-4.0-H-1B** | IBM card: GSM8K **69.83** (8-shot), GSM Symbolic **65.72**, MMLU **59.74**, IFEval strict instruction **82.37**, **BFCL v3 50.21**. The official template represents calls and subsequent tool results, not just a classifier over supplied intents. Card release date **2025-10-28**. | Dense Granite-4.0-1B scores **76.35** GSM8K / **54.82** BFCL v3 in the same table: hybrid memory savings are not a quality win. No separately reported Prosper-like liquidity/dependent-action/recovery success rate, quantized score or laptop latency. A multi-turn-capable template is not proof of useful multi-turn behavior. [G1] |
| **LFM2.5-1.2B-Instruct** | Official card: MMLU-Pro **44.35**, GPQA **38.89**, AIME25 **14.00**, Multi-IF **60.98**, **BFCL v3 49.12**. Explicit function execution → tool-result → continued conversation protocol. | BFCL uses a **custom Liquid handler**; these are publisher results, not our runtime. Card recommends agentic/extraction/RAG uses but **not knowledge-intensive tasks or programming**, and recommends domain fine-tuning. Its own comparison gives dense Granite 4.0-1B BFCL **52.43**, different from IBM's 54.82: evaluation setup matters even within one BFCL version. [L1] |
| **Qwen3.5-4B** | Official card reports **BFCL v4 50.3**, **TAU2 79.9** and general math/reasoning evaluations. Official template carries prior calls/results; architecture makes larger context comparatively cheap. | Publisher benchmark settings, reasoning budget and unquantized weights are not the current non-thinking, 256-output-token primitive lane. Earlier policy receipts include accepted but economically poor Qwen decisions; policy and direct-primitive authority are different. Historical Qwen parser failures remain integration counterexamples, not proof of family incapability. [Q1, P1, P3] |
| **Granite-4.2-3B** | Official card: **BFCL v4 52.41**, τ³-bench **50.99** (separate AVG row **45.78**), GPQA **54.80**, AIME25 **78.33**, IFBench prompt **74.33**. Post-training includes agentic traces, tool-use/structured-output RL and general chat; supports non-thinking as well as default thinking. | Scores are not established for Q6/non-thinking/256-token output. Card recommends **temperature 1.0, top_p 0.95 across all tasks**, with **8,192** generated tokens for thinking / **2,048** non-thinking as deployment recommendations. Current adapter uses temperature 0 and 256 output tokens. Do not silently change those or spend thousands of reasoning tokens to obtain the advertised capability. RULER falls from **67.52 at 64K to 55.30 at 128K**: advertised capacity does not mean retained reasoning quality. [G2] |

These numbers justify *testing* general generators, not selecting a strategist from benchmark ranks. BFCL v3/v4, TAU2/τ³ and different reasoning budgets are not directly comparable. No listed score establishes discovery of profitable Prosper actions, correct tier pricing, result-aware sale-before-purchase, or termination under our observation.

### Bounded exclusions and substitutes

- **Granite-4.0-1B dense:** credible general/tool model and official Q8 file **1,737,791,232 bytes**, but **40 full-attention layers** produce approximately **5 GiB FP16 KV at 64K**, versus **0.5 GiB** for H-1B. Despite `GraniteMoeHybridForCausalLM` in the config, its layer list is entirely attention. Neither 1B model is a sparse MoE: their expert counts are zero. Choose by actual layer configuration, not class name or “1B” label. [G1, G3]
- **Granite-4.1-3B:** valid non-thinking fallback if the later 4.2 mode/sampling cost is unacceptable. Apache-2.0, official Q6 **2,795,616,864 bytes**, BFCL v3 **60.80**, GSM8K **86.88**. It has the same 5 GiB-at-64K dense KV issue. Its native JSON-inside-XML template **differs from 4.2's Coder-style XML**. It is a substitute for slot 4, not a fifth automatic acquisition. [G4]
- **SmolLM3-3B:** Apache-2.0, native XML/JSON and Python-call formats, `/no_think`, documented llama.cpp route, native 64K with extended-context support. Its no-thinking table lists BFCL **92.3**, but the inspected table does not identify the BFCL version/category denominator; do **not** rank it above 49–60 BFCL-v3 aggregates on that basis. General no-thinking GSM-Plus **72.8** / GPQA **35.7** are credible. Its 36 attention layers require **4.5 GiB FP16 KV at 64K**, substantially more than Qwen3.5-4B. Good alternate, not another default experiment. [X1]
- **Phi-4-mini-instruct:** MIT, 3.8B, 128K, official tool format and strong GSM8K **88.6** / MATH **64.0** (CoT settings). Its own card reports occasional **hallucinated function names/URLs**. With 32 layers × 8 KV heads × 128 dimensions, FP16 KV alone is **8 GiB at 64K**, before weights. The tokenizer's GPT-4o-related identity is also not interchangeable with the installed Qwen tokenizer. No compelling memory advantage here. [X2]
- **Qwen3-4B-Instruct-2507 Q6:** retain the previous non-thinking alternative, but ordinary attention requires **9 GiB FP16 KV at 64K** (36 × 8 × 128). It becomes attractive only after exact counting supports a much smaller context; its smaller weights alone do not solve this reservation. Original Qwen3-4B is not the same checkpoint. [P3]
- **LFM2-1.2B-Tool** remains a specialist substitution, not a demonstrated better general strategist; Liquid recommends its maintained successor. **FunctionGemma** remains outside this general-agent shortlist because its publisher explicitly limits trained chaining/multi-turn capability. The earlier practitioner Tool-model success and FunctionGemma loops are retained in the previous report; they were not new trials here. [P3]

## 2. Exact acquisition and protocol choices

Sizes below are **remote file metadata**, not measured host or GPU residency. GB is decimal; GiB is binary. These artifacts were **not downloaded**. Pin the repository revision and LFS SHA-256 below rather than a mutable runtime alias. Publisher cards/configs/templates and quantized artifacts have separate revisions.

| Candidate / exact filename | Artifact repository @ revision | Weight download / license | Template, native calls and runtime |
|---|---|---|---|
| **Granite-4.0-H-1B Q8_0**: `granite-4.0-h-1b-Q8_0.gguf` | `ibm-granite/granite-4.0-h-1b-GGUF` @ `c2cb1972f511add21f3bae244990b8ff3a3ffb23` | **1,558,926,560 B**, 1.559 GB / **1.452 GiB**. Apache-2.0; publisher conversion. | Official `chat_template.jinja`: Granite `<|start_of_role|>` turns; `<tool_call>{"name":...,"arguments":...}</tool_call>`; tool results in `<tool_response>`. Proposed pinned llama.cpp CUDA route supports the hybrid architecture. Jinja/native response parsing still needs a round-trip gate; not an assumed official Ollama tag. Documented **131,072** context. [G1, G3, R1] |
| **LFM2.5-1.2B-Instruct Q8_0**: `LFM2.5-1.2B-Instruct-Q8_0.gguf` | `LiquidAI/LFM2.5-1.2B-Instruct-GGUF` @ `8ed288026e23958ad9dfa92d53ed773a8eee7125` | **1,246,253,888 B**, 1.246 GB / **1.161 GiB**. LFM Open License v1.0; publisher conversion. | Official `chat_template.jinja`, ChatML-like turns, system `List of tools: [...]`; native **Python-style call list** between `<|tool_call_start|>` and `<|tool_call_end|>`, not ordinary JSON. Pinned llama.cpp has explicit LFM2.5 detection/parser. Non-thinking Instruct, **32,768** documented context. JSON can be requested, but that is a different output lane. [L1–L3, R1] |
| **Qwen3.5-4B Q6_K**: `Qwen3.5-4B-Q6_K.gguf` | `unsloth/Qwen3.5-4B-GGUF` @ `e87f176479d0855a907a41277aca2f8ee7a09523` | **3,525,956,768 B**, 3.526 GB / **3.284 GiB**. Apache-2.0; third-party conversion. **No mmproj/vision download** for this text task. | Official template is in `tokenizer_config.json`; ChatML and **Qwen3-Coder-style XML** (`<function=...>`, `<parameter=...>`), not previous Qwen3 JSON calls. `enable_thinking:false` must actually render a closed thinking prefix. llama.cpp text-only route avoids the vision projector; existing Ollama supports the family but exact Q6/template import is additional work. Native config **262,144**; propose no extension. [Q1–Q2, R1] |
| **Granite-4.2-3B Q6_K**: `granite-4.2-3b-Q6_K.gguf` | `ibm-granite/granite-4.2-3b-GGUF` @ `c40945d71cd90f249a56985e8155551a9188dc30` | **3,006,359,072 B**, 3.006 GB / **2.800 GiB**. Apache-2.0; publisher conversion. | Official `chat_template.jinja`: now **ChatML + Coder-style XML**, with `enable_thinking:false`; not the Granite 4.0/4.1 JSON-XML template. Pinned llama.cpp has the dense Granite architecture and matching Coder-format detector; local quant/template behavior untested. Native **131,072**; advertised 512K needs extension and is outside scope. [G2–G3, R1] |

**Weight LFS SHA-256:**

- H-1B Q8: `f29248184ca766350e56e6d161c2a637ad302a6d595e15d4a62cd58327a0ac0e`.
- LFM Q8: `f6b981dcb86917fa463f78a362320bd5e2dc45445df147287eedb85e5a30d26a`.
- Qwen 4B Q6: `fdedd781c9ce676ab66b018ca247ff78e8a33c98098a822c1e2d5075e7718f66`.
- Granite 4.2 Q6: `2e08e2790489162105be79b7f26a81fde28ea30119fa6df12594acd59f12dd96`.

**Publisher metadata/template revisions:** H-1B `d18cca4c121edb87d022116d281ce212c9136f57`; LFM `0f604ada3f766f9f257460c4c9f0b5d6f69d431b`; Qwen 4B `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a`; Granite 4.2 `e459acceac81e5fe67c07d9cfc72329a332e7eb1`. The embedded GGUF template has not been read locally: later compare it with these sources and pin its hash. A correct model name does not establish that a conversion retained the intended template.

**Licenses/costs:** Apache permits research/commercial use subject to notices and other terms. Liquid's license has notices and a commercial-revenue limitation at the defined US$10 million threshold; it is **not** unrestricted Apache-style licensing. llama.cpp is MIT; its CUDA redistributables have their own NVIDIA terms. No fine-tuning/data generation is proposed. No paid-provider costs, but acquisition, disk, host loading, prefill and integration are real costs. [L2, R2]

### Runtime acquisition is separate from weights

A concrete proposed runtime pin is **llama.cpp b11490**, commit `9c2e0e491a822adae1f0b1c831adb4160057d24f`:

- CPU x64 archive `llama-b11490-bin-win-cpu-x64.zip`: **19,482,170 B** (19.5 MB), SHA-256 `ed69a9e87713b84c63940b2f0e708c8e698e82b3d74dfa1364e94d97e334720c`. Candidate for the vocabulary-only sizing step; zero GPU inference.
- CUDA **12.4** x64 archive: **264,960,856 B**; associated cudart archive **391,443,627 B**, totaling **656,404,483 B** (~656 MB / 0.611 GiB) if both needed. Extracted disk footprint is additional and unmeasured. CUDA archive SHA-256 `475de637171161bf259a2ef0a3384b8421ff9f70fe5aff0bad2cf931e01ad858`; cudart `8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6`.
- Previous hardware report identifies NVIDIA **560.94**, CUDA compatibility **12.6**. Prefer investigating this 12.4 build, **not CUDA 13.4 or an unsolicited driver upgrade**. Compatibility remains a gate, not a local verification. CPU-only tiny-model inference is an alternative with unknown latency, not a silent fallback. [R2, P4]

The current audited `OllamaTransport` admits **only exact installed `qwen3.5:9b`**. None of these is a drop-in CLI model substitution. An alternate Ollama import or task-owned llama.cpp transport requires separately scoped admission/lifecycle/accounting work and review. Do not bypass it through an injected transport claiming `local`. [P2]

## 3. Memory at this workload: separate quantities

The existing request measurements were **49,048 UTF-8 bytes** first turn and **69,933 bytes** second turn with full feedback history. They include serialized messages plus schema, not a measured tokenized prompt. The admitted probe instead declares one **1,024-byte history entry**, with omissions recorded and the current observation intact. That bounded-history lane and the full-history measurement are **different information sets**; this report does not call history omission a same-information optimization. [P1–P2]

Until exact counts exist, there is **no honest measured KV figure “at the actual workload.”** The table therefore provides conditional context allocations, including the current conservative 64K case. A first-turn byte bound plus per-message/global/template allowances drove 64K. The 69,933-byte full-history example would **not** fit that same byte-based 64K reservation; absent counting, it needs a larger envelope or must fail closed. No truncation is proposed.

For FP16 K and V, one sequence:

`attention KV bytes = context tokens × attention layers × KV heads × head dimension × 2 (K,V) × 2 bytes`.

| Model | Config-derived attention terms | FP16 KV at 8K / 16K / 32K / 64K total context | State not included in KV |
|---|---|---|---|
| Granite H-1B | **4 × 4 × 128** | **0.0625 / 0.125 / 0.250 / 0.500 GiB** | 36 Mamba-2 layers. Config implies roughly **54 MiB** single-sequence FP32 SSM matrix state plus convolution state; runtime copies, alignment and scratch can add more. Not zero-memory attention. |
| LFM2.5 1.2B | **6 × 8 × 64** | **0.0938 / 0.1875 / 0.375 / unsupported** | 10 short-convolution blocks and other runtime state. Do not extend the card's 32K limit using config `128000`. |
| Qwen3.5 4B / installed 9B | **8 × 4 × 256** | **0.250 / 0.500 / 1.000 / 2.000 GiB** | 24 linear-attention layers plus recurrent/convolution state, graph and buffers. |
| Granite 4.2 3B | **40 × 8 × 64** | **0.625 / 1.250 / 2.500 / 5.000 GiB** | Dense graph/prefill/batch allocations; no hybrid cache saving. |

Configs are publisher metadata, not local allocation receipts. Allocation may follow **reserved context**, not only tokens already used. Parallel slots multiply costs; propose one sequence, no speculative drafter, FP16 KV and conservative prefill batching. Quantizing **weights** Q6/Q8 does not quantize KV. Aggressive KV quantization is not the proposed remedy; the runtime warns of tool-quality degradation. [G1–G3, L1, Q1, R1]

### Planning estimates, not admission thresholds or guaranteed peaks

Assume text-only llama.cpp, mostly GPU-resident weights, one sequence, no other model. These are extra process/model costs **excluding Windows, browser, Prosper and desktop VRAM**. GGUF file size is a weight-storage proxy, not the exact GPU tensor allocation; tied embeddings, nonquantized tensors and conversion details can change it.

| Configuration | Illustrative process VRAM allowance at 16K / 64K | Host loading planning range, excluding CPU-offloaded tensors/KV |
|---|---|---|
| H-1B Q8 | **2.1–3.1 / 2.5–3.7 GiB** | **~2.0–4.4 GiB** |
| LFM Q8 | **1.8–2.8 / not supported**; at 32K **2.0–3.1** | **~1.7–3.9 GiB** |
| Qwen 4B Q6 | **4.3–5.6 / 5.8–7.2 GiB** | **~3.8–8.1 GiB** |
| Granite 4.2 3B Q6 | **4.6–5.8 / 8.3–9.6 GiB** | **~3.3–7.1 GiB** |

GPU ranges add the calculated KV and a **heuristic ~0.5–1.5 GiB** buffer/state margin, rounded conservatively; they are not vendor measurements. Large prefill graphs can exceed them. Host ranges illustrate roughly **one to two weight-file equivalents plus 0.5–1.5 GiB runtime/staging** during cold loading. They are not upper bounds: pageable mapped pages, transient copies, pinned buffers and backend behavior differ. Full-GPU warm host residency may fall after file pages are reclaimed, but cannot be predicted from download size; **warm working set remains unmeasured**. Offloading tensors/cache to CPU adds real host demand, not a free escape. Loading peak and warm residency must be sampled separately.

Practical implications:

- Tiny models have credible GPU margin but **still lack a demonstrated host-safe cold load at 1.81 GiB free**. LFM's ~1.16 GiB file is not a promise that ~1.81 GiB headroom suffices.
- Granite 4.2 Q6 at the current 64K allocation is not a plausible **fully GPU-resident** 8 GiB configuration. At a verified 16K count it becomes plausible; otherwise offload brings host/latency costs. Small parameter count alone was misleading.
- The installed Qwen 9B's **6.6 GB catalog payload** includes more than a text-only quant comparison; the prior report's text Q4 floor was ~5.29 GiB. At 64K, ~2 GiB KV plus overhead strains this GPU and may require host offload. If the **same exact prompt** later fits 16K instead, KV would fall to ~0.5 GiB, saving ~1.5 GiB, **without changing weights or observation**. That is a conditional calculation, not a measured count or proof of feasibility.
- Preserve the **existing 6 GiB RAM / 7 GiB VRAM preflight and all cancellation/accounting protections**. These ranges do not authorize lowering a safety gate. Any eventual alternative-model resource envelope must be separately designed and approved, not substituted now. [P1–P4]

## 4. Can exact tokenization reduce reservation without supplying strategy?

**Yes in principle, with concrete primary-source support; reduction size is unknown.** Tokenization changes measurement, not the citizen's information or action authority.

### Supported mechanism

1. **Tokenize the final rendered prompt, not HTTP JSON bytes.** Ollama **v0.35.1** source renders its selected Go/native template and tokenizes the result when deciding context fit. It separately passes `format` to generation; in the structured-content lane the schema is not automatically equivalent to prompt text. If a native tool lane embeds definitions, those rendered definitions *do* count. Counting the serialized HTTP/schema envelope is safe but coarse. [R3]
2. **A tokenizer does not inherently require weights or KV.** Pinned llama.cpp `tools/tokenize/tokenize.cpp` explicitly sets **`model_params.vocab_only = true`**, then tokenizes with the GGUF vocabulary. `include/llama.h` documents “only load the vocabulary, no weights.” `llama-context.cpp` skips GPU backend/memory initialization when `hparams.vocab_only` is true. This is a real no-tensor-loading path, not a proposal to send an empty generation request to warm a model. [R4]
3. llama-server documents **`/apply-template`** returning a rendered prompt without inference and **`/tokenize`** returning token IDs, with explicit `add_special`/`parse_special`. Useful contracts, but **starting the ordinary server may load weights**. It is not the smallest experiment under this RAM pressure, and it is not proposed now. [R1]

### What must match before calling a count exact

- Exact installed GGUF digest/vocabulary/pretokenizer; the generic metadata name **`gpt2` is not a complete tokenizer specification**. Preserve merges, normalization, byte handling, special IDs and BOS/EOS behavior.
- The installed Ollama tag's **selected rendering mode and template**, not just upstream Qwen's Jinja. Offline llama.cpp/Jinja rendering does **not automatically equal** Ollama's Go/native rendering. Record renderer/runtime revision, template hash and rendered-prompt hash.
- Actual system/user messages, objective, mechanics, complete current observation, declared history, thinking-off prefix and generation suffix. No field filtering, numeric rounding, whitespace normalization inside content, oracle-selected entities or strategically selected summaries.
- Runtime special-token flags and any added prefix/padding. Reserve count plus the full output ceiling and any verified additional backend tokens; reject if identity/rendering is unknown. No average `bytes/4` conversion or fixed guessed compression factor.
- Recount **each** new decision before reservation; one measured fixture does not bound later observation/history growth. Keep independent byte/output limits and unknown-usage charging.

For the already declared bounded-history probe, count its exact messages unchanged. Separately count the **full 69,933-byte history request** if that information set is selected. Passing one does not prove the other fits. A smaller context is acceptable only if it holds all tokens of the selected information set plus output. If the full request exceeds LFM's 32,768 limit, exclude LFM from that lane; do not rescue it by dropping citizen observations or history and call the comparison equal.

A future implementation must also fail closed on truncation. Ollama v0.35.1 defaults `truncate` to true when omitted, and source has message-removal paths; the present adapter's deliberately large bound avoids relying on smaller-context behavior. Reducing `num_ctx` without matching render/count and a no-truncation contract would be unsafe. This report changes neither the request nor its gate. Provider `prompt_eval_count` after generation is valuable reconciliation, **not a preflight sizing method**. [P2, R3]

This measurement cannot make the 9B weight payload smaller or release unrelated applications' RAM. A much tighter token count may remove a large cache reservation yet leave cold host loading blocked. Both conclusions must remain possible.

## 5. Smallest next experiment and explicit approval boundary

### Gate A: vocabulary-only sizing, before model acquisition

Propose a separately approved **offline, zero-generation, zero-service** sizing probe for the two public development-request shapes, including the full-history version. Construct fresh fixture observations through the existing offline/mock path, without accessing saved worlds/reference strategy. Preserve information exactly; do not infer token counts from the byte totals.

**Cost/authorization:** at most the **19.5 MB MIT CPU runtime archive** above if not already available; **zero new weights**, no CUDA/runtime redistributable needed for CPU tokenization. Metadata/template access and a small offline rendering/counting implementation need approval. Exact rendering work is required, not a ready-made replacement hidden in this report. A compatible installed offline tokenizer could avoid that download, but availability was not inspected. Use a unique OS-temp directory, no durable data, no shared service; no machine-wide install or PATH change. Vocabulary/metadata loading has a nonzero, unmeasured host cost; use a fresh sizing-only preflight/stop plan, not an assumption that 1.81 GiB is enough.

**Outputs:** installed artifact identity, exact message/observation/history/schema hashes, rendered-prompt hash, raw token count, output/special-token allowance, smallest covering context, observed peak host use, and any unresolved renderer mismatch. Stop if weight initialization is attempted, count/render identity is uncertain, or the resource stop fires. A failure yields a sizing blocker, not a model score.

**Decision:** if identical information demonstrably fits a materially smaller context, request separately scoped tokenizer/accounting integration and a reviewed resource plan. Do **not** lower the current RAM gate or attempt the installed 9B until fresh admission succeeds. If exact rendering cannot be validated, retain the conservative bound.

### Gate B: one tiny challenger, not all four

If a new model is subsequently authorized, use **H-1B Q8 as the first new-family challenger**. It can test the current 64K first-turn envelope without requiring LFM's 32K eligibility hypothesis. If Gate A instead proves both selected requests fit 32K and Liquid's license is accepted, **LFM Q8 is the lower-download substitution**, not an additional simultaneous test.

- H-1B acquisition: **1.559 GB weights + up to 0.656 GB CUDA archives = ~2.215 GB downloads** before extracted disk space. LFM alternative: **1.246 + 0.656 = ~1.903 GB**. Licenses/templates above; full runtime/driver compatibility and host-load admission first. No training, drafter, classifier or paid API.
- Requires **explicit approval for acquisition, scoped alternate transport/admission work, resource-monitored loading, and bounded inference**. The current admitted transport cannot run either artifact. Keep task-owned lifecycle, single concurrent request, abort authority, teardown verification, token reservations and engine knowledge/dispatch validation. No safety-gate bypass.
- Preserve a separately tested **grammar-constrained primitive JSON lane** matching the current adapter. Native tool round-trip can be a separately budgeted protocol diagnostic; its results are not automatically the same lane. Never parse native Python/XML by executing model-written code.
- After those gates, a proposed initial capability ceiling remains the existing **two public development fixtures, at most three model calls, 256 output tokens/call**, no retry/repair/fallback, paused bodies and exact replay/accounting. Gate A determines the appropriate *supported* context, not an arbitrary 4K/8K slogan. Existing wall/teardown ceilings remain unless separately reviewed.
- Record cold peak RAM, warm working set, GPU weight/cache/buffer allocation and actual CPU/GPU split; input/output token receipts, prefill/decision latency, each generated primitive/result and objective outcome. Reject/truncated attempts count. These two authored opportunities can falsify basic composition, not certify strategic intelligence or sealed-suite generalization.

**No scored plan menu, learned classifier, supplied consequence ranking, prerequisite generator or local survival strategist may choose actions on the candidate's behalf.** The model must identify and compose primitives from the same public mechanics and its citizen's information. Schema decoding and actual dispatcher preconditions are mechanics, not a strategy oracle.

## 6. Native tool use versus the existing JSON lane

The existing primitive adapter sends messages and a constrained **`format` JSON schema**, then decodes one actual command or runner-level advance. It does **not** send native `tools` or a multi-tool assistant transcript. Calling the proposed test “native tool calling” would misstate it. [P2]

- **Native lane:** model-specific template encodes functions and tool results; a compatible parser exposes calls. Granite 4.0/4.1 use JSON inside XML; Granite 4.2/Qwen3.5 use Coder-style XML; LFM uses Python-like call lists. Templates and parsing must round-trip. Native support says nothing about optimal action selection.
- **Constrained-content lane:** a supported grammar restricts syntax/structure of a primitive envelope. The model still chooses which legal primitive, target, quantity and timing to request. It can be perfectly valid and wrong. Native BFCL results are supporting capability evidence, not an expected success rate in this lane.
- A complete supported grammar can protect shape, not strategy, affordability, dated knowledge, dependency ordering or useful termination. Keep the full application validator and real engine results. Do not invisibly fix mistakes or add recipes/menus that contain the answer.

## Primary source register

Accessed **2026-10-08**. Searches were discovery only; numerical/artifact claims above were checked against publisher cards/configs/templates, repository APIs or runtime source. No external benchmark was reproduced locally. Repo metadata was read remotely, not weight payloads.

### Project evidence and adapter

- **[P1]** [Working research](../citizen-intelligence-research.md), section “Installed-local primitive transport and blocked measurement”; [usage](evaluation-harness-usage.md). Prior byte/headroom measurements, zero-generation blocker and bounded history; not new measurements here.
- **[P2]** Local read-only source: `src/evaluation/candidates/local-model.ts`, `ollama-transport.ts`, `src/evaluation/local-service.ts`, `scripts/evaluate-local.ts`. Byte-plus-template/header sizing, reservations, exact-9B admission, schema lane and gates.
- **[P3]** [Previous model report](local-tool-call-models.md), with primary links and retained parser/practitioner counterexamples; [overnight receipts/limits](../spike-2/OVERNIGHT.md).
- **[P4]** [Hardware report](local-classifier-hardware-fit.md): 8 GiB RTX 3070 Ti Laptop, 15.26 GiB usable host, 560.94 driver. Historical measurements only; this task did not remeasure hardware.

### IBM Granite

- **[G1]** [H-1B pinned card](https://huggingface.co/ibm-granite/granite-4.0-h-1b/blob/d18cca4c121edb87d022116d281ce212c9136f57/README.md), [config](https://huggingface.co/ibm-granite/granite-4.0-h-1b/blob/d18cca4c121edb87d022116d281ce212c9136f57/config.json), [template](https://huggingface.co/ibm-granite/granite-4.0-h-1b/blob/d18cca4c121edb87d022116d281ce212c9136f57/chat_template.jinja). Benchmark table distinguishes Dense 1B and H 1B; October 28 release date is the card's declaration, not inferred from repository creation.
- **[G2]** [Granite 4.2 3B pinned card](https://huggingface.co/ibm-granite/granite-4.2-3b/blob/e459acceac81e5fe67c07d9cfc72329a332e7eb1/README.md), [config](https://huggingface.co/ibm-granite/granite-4.2-3b/blob/e459acceac81e5fe67c07d9cfc72329a332e7eb1/config.json), [template](https://huggingface.co/ibm-granite/granite-4.2-3b/blob/e459acceac81e5fe67c07d9cfc72329a332e7eb1/chat_template.jinja). Native 128K versus extended 512K, release/modes/sampling, BFCL-v4 and separate τ³ rows. Do not import commented-out training placeholders as established methodology.
- **[G3]** Official artifacts/API metadata: [H-1B GGUF pinned tree](https://huggingface.co/ibm-granite/granite-4.0-h-1b-GGUF/tree/c2cb1972f511add21f3bae244990b8ff3a3ffb23); [4.2 GGUF pinned tree](https://huggingface.co/ibm-granite/granite-4.2-3b-GGUF/tree/c40945d71cd90f249a56985e8155551a9188dc30); [dense 4.0 config](https://huggingface.co/ibm-granite/granite-4.0-1b/blob/6a7381ba1f54d684ff508d991aeb7dc580157103/config.json); [dense GGUF tree](https://huggingface.co/ibm-granite/granite-4.0-1b-GGUF/tree/b27c2fe3f211b7f44e80fa620177aea371099aaa). Size/LFS fields obtained from `https://huggingface.co/api/models/<repo>/tree/<revision>`.
- **[G4]** [Granite 4.1 3B card/config/template](https://huggingface.co/ibm-granite/granite-4.1-3b/tree/c0650403e44e78ec0262dab1c90914c65b196c4e); [official GGUF](https://huggingface.co/ibm-granite/granite-4.1-3b-GGUF/tree/ab4701481089b58a082ef63cc1cee738887293ff). Non-thinking fallback, not selected for automatic acquisition.

### Retained models and exclusions

- **[L1]** [LFM2.5 pinned card/config](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct/tree/0f604ada3f766f9f257460c4c9f0b5d6f69d431b), including `chat_template.jinja`; documented 32K and custom-handler benchmark methodology.
- **[L2]** [Pinned LFM LICENSE](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct/blob/0f604ada3f766f9f257460c4c9f0b5d6f69d431b/LICENSE), sections 1/5 and notices.
- **[L3]** [Official LFM GGUF tree](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/tree/8ed288026e23958ad9dfa92d53ed773a8eee7125).
- **[Q1]** [Qwen3.5-4B pinned card/config/tokenizer template](https://huggingface.co/Qwen/Qwen3.5-4B/tree/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a).
- **[Q2]** [Unsloth Qwen GGUF pinned tree](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/tree/e87f176479d0855a907a41277aca2f8ee7a09523).
- **[X1]** [SmolLM3 card/config](https://huggingface.co/HuggingFaceTB/SmolLM3-3B/tree/a07cc9a04f16550a088caea529712d1d335b0ac1). BFCL table's unspecified version, non-thinking metrics, XML/Python modes and runtime recommendations.
- **[X2]** [Phi-4-mini card/config](https://huggingface.co/microsoft/Phi-4-mini-instruct/tree/cfbefacb99257ffa30c83adab238a50856ac3083). MIT, CoT benchmarks, tool format and publisher hallucination counterexample.

### Runtime and exact counting

- **[R1]** llama.cpp b11490 source: [server contracts](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/tools/server/README.md), [chat/template detection](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/common/chat.cpp), [hybrid Granite](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/src/models/granite-hybrid.cpp), [dense Granite](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/src/models/granite.cpp), [function-call guide](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/docs/function-calling.md). Support source exists; actual Windows execution/template parsing remains untested.
- **[R2]** [b11490 release assets](https://github.com/ggml-org/llama.cpp/releases/tag/b11490), [release API size/digest metadata](https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b11490), [MIT license](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/LICENSE). `/releases/latest` returned a different release tag during scouting; the recommendation deliberately pins the verified **b11490 assets**, not that moving alias.
- **[R3]** Ollama **v0.35.1** [prompt rendering/counting](https://github.com/ollama/ollama/blob/v0.35.1/server/prompt.go), [routes](https://github.com/ollama/ollama/blob/v0.35.1/server/routes.go), [runner interface](https://github.com/ollama/ollama/blob/v0.35.1/llm/server.go). Current installed rendering mode/flags must still be verified before substituting a smaller reservation.
- **[R4]** b11490 [vocabulary-only tokenizer tool](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/tools/tokenize/tokenize.cpp), [model parameter contract](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/include/llama.h), [context initialization guards](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/src/llama-context.cpp).

**Unresolved:** exact prompt tokens for each artifact/template; no-truncation/render identity; candidate-native versus grammar-lane behavior; quantized/non-thinking short-output reasoning; cold host peak/warm residency/VRAM split and prefill latency on this laptop; scoped alternate-transport admission. Research supports the next gate, not a feasibility or model-quality promise.

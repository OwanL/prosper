# Local models for reliable tool calling on this laptop

Research-only assessment, **8 October 2026**. Scope: selecting candidates for a later bounded comparison, not selecting Prosper's architecture. Only this report was edited. No packages or weights were installed/downloaded, no inference or services were run, and no machine configuration or durable-world data was accessed. Remote reads covered documentation, source, model metadata and community reports. Hardware and previous measurements come from the [hardware report](local-classifier-hardware-fit.md), [classifier experiment](local-classifier-feasibility.md), and [current research direction](../citizen-intelligence-research.md).

## Bottom line

There is **no supported “never makes a schema/tool mistake” model recommendation**. A compatible constrained decoder can prevent many structural errors, but correct tool choice, grounded arguments, dependencies and recovery remain separate model capabilities. Real users report both useful compact agents and severe failures; several documented failures were parsers/templates rather than an incapable model.

For later comparison, retain the installed **Qwen3.5 9B** as the reference and prioritize these **three alternatives**:

1. **Qwen3-4B-Instruct-2507, Q6_K GGUF**: useful older, non-thinking general-model comparator. More straightforward low-latency behavior than a thinking model, publisher tool-use evidence, and substantial memory savings. Must fix/check the known template/reasoning-detection trap. Do not substitute original `Qwen3-4B` or its Thinking-2507 sibling.
2. **Qwen3.5-4B, Q6_K text-only GGUF**: tests whether the existing family at smaller size and higher weight precision is sufficient. Its hybrid attention saves KV memory. Publisher agent scores are promising but do not establish short-context, non-thinking, quantized reliability. Native tool parsing needs its own check, separate from Prosper's existing constrained JSON path.
3. **LFM2.5-1.2B-Instruct, official Q8_0 GGUF**: strongest first *very small* entry on deployment grounds, with explicit native tool training/format and the best co-residency margin. Liquid now recommends it over LFM2-1.2B-Tool. This is **not proof it beats that older specialist**. The older **LFM2-1.2B-Tool Q8_0** has an unusually relevant positive user experiment and is the first substitution if the maintained model disappoints or the comparison specifically targets specialist versus generalist.

**FunctionGemma 270M is a training-oriented reserve, not a plug-in general agent recommendation.** Its excellent size does not offset the publisher's explicit multi-step/multi-turn limitations and weak base-model evidence. Any fine-tuning would be a separately approved research project, with data acquisition and held-out schemas counted as costs.

These recommendations deliberately do not presume that newer, larger, or a higher aggregate benchmark score is better. No finalist has been locally tested in this investigation. Keep the candidate count bounded rather than adding every promising 1–8B release.

## 1. What “reliable tool calling” must mean

| Layer | Example failure | What can address it |
|---|---|---|
| Transport/parser | Correct native call appears as assistant prose, or second streamed call is dropped | Matching model/template/parser; protocol regression tests |
| JSON syntax | Missing quote, unfinished array | Grammar-constrained decoding for a completed output; still handle truncation/cancellation |
| Schema adherence | Unknown field, wrong type, missing required argument | Supported JSON-schema grammar plus independent full validator |
| Correct function and arguments | Legal `sell` call chooses the wrong item, amount, citizen or unit | Grounded inference and domain validation; grammar alone cannot solve it |
| Sequencing | Spends proceeds before a sale, uses an ID before querying it, parallelizes dependent actions | Result-aware multi-step execution and dependency reasoning |
| Recovery and termination | Repeats an unfunded action, ignores a changed quote, loops after completion | Interpret actual tool errors/results, revise or abstain, stop within a bounded budget |
| Useful strategy | Executes a syntactically perfect but economically harmful plan | Outcome evaluation under the citizen's information and preferences |

A function caller may be excellent at mapping a **supplied intent** to a tool yet poor at discovering what should be done. Conversely, a good decision can be lost by a broken tool adapter. Do not attribute either to the other. “Multiple” available functions, multiple independent calls in one reply, and dependent multi-step calls are different tests.

Prosper's current policy route is **schema-constrained JSON representing `set_policy`**, not evidence of a native multi-tool agent loop. Prior Qwen receipts include structurally accepted but poor policies. The observed known-person validation mismatch also means historical rejections cannot all be credited to model hallucination. See [overnight evidence](../spike-2/OVERNIGHT.md) and [working research](../citizen-intelligence-research.md).

## 2. Six-model shortlist: artifacts, licensing and runtime

Model/quantization names below are intentional. HF Safetensors checkpoints exist for all six; they are not the recommended full-precision resident configuration for the 4B/9B models. File sizes are remote metadata, **not resident VRAM**. GiB is 2^30 bytes; published GB/MB often use decimal units.

| Exact candidate | Download/license | Practical Windows route and tool protocol | Disposition |
|---|---|---|---|
| **Qwen3.5-9B** | Apache-2.0. Existing Ollama `qwen3.5:9b`; community GGUF Q4_K_M/Q6_K/Q8_0. Text Q4_K_M ~5.29 GiB; Ollama catalog payload includes a separate vision component | Existing Ollama supports this family; current llama.cpp supports its GGUF. Native Qwen3.5 calls use the **Qwen3-Coder-style XML** parser, not ordinary Qwen3 JSON-in-`<tool_call>`. Thinking-off and parser behavior are distinct settings | Keep installed baseline; not a good Laya co-resident candidate under observed pressure |
| **Qwen3.5-4B** | Apache-2.0. Unsloth GGUF Q4_K_M **2,740,937,888 B**, Q6_K **3,525,956,768 B**, Q8_0 **4,482,403,488 B** | Ollama `qwen3.5:4b` exists; text-only llama.cpp avoids loading a vision projector. Same family parser caution. Official template supports `enable_thinking:false`; `/nothink` is not officially supported for 3.5 | Finalist; use explicit non-thinking and modest context initially |
| **Qwen3-4B-Instruct-2507** | Apache-2.0. Unsloth GGUF Q4_K_M **2,497,281,120 B**, Q6_K **3,306,261,600 B**, Q8_0 **4,280,405,600 B** | llama.cpp tool-aware Jinja, JSON tool call inside native Qwen delimiters. GGUF import into Ollama is a possible route, but an exact built-in 2507 tag/template was not verified here. Generic `qwen3:4b` is not an identity guarantee | Finalist; non-thinking-only model, not merely original Qwen3 with thinking disabled |
| **LFM2-1.2B-Tool** | **LFM Open License v1.0**, not Apache/MIT. Official GGUF Q4_K_M **730,894,048 B**, Q6_K **962,842,336 B**, Q8_0 **1,246,252,768 B**, F16 **2,343,325,408 B** | Publisher documents llama.cpp. Native output is a list of **Python-style calls** within `<|tool_call_start|>`/`<|tool_call_end|>`; special tool-list/response tokens matter. Not standard JSON. No exact official Ollama Tool tag verified | Relevant purpose-trained challenger, but publisher now deprecates it in favor of LFM2.5 Instruct |
| **LFM2.5-1.2B-Instruct** | Same LFM license. Official GGUF Q4_K_M **730,895,168 B**, Q6_K **962,843,456 B**, Q8_0 **1,246,253,888 B**, F16/BF16 **2,343,326,528 B**. Official ONNX also exists; not locally assessed | Official llama.cpp route. Python-style native calls by default, JSON can be requested; correct parser still necessary. **Ollama `lfm2.5:latest` currently means 8B, not this model.** Inspected official tags lacked a non-thinking 1.2B entry; use the exact GGUF rather than that alias | Finalist; no speculative decoder, ONNX conversion or custom proxy required for the initial proposal |
| **google/functiongemma-270m-it** | **Gemma Terms**, not Apache-2.0. Official HF weights require acceptance/access; metadata readable but unauthenticated config request returned 401. Unsloth GGUF Q8_0 **291,558,624 B**, Q4_K_M **253,127,904 B**, BF16 **542,847,936 B** | Official **Ollama ≥0.13.5** native-tool example is the clearest supported route. GGUF/llama.cpp model loading exists, but do not assume its generic tool handler preserves FunctionGemma's unusual native format. Exact deployed parser requires verification | Tiny specialist, mainly a future domain-fine-tuning comparator |

**License implications:** Qwen cards declare Apache-2.0. Both Liquid LICENSE files permit local use/modification/distribution subject to notices and a commercial-revenue threshold defined as **US$10 million**; commercial use beyond the license's threshold needs separate permission. Do not describe them as unrestricted Apache-style open source. FunctionGemma uses Gemma Terms and its incorporated prohibited-use policy, with downstream terms/notices and modification markings; local research and commercial use are not categorically prohibited. Gemma 4's different license does not change FunctionGemma's Gemma 3-based terms. This is a licensing identification, not a legal audit. [M1–M8]

### Artifact pins checked on 2026-10-08

These are remote repository revisions, not locally downloaded artifacts or the digest of the user's installed Ollama model. Pin the actual filename/hash/template at a later approved test. Repository creation dates are **not** necessarily public release dates.

| Repository | Revision |
|---|---|
| `Qwen/Qwen3.5-9B` | `c202236235762e1c871ad0ccb60c8ee5ba337b9a` |
| `Qwen/Qwen3.5-4B` | `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a` |
| `Qwen/Qwen3-4B-Instruct-2507` | `cdbee75f17c01a7cc42f958dc650907174af0554` |
| `LiquidAI/LFM2-1.2B-Tool` | `6d24c6b7471fcbcec084935e377a5302f4b84389` |
| `LiquidAI/LFM2.5-1.2B-Instruct` | `0f604ada3f766f9f257460c4c9f0b5d6f69d431b` |
| `google/functiongemma-270m-it` | `39eccb091651513a5dfb56892d3714c1b5b8276c` |
| `unsloth/Qwen3.5-9B-GGUF` | `3885219b6810b007914f3a7950a8d1b469d598a5` |
| `unsloth/Qwen3.5-4B-GGUF` | `e87f176479d0855a907a41277aca2f8ee7a09523` |
| `unsloth/Qwen3-4B-Instruct-2507-GGUF` | `a06e946bb6b655725eafa393f4a9745d460374c9` |
| `LiquidAI/LFM2-1.2B-Tool-GGUF` | `e7ec4149433c75d4bb53a0742ee1ebde7fcbd183` |
| `LiquidAI/LFM2.5-1.2B-Instruct-GGUF` | `8ed288026e23958ad9dfa92d53ed773a8eee7125` |
| `unsloth/functiongemma-270m-it-GGUF` | `1de0f7fc7cae0062012c2e91ef02e642c161aa57` |

Metadata source pattern: `https://huggingface.co/api/models/<repository>` and `/tree/main`; pinned file pattern: `https://huggingface.co/<repository>/blob/<revision>/<filename>`. GGUFs by Unsloth are third-party conversions, not identical artifacts to publisher benchmark weights. Ollama tags are mutable and may bundle projector/template changes: record the installed digest rather than assuming today's catalog matches the baseline.

## 3. Evidence: what is promising, and what contradicts it

### Publisher measurements, not local or independently reproduced rankings

| Model | Published evidence | Crucial limit |
|---|---|---|
| Qwen3.5 9B / 4B | Model card **BFCL-V4 66.1 / 50.3**; TAU2 **79.1 / 79.9** | Thinking/token budgets, benchmark harness and full-precision results do not establish 4K/8K non-thinking GGUF behavior. Qwen describes an airline-task fix in its TAU2 setup. The smaller model winning that aggregate is not proof of general superiority |
| Qwen3-4B-Instruct-2507 | **BFCL-v3 61.9**, TAU2 retail **40.4**, airline **24.0**, telecom **13.2** | Material remaining failures. Do not compare its BFCL-v3 61.9 directly to Qwen3.5 BFCL-v4 50.3 |
| LFM2.5-1.2B-Instruct | **BFCL-v3 49.12**, weighted aggregate using a **custom Liquid handler**; publisher recommends agentic/extraction/RAG tasks | Not evidence that a generic OpenAI proxy reproduces that score. Card explicitly does **not** recommend knowledge-intensive tasks/programming. Its own comparison gives Granite 4.0-1B a higher BFCL-v3 52.43, so even publisher data does not establish a universal small-model win |
| LFM2-1.2B-Tool | Purpose-trained, non-thinking; publisher claims a contamination-resistant **proprietary** tool benchmark; recommends temperature 0 and supports multi-turn conversations | Proprietary benchmark construction and held-out-schema results were not available for independent reproduction; no numeric chart claims imported here |
| FunctionGemma 270M | Google 0-shot: BFCL Simple **61.6**, Multiple **63.5**, Parallel **39.0**, Parallel Multiple **29.5**; Live Simple **36.2**, Live Multiple **25.7**, Live Parallel **22.9**, Live Parallel Multiple **20.8**. Mobile Actions **58% → 85%** after task-specific tuning | BFCL version/sample counts not supplied in inspected card. Official formatting guide says it was trained for **single-turn and independent parallel calls**, **not explicitly chaining or multi-turn**. Intended as a foundation for task-specific fine-tuning |

Sources: [M1–M6]. FunctionGemma model-card page last updated **2026-04-16**; Qwen 2507 is the named 2025 checkpoint. Liquid 2.5 source inspected at its pinned 2026 revision. Keep benchmark versions visible; none of these aggregate scores is a percentage guarantee against schema mistakes.

**Reproducible evaluation infrastructure exists, but that is not an independently reproduced score for these exact quants.** BFCL's public framework distinguishes AST/function/argument checks from later stateful execution. BFCL V3 (released **2024-09-19**, article updated **2024-12-10**) tests custom APIs, prerequisite dependencies, missing functions/parameters and long histories; multi-turn success requires backend state and necessary execution-path checks at every turn. Missing functions introduced later are not proven absent from training. V4 adds agentic evaluation, so ranking across versions is unsafe. A public suite is useful for later diagnostics, not proof of unseen Prosper-schema generalization. [E1]

### Actual practitioner evidence, including reproducibility checks

**A. LFM2-Tool has a real, relevant positive report, but not a clean model ranking.**

A LocalLLaMA browser-agent report has a retained **2026-04-10 snapshot**; its companion results date testing **2026-04-03 to 2026-04-09**, on **Mac Mini M4 16GB**, llama.cpp **b8640**, GUA_Blazor/.NET 10/Playwright and optional Falcon Perception. The author reports **LFM2-1.2B-Tool Q8_0 with slim instructions: 4.5/6**, ~76 generated tokens/sec. Tasks include navigate/read, search, form filling, vision and CAPTCHA. The model's reported 1.25 GB is not the table's 2.75 GB model-plus-vision stack. Neither speed nor memory transfers directly to this NVIDIA laptop. [E2]

This is stronger than an unsupported recommendation because tasks, scripts and per-task summaries are public. It is still **partially reproducible community evidence**, not a controlled independent evaluation:

- Tools were reduced **26 → 8** and prompts shortened. The Reddit snapshot says **3.0 → 4.5**, while the companion README says **4.0 → 4.5**. The direction is plausible; the exact improvement is inconsistent.
- The pinned `results_summary.json` gives LFM2 four clean stops; the form task receives half credit and does not stop. A 4.5/6 aggregate does not mean flawless chaining/recovery.
- `bench/run_suite.sh` runs one attempt per live website, has no correctness grader, overwrites most per-task logs, and lacks model hashes/seeds. `bench/bench_quant.py` is only a five-request speed/tool-presence smoke test, not the six-task agent evaluation. The README advertises some filenames that are absent from the actual inventory.
- The summary's leading Gemma row reports 5.0 overall but its listed task scores sum to 4.5. Treat headline ranks cautiously.
- The FunctionGemma **Q8 0/6, “infinite loop”** claim is in the README but not that four-model summary. It is a useful failure report, not a reproduced estimate of all FunctionGemma deployments.
- Its **LFM2.5-Nova Q4 0/6** entry is a different derivative with a reported 4K-context problem, **not** evidence that official LFM2.5-1.2B-Instruct loses to the older Tool model.

This supports keeping the older specialist in view and testing prompt/tool-set sensitivity. It does not justify importing the author's two-model/vision routing architecture into Prosper.

**B. Qwen user failures expose the runtime as an important variable.**

- **2026-03-20, llama.cpp #20809:** `unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M`, Windows Vulkan **b8429 / 1e6453457**. A minimal calculator call was classified as reasoning, leaving no parsed `tool_calls`. `--reasoning off` fixed the same reproduction. Maintainer advised updating/correcting template and demonstrated **b8444**. Issue closed to consolidate discussion, not proof that every later build/template combination is fixed. This is concrete positive evidence that an apparent small-model failure can be repaired without changing the model. [E3]
- **2026-01-04, llama.cpp #18591:** original Qwen3-4B among FP16/BF16 tests, **b7622** versus reportedly working **b7607**. Streamed multiple calls were collapsed to index 0 or only the first appeared. Closed stale on March 1; June 11 commenter reports resolution in a newer unspecified build. Not a 2507-specific model-quality result, but a reason to check multiple-call transport separately. [E4]
- **2026-03-09, Ollama #14745:** `qwen3.5:9b`, **Q4_K_M**, Ollama **0.17.7**, OpenCode **1.2.24**, user reports literal XML instead of parsed tools. Others report success after downgrade to **0.17.5**; issue closed March 27 via **#15022**. No exact fixed release was established here. The local hardware report's **Ollama 0.35.1** is later; do **not** recommend downgrading it based on this historical issue. Re-test its behavior instead. [E5]

Indexed Reddit discussion also includes enthusiastic Qwen3-4B iGPU-agent use and successful Qwen3.5-4B assistants, alongside loops and missing tool calls. Direct extraction of those Reddit pages failed; exact model/runtime pins and reliability denominators were not established. They are discovery leads, not counted trials or the basis for a performance promise. [E6]

**C. FunctionGemma can improve greatly after specialization, but that is a different purchase in data/engineering.**

Distil Labs reports **base → tuned** exact tool-call equivalence of **38.82 → 96.71%** (smart home), **23.35 → 90.86%** (banking), **9.90 → 96.04%** (shell). The article links datasets and released tuned weights; shell uses **5,000 synthetic training examples** and a simplified BFCL-derived task with **one call per turn**. This is a vendor's own, **closed-book, task-specific** experiment, not independent verification or unseen-schema capability. Its exact-match metric compares parsed dictionaries, not complete environment outcomes. The inspected article lacked evaluation counts/split details and matching hardware/timing methodology. Promoted per-conversation success projections are not measured multi-turn trajectory success. [E7]

The promise is cheap *specialized* execution, not a 270M model spontaneously replacing general planning. A separate Reddit complaint specifies `functiongemma:270m-it-fp16` and poor results on an MCP toolset that reportedly worked with Qwen3:1.7b, but the direct page could not be read and only indexed excerpts were available. Treat it as a counterexample lead, not a controlled head-to-head. [E6]

### Template and quantization traps by model

- **Qwen3 2507:** non-thinking checkpoint must not be prefixed with an open thinking block by a stale GGUF template. Preserve native tool messages/history and test both streaming and nonstreaming transport. Weight Q6 does not fix a wrong template.
- **Qwen3.5:** use its Coder-style XML parser, not the previous Qwen3 parser. A custom Safetensors import or different runtime route may not inherit registry template/parser metadata. Thinking off does not turn native tools into JSON-schema-constrained policy output. Publisher scores do not establish Q4-to-Q6 tool-accuracy differences.
- **LFM2/2.5:** native Python-like arguments include Python booleans/null/string quoting, which a JSON-only parser mishandles. llama.cpp **PR #24178, merged 2026-06-05**, unified the parsers, converted `True/False/None`, accepted JSON-cased equivalents, supported single-quoted strings and dotted function names. Use a build containing those fixes; no exact first packaged release was verified. This is **not** the unrelated July 2025 parallel-slot LFM crash, nor a verified March 31 fix. The old Tool model also has tool-list delimiters missing from 2.5's usual system format. [E8]
- **FunctionGemma:** native strings use `<escape>`, not ordinary JSON quoting; calls use `<start_function_call>call:name{...}<end_function_call>`. Tools belong in the initial developer turn with the instruction **“You are a model that can do function calling with the following functions”**. Its format also defines tool-response delimiters and stop behavior. Replacing this with generic Gemma chat/JSON prompting changes the tested protocol. [M6]
- **All models:** benchmark weight quantization separately from **KV quantization**. llama.cpp explicitly warns that extreme KV quantization such as `q4_0` can substantially degrade tool calling. Favor Q6/Q8 weights where cheap, initially FP16 KV, then assess Q8 KV only if memory demands it. No source reviewed establishes that a smaller Q6 model necessarily beats a larger Q4 model on these tasks. [R1]

## 4. Constrained decoding: capabilities and limits

**Native tools** means a tool-trained chat protocol, a runtime that renders tool definitions/messages in that protocol, and a parser that returns `tool_calls`. The application still executes calls and returns observations. **JSON prompting** merely asks for JSON. **Schema-constrained JSON** additionally restricts tokens through a grammar. These are not interchangeable, and native-tool support alone is not a guarantee of full JSON Schema enforcement.

- **llama.cpp:** documented OpenAI-compatible tools through tool-aware Jinja; recognized native formats and a generic fallback. A generic fallback can cost more tokens and change the protocol. Check `/props` template metadata and actual response parsing. Its guide says `--jinja`; current server defaults can differ by build. Multiple/parallel calls must be explicitly enabled where supported.
- **Ollama:** `/api/chat` supports tools; return the complete assistant tool-call message followed by tool results. Local structured output accepts a JSON schema in `format`; `format:"json"` constrains syntax, not a particular schema. The latter response is structured **content**, not automatically a native call. Official examples still validate it with Pydantic/Zod.
- **Schema-to-grammar subset:** llama.cpp documents unsupported features that can be silently skipped. Numeric min/max currently applies to **integers**, not general numbers; limitations include mixing object properties with `anyOf`/`oneOf`, nested references/`prefixItems`, `uniqueItems`, conditionals and several pattern/containment features. `additionalProperties` defaults differ from JSON Schema. This is not an exhaustive spec and should be checked against the selected build. Ollama does not publish an equivalent complete keyword matrix; do not assume every llama.cpp limitation maps identically to its backend/version.
- **Prompt and grammar both matter:** a response schema may constrain decoding without teaching the model field meanings; llama.cpp does not automatically inject response schemas into the prompt. Supply clear semantics too. Constraining an enum can prevent invented tool names yet force a wrong available choice unless abstention is representable.
- **Guarantee boundary:** a supported grammar can ensure a **completed** sequence belongs to its language. Token/context exhaustion, interruption, parser bugs and unsupported keywords remain failure paths. A perfectly typed `price:96` does not establish correct tier units, current affordability or useful pricing. Dynamic enums can restrict IDs to known entities, but that is supplied grounding, not discovered knowledge.

Prefer a simple schema initially, preserve application-side full validation and actual action preconditions, and count rejected/truncated attempts rather than repairing them invisibly. This is evaluation hygiene, not a recommendation to remove the citizen's strategic authority. Sources [R1–R4].

## 5. Realistic memory and co-residency

Actual machine: **RTX 3070 Ti Laptop 8,192 MiB VRAM**, Ryzen **6900HX (8 cores/16 threads)**, **15.26 GiB usable physical RAM**, Windows, NVIDIA driver **560.94**. The earlier busy snapshot had only **467 MiB GPU / ~1.20 GiB host RAM free**. The subsequent isolated classifier run started near **7.48 GiB GPU / ~4 GiB host RAM free**. Those are different transient states, not an available budget today. This task did not remeasure or unload anything.

### KV calculation, not advertised maximum context

For ordinary grouped-query attention at FP16:

`KV bytes ≈ tokens × full-attention layers × KV heads × head dimension × 2 (K,V) × 2 bytes`.

At one sequence, excluding buffers/state/alignment:

| Model | Config-derived attention cache at 4K / 8K tokens | Other state |
|---|---|---|
| Qwen3.5 4B and 9B | 8 full-attention layers × 4 KV heads × 256: **0.125 / 0.250 GiB** | 24 linear-attention layers need recurrent state and runtime-specific scratch; not zero-memory attention |
| Qwen3-4B-Instruct-2507 | 36 layers × 8 KV heads × 128: **0.5625 / 1.125 GiB** | Ordinary buffers, graph/batch allocations |
| Both LFM 1.2B models | 6 attention layers × 8 KV heads × 64: **0.0469 / 0.0938 GiB** | 10 short-convolution blocks plus runtime state |
| FunctionGemma | With window-aware allocation, 3 full + 15 sliding-512 layers, 1 KV head × 256: about **0.019 / 0.031 GiB** | If runtime reserves full context for every layer, about **0.070 / 0.141 GiB** instead |

Configs were inspected remotely; FunctionGemma architecture from the public Unsloth config because the official file was gated. Allocated cache can differ from this active-state arithmetic. Multiple parallel sequences/slots and large prefill batches add memory. LFM cards document **32K** supported context even though configs contain `max_position_embeddings:128000`; use the documented limit, not the largest metadata number. Qwen's 256K/native or extended context is not a recommendation for this 8 GiB machine.

### Planning budgets, **not measured model peaks**

Below assumes one request, 4K–8K total context, text-only llama.cpp CUDA, no speculative drafter, and weights mostly GPU-resident. Process GPU allowances include estimated KV/state/buffers but **exclude desktop/other models**. Exact batching, runtime and allocations can exceed them.

| Configuration | Weight file floor | Planning GPU allowance | Practical fit |
|---|---:|---:|---|
| Qwen3.5 9B Q4_K_M | ~5.29 GiB text weights | **6.3–8+ GiB**; projector can add more | Alone is plausible and already used; baseline nearly fills this GPU. Not a Laya-sharing plan |
| Qwen3.5 4B Q6_K | ~3.28 GiB | **4.3–5.8 GiB** | Comfortable alone, plausible with GLiClass; Laya combination marginal and must be measured |
| Qwen3 4B 2507 Q6_K | ~3.08 GiB | **4.2–5.8 GiB** | Good alone; 8K cache meaningfully reduces co-residency margin |
| Either LFM 1.2B Q8_0 | ~1.16 GiB | **1.6–2.5 GiB** | Best plausible shared-GPU margin with one Laya checkpoint |
| FunctionGemma Q8_0 | ~0.272 GiB | **0.6–1.3 GiB** | Easy weight fit; capability/integration, not capacity, is the primary issue |

Laya typed-decisions **actually** used **2.43 GB CUDA allocated / 2.62 GB reserved**; whole-GPU usage increased by about **2.63 GiB** over baseline in its separate process. It also reached **3.27 GB resident working set** and reduced available RAM to **1.17 GB**. GLiClass edge's whole-GPU increase was only about **0.33 GiB**, with **1.25 GB sampled process working set**. These are the prior short-input runs, not joint-load peaks. Do not use Laya's ~843 MB download as its resident memory cost.

Consequences:

- **LFM Q8 + one Laya is plausible on GPU**, but host loading headroom must be gated first. **4B Q6 + Laya may fit only at the low end**, especially with desktop use and transient buffers; it is not a safe unconditional recommendation. Smaller Q4/4K could help, but changes the quality comparison.
- **4B + GLiClass edge is substantially more plausible**. Even the edge classifier should not be added blindly to the currently nearly-full 9B setup. CPU placement could avoid VRAM conflict; classifier CPU latency and joint CPU contention were not measured by the CUDA experiment.
- mmap/GGUF does not eliminate host RAM demand. OS, browser, Prosper, pinned staging buffers, file pages and potentially two framework processes share 15.26 GiB. Avoid interpreting large virtual mappings/private commitment as physical use, but also avoid assuming all mapped/offloaded pages cost nothing.
- **CPU offload is a feasibility escape, not a latency promise.** Layer offload may fit a bigger model but serial CPU work, PCIe transfers, laptop power limits, prompt prefill and paging can dominate. No supported tokens/sec estimate exists for this 6900HX workload. LFM's published AMD/mobile speed and the user's M4 report do not establish this laptop's timings. Pure CPU LFM is worth a later separate measurement if GPU sharing matters; not an assumed fast fallback.
- Existing Qwen policy waits of several seconds are measured end-to-end on prior prompts, not a native-tool throughput benchmark. Compare time-to-first-valid-call and completed sequences, not decode tok/s alone.

## 6. What a later bounded comparison should discriminate

Proposal only; this report authorizes no downloads, inference, training, production edits or workload unloading.

1. **Identity/adapter gate:** pin runtime build, exact quant/hash, chat template, parser, context, KV precision and thinking settings. One simple valid call, a no-call case and two independent calls must round-trip before scoring model reasoning. Use a build containing relevant fixes; do not chase “latest” mid-comparison.
2. **Compare the three finalists against the existing 9B reference**, sequentially, with the same information, action authority, total context/output budget and stopping rules. First isolate each model; measure co-residency only after its single-model resource/quality gate. LFM2-Tool is a bounded substitute, not an automatic seventh experiment.
3. **Separate native and constrained-envelope lanes.** Where supported, evaluate native `tools` and a simple grammar-constrained `{function, arguments}` envelope separately. Do not credit decoder-enforced syntax as learned schema competence. Do not silently coerce argument types, invent defaults, retry or repair names.
4. **Held-out interface cases:** unfamiliar renamed tools/fields, reordered schema properties/options, similar distracting functions, optional/null fields, escaped text, arrays, enums, integer boundaries and an unsupported-schema diagnostic. Hold some schema families out of all prompt examples/tuning, not just new user paraphrases.
5. **Execution cases:** choose the right tool or no tool; produce multiple independent calls; query an unknown ID then use the returned ID; buy inputs only if funded; handle a changed price/missing prerequisite/rejected call; carry information over 3–5 turns; terminate instead of repeating a completed action. Score generated alternatives separately from ranking supplied plans.
6. **Report separate denominators:** transport parsing, completed JSON, full-schema validity, tool/argument semantic correctness, first-attempt task success, success with one explicitly budgeted recovery, call count/loops, and environment outcome. Record failures and aborted attempts. Repeated identical prompts are not independent tasks.
7. **Resource outcomes:** cold load and warm p50/p95 latency, prefill/decode tokens, first valid call and full sequence time, peak system RAM and GPU use, actual device/offload split, and impact with Prosper/classifier activity. A larger context or retries cannot be free assistance for one model.

A compact test can reject an unsuitable candidate, not certify no mistakes. As an illustration, even **zero failures in 100 independent representative trials** leaves an approximate 95% upper failure-rate bound of **3%** (“rule of three”); templated/repeated trials are less informative. Benchmarks do not eliminate ongoing validation.

## Source register and evidence boundaries

All links inspected or searched **2026-10-08**. Moving pages are access-dated; artifact revisions above identify the chosen weights/metadata. No local reproduction of external benchmarks occurred. Search synthesis was treated as a lead: an initially suggested March 31 LFM parser fix was not supported by its cited issue; the actual relevant merged PR is documented above.

### Models, licensing, downloads

- **[M1]** Qwen3.5 [9B card/config](https://huggingface.co/Qwen/Qwen3.5-9B), [4B card/config](https://huggingface.co/Qwen/Qwen3.5-4B); [9B GGUF](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF), [4B GGUF](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF); [Ollama 9B](https://ollama.com/library/qwen3.5:9b), [4B](https://ollama.com/library/qwen3.5:4b).
- **[M2]** [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507), [GGUF](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF). Native non-thinking, BFCL-v3/TAU results and Qwen-Agent guidance.
- **[M3]** [LFM2-1.2B-Tool](https://huggingface.co/LiquidAI/LFM2-1.2B-Tool), [official GGUF](https://huggingface.co/LiquidAI/LFM2-1.2B-Tool-GGUF), [current deprecation recommendation](https://docs.liquid.ai/lfm/models/lfm2-1.2b-tool).
- **[M4]** [LFM2.5-1.2B-Instruct card](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct), [official GGUF](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF), [Ollama lfm2.5 tags](https://ollama.com/library/lfm2.5/tags). Card gives BFCL-v3 custom-handler methodology and task limitations.
- **[M5]** Liquid [Tool LICENSE](https://huggingface.co/LiquidAI/LFM2-1.2B-Tool/blob/main/LICENSE), [2.5 LICENSE](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct/blob/main/LICENSE), LFM Open License v1.0.
- **[M6]** Google [FunctionGemma model card](https://ai.google.dev/gemma/docs/functiongemma/model_card), [formatting/limits](https://ai.google.dev/gemma/docs/functiongemma/formatting-and-best-practices), [official HF model](https://huggingface.co/google/functiongemma-270m-it).
- **[M7]** [FunctionGemma GGUF](https://huggingface.co/unsloth/functiongemma-270m-it-GGUF), [Ollama native examples/minimum version](https://ollama.com/library/functiongemma).
- **[M8]** [Gemma Terms](https://ai.google.dev/gemma/terms), modified 2026-04-01; do not confuse documentation/code-example licenses or Gemma 4 terms with these weights.

### Evaluation and user experience

- **[E1]** [BFCL V3 methodology](https://gorilla.cs.berkeley.edu/blogs/13_bfcl_v3_multi_turn.html), [V4 leaderboard/methodology links](https://shishirpatil.github.io/gorilla/leaderboard.html), [public evaluation code](https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard). Reproducible framework, not reproduced finalist scores.
- **[E2]** [Original browser-agent Reddit thread](https://www.reddit.com/r/LocalLLaMA/comments/1shfhxc/making_small_models_actually_browse_the_web/), [readable April 10 snapshot](https://reddit.sentinel-team.org/posts/1shfhxc/snapshots/2026-04-10T16%3A31%3A22.888624Z). [Companion repository, revision `221ca5c497d3b9654de841acab1a05306a3de82f`](https://huggingface.co/Manojb/CUA_benchmark_local_small_models/tree/221ca5c497d3b9654de841acab1a05306a3de82f): actual `bench/results_summary.json`, `bench/run_suite.sh`, `bench/bench_quant.py` inspected. Partial community reproduction, inconsistent aggregate reporting, not an independent controlled ranking.
- **[E3]** [llama.cpp #20809](https://github.com/ggml-org/llama.cpp/issues/20809), 2026-03-20, versioned Qwen3-2507 parser reproduction and workaround.
- **[E4]** [llama.cpp #18591](https://github.com/ggml-org/llama.cpp/issues/18591), 2026-01-04, streamed multi-call regression; closure does not identify a fixing build.
- **[E5]** [Ollama #14745](https://github.com/ollama/ollama/issues/14745), 2026-03-09, Qwen3.5 9B native calls printed as text; closed 2026-03-27.
- **[E6]** Indexed-only supplementary anecdotes: [Qwen3-4B iGPU agent use](https://www.reddit.com/r/LocalLLaMA/comments/1mjghu2/qwen34b_enables_agentic_use_cases_for_us_igpu/), [Qwen3.5-4B assistant](https://www.reddit.com/r/hermesagent/comments/1snfnq9/yes_hermes_and_qwen354b_is_all_i_need_details/), [FunctionGemma complaint](https://www.reddit.com/r/ollama/comments/1pq69o5/new_functiongemma_model_not_worth_downloading/). Direct extraction failed; publication dates/runtime details not independently verified, no numerical inference drawn.
- **[E7]** [Distil Labs FunctionGemma experiment](https://www.distillabs.ai/blog/making-functiongemma-work-multi-turn-tool-calling-at-270m-parameters/), publication date not found in fetched article; [smart-home model](https://huggingface.co/distil-labs/distil-home-assistant-functiongemma-gguf), [smart-home data](https://github.com/distil-labs/distil-smart-home), [shell project](https://github.com/distil-labs/distil-SHELLper). Vendor self-report, partly reproducible released artifacts, no independent replication here.
- **[E8]** [llama.cpp #24178](https://github.com/ggml-org/llama.cpp/pull/24178), merged 2026-06-05; [merge commit `da87e9b612592ccd2a2e783eff631346459b9de0`](https://github.com/ggml-org/llama.cpp/commit/da87e9b612592ccd2a2e783eff631346459b9de0). [Earlier #20251](https://github.com/ggml-org/llama.cpp/pull/20251) also discusses template detection. Unrelated [#14670](https://github.com/ggml-org/llama.cpp/issues/14670), 2025-07-14, is an LFM concurrent-slot crash, not a tool-parser fix.

### Runtime contracts

- **[R1]** [llama.cpp function calling](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md), [server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md). The guide's native-handler list is not exhaustive/current proof of absence: newer parser PRs establish additional support. Remote master inspected during this task: `9c2e0e491a822adae1f0b1c831adb4160057d24f`, timestamp 2026-10-08T01:30:06Z; no binary installed or executed.
- **[R2]** [llama.cpp grammar/schema limitations](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md).
- **[R3]** Ollama [tool calling](https://docs.ollama.com/capabilities/tool-calling), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs).
- **[R4]** Ollama [FAQ: memory, parallelism, KV quantization](https://docs.ollama.com/faq), [context length](https://docs.ollama.com/context-length), [GPU compatibility](https://docs.ollama.com/gpu). Default contexts/recommended agent contexts do not establish available memory on this machine.

### Remaining unknowns

Exact finalist native-tool performance on this Windows/CUDA runtime; schema-keyword behavior of the selected Ollama backend; Q4/Q6/Q8 accuracy deltas; joint host/GPU loading peaks; CPU/offload latency; recovery under unseen APIs; and whether any model chooses beneficial Prosper actions rather than merely composing valid calls. Public evidence narrows a comparison, not these uncertainties.

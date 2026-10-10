# Offline primitive tokenizer probe

2026-10-08. **Sizing remains blocked by physical RAM. No token counts were obtained.** Implemented a repeatable vocabulary-only probe without changing candidate transport, reservations, services, shared contracts, packages or machine configuration.

## Retained result

Native Node 24 invocation of `scripts/tokenize-primitive-context.ts` returned JSON status `blocked`, exit code 2:

| Quantity | Result |
| --- | ---: |
| Fresh free physical RAM at probe preflight | **14,594,048 bytes** (13.92 MiB) |
| Sizing admission floor | **2,147,483,648 bytes** (2 GiB) |
| Archive acquired / extracted | **0 / 0 bytes** |
| Vocabulary loads / generation calls / services started | **0 / 0 / 0** |
| Measured requests / token counts | **0 / unavailable** |
| Verified Ollama counts / smaller safe context | **unavailable / not established** |

The parent separately reported 326,656,000 bytes free; an earlier task sample was 46,018,560 bytes. Headroom fluctuated, but none justified vocabulary loading. GPU headroom does not substitute for host admission. No unrelated process was killed. The blocked invocation created no task temporary directory and did not import the world/request-capture graph.

This result is evidence of the preflight gate, **not tokenizer, model-capability or latency evidence**. Do not lower the existing native reservation, 6 GiB inference RAM gate, or context allocation from this work.

## Installed identity and availability

Checked the known Ollama application directory directly, the exact installed manifest/config/params files, executable availability and four named optional tokenizer packages. No recursive directory walk or durable Prosper access.

- No `llama-tokenize` on the current PATH. Installed Ollama ships `llama-server.exe` and `llama-quantize.exe`, but no standalone tokenizer in its known binary directory. Neither was started.
- `@huggingface/transformers`, `llama-tokenizer-js`, `@llama-node/llama-cpp`, and `node-llama-cpp` are unavailable to this repository. No packages were installed. This is a bounded availability check, not proof no tokenizer exists anywhere on the computer.
- Parent metadata identifies Ollama **0.35.1**, exact `qwen3.5:9b`, total installed payload **6,594,474,711 bytes**. This task made no Ollama HTTP calls.
- Manifest/config small-file SHA-256 hashes were verified by the native probe. GGUF size was checked, but its full file digest and vocabulary metadata were **not** read/verified because the run was blocked.

| Artifact | SHA-256 | Verification |
| --- | --- | --- |
| Installed manifest | `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7` | Small file hashed |
| Installed config, 475 bytes | `be595b49fe22012bd1f5605ec14c7ffa58331783a88a4fd8c22e5fc8ec42cf9f` | Small file hashed |
| Installed text GGUF, 6,594,462,816 bytes | `dec52a44569a2a25341c4e4d3fee25846eed4f6f0b936278e3a3c900bb99d37c` | Expected manifest digest and filename only; size checked |
| Permitted CPU ZIP, 19,482,170 bytes | `ed69a9e87713b84c63940b2f0e708c8e698e82b3d74dfa1364e94d97e334720c` | Published GitHub release metadata checked; not acquired |

Exact installed paths:

- `C:\Users\OwanLazic\.ollama\models\manifests\registry.ollama.ai\library\qwen3.5\9b`
- `C:\Users\OwanLazic\.ollama\models\blobs\sha256-be595b49fe22012bd1f5605ec14c7ffa58331783a88a4fd8c22e5fc8ec42cf9f`
- `C:\Users\OwanLazic\.ollama\models\blobs\sha256-dec52a44569a2a25341c4e4d3fee25846eed4f6f0b936278e3a3c900bb99d37c`

The verified config selects family `qwen35`, renderer/parser `qwen3.5`. The pinned manifest has model/license/params layers only, with no stored system, messages or template layer. Its params are sampling settings, not prompt text. No large model, CUDA archive, driver, inference runtime install or PATH change occurred.

## Request and history boundary

The probe's admitted run captures the same public development shapes as [the context audit](primitive-context-audit.md): `developmentFixture('sell-buy-meal', 7, 2)` → `runEpisode` → actual `LocalModelCandidate`, two mock `advance` decisions, cadence 1, candidate seed 1. No saved world, reference action, trajectory, held-out suite or hidden fixture holding is supplied to the candidate. The candidate receives only its ordinary public context, observation and feedback callbacks.

Capture uses the audit's generous **mock-only** 500,000-byte cap, 60,000-input/256-output configuration and 120,512 episode reservation to expose both requests. Mock usage of 100 input/10 output is never presented as measured token consumption.

Both lanes are explicit:

1. **Default history:** four entries / 32,000 raw JSON bytes. At turn two, retain the complete first committed feedback, immediate observation and every cadence-one observation. Assertions compare the transmitted current observation and history with the genuine callbacks; nothing is summarized, projected again or dropped by this probe.
2. **Development-small-history:** one entry / 1,024 bytes. The first oversized feedback is omitted by the existing adapter, and the second request must say `historyOmissions:1`. This is the separately declared lossy lane, not a substitute for full-history sizing.

Original system/user content strings and complete output schema stay untouched. Rendering applies only the actual backend's boundary trimming and chat wrappers. Native `format` is a separate grammar argument, not counted as model-readable prompt text. The complete schema is still preserved and hashed; the manual's model-readable schema is not removed.

A successful later run prints exact request IDs; messages, system, user, current observation, complete history, schema and envelope SHA-256 hashes; original envelope bytes; rendered bytes/hash; raw token count; canonical token-ID hash; stderr hash; output ceiling and resource telemetry. **No new request hashes or counts exist in this blocked run.** Earlier audit byte measurements are not relabelled token evidence.

## Vocabulary-only proof and runtime pin

The only permitted package acquisition is [llama.cpp b11490 CPU Windows x64](https://github.com/ggml-org/llama.cpp/releases/tag/b11490), commit **`9c2e0e491a822adae1f0b1c831adb4160057d24f`**, archive `llama-b11490-bin-win-cpu-x64.zip`. The [release API](https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b11490) confirms its 19,482,170-byte size and digest above. It is streamed to a unique OS-temp directory, verified before extraction/execution, never installed, then removed with that known directory.

Primary source controls at that exact commit:

- [`tools/tokenize/tokenize.cpp`](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/tools/tokenize/tokenize.cpp): sets `model_params.vocab_only = true` before loading the model. File mode re-reads binary bytes verbatim; `--no-escape` prevents backslash transformations.
- [`src/llama.cpp:344–370`](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/src/llama.cpp#L344-L370): propagates `vocab_only`, loads vocabulary, then logs **`vocab only - skipping tensors`** and returns **before `load_tensors`**. Retained source SHA-256: `8058a140d444b67bf64a1ce393d241dfd60080f4b117130c6f82e637e2109233`.
- [`src/llama-context.cpp`](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/src/llama-context.cpp): `!hparams.vocab_only` guards backend/output-buffer, memory/cache and scheduler initialization. A context object can exist without those allocations. Metadata/vocabulary still consumes RAM; it is not a zero-memory operation.
- [`common/arg.cpp`](https://github.com/ggml-org/llama.cpp/blob/9c2e0e491a822adae1f0b1c831adb4160057d24f/common/arg.cpp): tokenize-tool setup overrides common's `parse_special=false` default to **true**. Arguments are `--model <gguf> --file <utf8-file> --no-escape --no-bos --ids`. Retained source SHA-256: `389fbc2a5489154c2419f9d1300debb2ee451cfa1be5b67eb4b7c19ea4329122`.

A run verifies archive digest, binary build/commit via `--version`, binary hash and installed GGUF full streaming digest. It accepts count output only with the vocabulary-only log and rejects tensor/offload/cache/compute/decode markers. There is no generation call. The CPU archive's actual tokenizer executable/layout and executable hash remain **unverified until acquisition**. Source proof is established; binary execution proof is not.

## Ollama rendering and remaining mismatch

The offline renderer is deliberately restricted to the actual two-message system/user shape, no native tools/images/assistant transcript, `think:false`. Full feedback remains inside the original user JSON. It ports the installed config's selected Ollama **v0.35.1 `qwen3.5` renderer**, rather than assuming an upstream Jinja or stored Go template is equivalent:

```text
<|im_start|>system\n{GoTrimSpace(system)}<|im_end|>\n
<|im_start|>user\n{GoTrimSpace(user)}<|im_end|>\n
<|im_start|>assistant\n<think>\n\n</think>\n\n
```

Concatenate directly; displayed `\n` is one LF. Even a supplied empty system turn remains. Go whitespace includes U+0085 and excludes U+FEFF; JavaScript `.trim()` would not be equivalent. Internal content bytes remain unchanged. The source manual's final newline is boundary-trimmed by this renderer, not by capture.

Evidence:

- [`renderer.go:71–73`](https://github.com/ollama/ollama/blob/v0.35.1/model/renderers/renderer.go#L71-L73) and [`qwen35.go`](https://github.com/ollama/ollama/blob/v0.35.1/model/renderers/qwen35.go): Qwen3.5 enables the closed empty thinking prefix; no renderer BOS. Retained `qwen35.go` SHA-256: `69bca99b53a3db8d599bb9ec8eadf65ce9a72868566a89bfac44d31fe3b565e0`.
- [`server/prompt.go`](https://github.com/ollama/ollama/blob/v0.35.1/server/prompt.go) and [`server/routes.go`](https://github.com/ollama/ollama/blob/v0.35.1/server/routes.go): selected renderer bypasses stored template; embedded system/messages can otherwise change the effective prompt; native `format` is separate. Default truncation remains a backend hazard, not something this probe authorizes.
- Ollama [`LLAMA_CPP_VERSION`](https://github.com/ollama/ollama/blob/v0.35.1/LLAMA_CPP_VERSION) is **b11232**. Its context-count [`Tokenize`](https://github.com/ollama/ollama/blob/v0.35.1/llm/llama_server.go#L2635-L2638) sends `add_special:false`; pinned llama-server defaults `parse_special:true`. The probe's no-BOS/tokenize-tool flags match those context-count flags.
- A bounded source comparison of b11232/b11490 vocabulary and Unicode implementation found unchanged Qwen35 regex/custom splitting, BPE special partitioning and BOS/EOS behavior for this nonempty prompt; Unicode data is identical. Vocabulary source hashes: b11232 `82e8996cbbd81c1648b1f4946b5f481138aa897a1343dcd8b1a4abe8cff0b5fc`; b11490 `e772949cb8ad204f87845cb5e18f11e8a419fdb872e5f645012e5b6a9f84588f`.

This is source-supported compatibility, **not a measured installed-renderer/tokenizer differential**. Installed special-token metadata and tensor-free runtime behavior have not been observed. Completion-side tokenization can use `add_special:true`, distinct from the context-count endpoint. Therefore the report always labels results **exact b11490 counts of the source-ported rendered bytes**, not exact Ollama `prompt_eval_count`. `portedRenderedInputPlusOutput` is arithmetic for that string only; it does not certify the smallest safe Ollama context or reconcile backend-added tokens. No byte-to-token estimate is used.

## Resource and cleanup contract

Sizing admission is **2 GiB free physical RAM**, not an inference-gate change. This is a conservative unmeasured planning envelope: at most **768 MiB** child working/private/peak-working-set, a **512 MiB** remaining-free floor, and margin for Node, sampler, ZIP extraction and transient vocabulary allocations. The archive's small size is not evidence the vocabulary peak fits.

The tokenizer has a 30-second deadline and bounded output. A task-owned PowerShell sampler checks free physical RAM and the exact child PID nominally every 250 ms; slow CIM sampling can increase that interval. The watchdog permits at most five seconds to the first sample and **1.5 seconds after the last valid sample**, then terminates the task child. Samples below the free floor, above process limits, sampler failure, tensor markers, timeout or invalid output reject the run. A tokenizer that exits before any process sample is rejected, not recorded as a measured safe run. Polling is cooperative protection, **not an OS-enforced memory sandbox**; peak private memory is a sampled maximum and can miss transients.

Only the standalone tokenizer and its sampler are stopped, with exit awaited. No unrelated service/process is unloaded. Any known tokenizer directory is removed in `finally`. Returned successful episode paths are removed by capture. **Existing `runEpisode` can reject before returning its newly allocated OS-temp path**; in that case the probe explicitly reports `episodeCleanupUncertain:true`, makes no all-artifacts-removed claim, and does not traverse/delete unknown temporary directories. The runner was not redesigned or patched. The actually executed blocked preflight allocated no episode/tokenizer temporary artifacts.

## Reproduction and verification status

Default is small metadata/preflight only:

```powershell
node --max-old-space-size=96 scripts/tokenize-primitive-context.ts
```

When the parent schedules serial verification and fresh headroom meets admission, the authorized measurement command is:

```powershell
node --max-old-space-size=192 scripts/tokenize-primitive-context.ts --run
```

No limit override, alternate model path or acquisition argument is accepted. Run prints JSON to stdout; do not redirect evidence into durable Prosper data. Source `tsx` registration is lazy, uses the existing dependency, and happens only after admission for the actual adapter graph.

Authored bounded tests in `test/primitive-tokenizer.test.ts` cover current low-RAM samples, thresholds, process stops, startup/stalled sampler mock clocks, Go whitespace semantics, exact no-think suffix/internal-byte preservation, message-shape refusal, fixed tokenizer arguments and mocked vocabulary-only/token-ID output refusal. **Vitest, typecheck and build were not launched**, following the parent's low-RAM stop. Only the native blocked preflight was executed. Parent owns subsequent serial verification:

```powershell
npm.cmd test -- test/primitive-tokenizer.test.ts
npm.cmd run typecheck
```

Read [Gate A](local-primitive-model-scout.md) and [the audit](primitive-context-audit.md) for the original boundaries. No candidate-quality, held-out-generalization, exact Ollama token count, warm memory, safe 9B inference or reduced-context claim is established here.

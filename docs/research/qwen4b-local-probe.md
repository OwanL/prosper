# Prepared Qwen3.5-4B public local probe

2026-10-08. **The bounded public live trial ran: three valid structured replies, no resource stop, but neither food-acquisition objective completed within its one/two-turn horizon.** Both trajectories replayed successfully. The normal live default remains `qwen3.5:9b`.

## Prepared artifact

The first 4B lane uses the official Ollama **Q4_K_M** text weights, not the previously researched third-party Q6_K conversion. This preserves the official native Qwen renderer/config while reducing the download. Quantized quality on Prosper is unknown.

- Source discovery: `https://registry.ollama.ai/v2/library/qwen3.5/manifests/4b`. Acquisition pins blob digests, not this mutable tag.
- Text weight blob: **2,648,593,216 bytes**, SHA-256 `a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50`.
- Config: SHA-256 `788a4d94bc3f431ac0cd067005be4b838a09330427962952420b05d10ecf84db`, 177 bytes. Pins `qwen35`, Q4_K_M, native renderer/parser `qwen3.5`.
- Template: SHA-256 `b507b9c2f6ca642bffcd06665ea7c91f235fd32daeefdf875a0f938db05fb315`, 13 bytes, `{{ .Prompt }}`. Rendering comes from the pinned native renderer, not this placeholder alone.
- Sampling params: SHA-256 `9371364b27a52acac9d87f88bd93c9db1174d8d6ec57f6888925cdc1788871ff`, 65 bytes.
- License: SHA-256 `50cbab8a892c5f2993b8c7351a99182507472def3b1374558308605d99b86b32`, 11,343 bytes.
- Derived text-only manifest SHA-256: `c7d74099133577ad9ab14d1e4dda261260bc98f37362e0c77e8c9078d6ce183c`. The vision projector is excluded and was not downloaded.
- Private model name: `prosper-qwen3.5-4b-text-q4:latest`.

Reusable task-owned artifact directory:

`C:/Users/OwanLazic/AppData/Local/Temp/prosper-qwen4b-artifacts-EHXyRM`

Receipt: `prepared.json` in that directory. Complete blob hashes, exact config/template/params and bounded GGUF metadata passed real preparation checks. GGUF verification confirms Qwen35, 32 layers, embedding 2560, native context 262144, Q4_K_M, and supported byte-based tokenizer metadata/byte tokens. No tensor initialization is involved. The directory is intentionally retained for the later trial; it is not installed into the shared Ollama store. Do not clear it before the trial.

Preparation streams pinned blobs, admits at 2 GiB free RAM, monitors a 512 MiB stop floor and imposes a 30-minute deadline. These are preparation-only gates, not inference admission. Completed blobs can be reused only after verification; partial downloads are not resumed. Failed preparation exposes its known directory rather than concealing retained files.

## Entrypoint and bounded trial

Use repository Node 24.16.0 and existing `tsx`; no package installation is needed:

```powershell
npm.cmd exec -- tsx scripts/evaluate-qwen4b-local.ts
npm.cmd exec -- tsx scripts/evaluate-qwen4b-local.ts --prepare-only
npm.cmd exec -- tsx scripts/evaluate-qwen4b-local.ts --confirm-qwen4b-local --artifact-dir "C:/Users/OwanLazic/AppData/Local/Temp/prosper-qwen4b-artifacts-EHXyRM"
```

The default prints the offline plan only. Preparation downloads/verifies without starting a service. Confirmation never downloads and requires the explicit verified OS-temp store. A previously prepared directory can be reverified with `--prepare-only --artifact-dir PATH` without acquiring complete cached blobs again.

The live trial is restricted to the two **public development** probes: buy-meal (one call), then sell-buy-meal (two calls), three total, no retries/repair/fallback. It receives the complete current public observation/manual and declared four-entry, 32,000-byte feedback history, not a supplied strategy. Input above the bounds is rejected, not silently trimmed to fit.

Fixed envelope: 98,304 total context, 90,000 input reservation, 256 output tokens per call, 80,000 complete messages-plus-schema UTF-8 bytes. Byte-based admission is a conservative bound, not an exact token count. Thinking is disabled and `truncate:false` is sent; verified capacity remains the admission protection. One five-minute abort deadline covers both owned service lifecycles and generations; decisions have 90 seconds and teardown has a separate ten-second ceiling.

After explicit user authorization to proceed empirically, Qwen4B admission is **2 GiB free RAM / 7.25 GiB free VRAM**, with unchanged stop floors of 1 GiB RAM / 128 MiB VRAM. The previous 8 GiB host estimate assumed two weight-file equivalents plus runtime/margin and was not a measured requirement. It no longer blocks this profile. GPU planning remains eight attention layers × four KV heads × 256 dimensions, about 3 GiB FP16 KV at 96K, plus about 2.47 GiB weights and runtime/margin. Admission and sampling are not hard containment. Existing 9B gates remain 6 GiB / 7 GiB.

The service uses the artifact root with its child private model store. Confirmed shutdown moves exclusive logs into per-fixture evidence; uncertain shutdown retains the original log and blocks reuse. Windows canonical paths use native realpath resolution so short/long user-directory aliases do not defeat containment checks. Complete/failed raw replies and original trajectory locations are retained before fallible replay; reusable models are not deleted after the run.

Transport admission requires actual verified artifact metadata, the fixed envelope and the exact private store. It checks the actual installed/owned Ollama **0.40.1**, `/api/show` metadata/template/params and exact `/api/tags` digest/size before generation. Live compatibility passed. The preparation ownership receipt retains its original 0.35.1 baseline field; runtime version admission is separate. The known GGUF float32 epsilon is compared through exact `Math.fround` normalization because the API serializes it as `0.000001`; all other metadata remains exact. Installed total size is **2,648,604,814 bytes**, including config bytes, as verified from the real `/api/tags` response.

## Verification and remaining boundary

- 151 focused offline tests across Qwen preparation, transport, resources, lifecycle and tokenizer passed, with one worker at a time. Integrated TypeScript checking passed.
- Evaluator-owned private suite: 13 offline tests passed, with no private solution details supplied to candidate builders. This proves authored fixture/verifier checks, not model capability.
- Real preparation verified the downloaded weights and metadata. Initial exact-text verification caught trailing LF bytes in official config/params; pinned constants and checksum regressions now preserve those bytes.
- Offline CLI plan ran with zero model calls. Latest focused regression verification: 120 tests passed and integrated typecheck passed. No held-out candidate result exists.

## Authorized live result

Retained evidence: `C:/Users/OwanLazic/AppData/Local/Temp/prosper-qwen4b-evidence-E454DT`. Each `prosper-evaluation-*` child contains initialization, trace and report; `probe.json` preserves raw replies, file hashes and replay outcomes; service logs are retained separately. Three `/api/chat` requests actually ran, with no model-output retries, repair or fallback.

| Public probe | Calls | Outcome | Actual usage | Candidate time |
| --- | --- | --- | --- | --- |
| buy-meal | 1 | Valid move toward food deposit; objective not completed in one tick | 10,999 input / 55 output tokens | 11.08 s |
| sell-buy-meal | 2 | Valid moves; objective not completed in two ticks | 29,096 input / 124 output tokens total | 25.18 s total |

All three replies were schema-valid and dispatched without candidate errors; accounting was valid and both retained trajectories replayed to the recorded final hashes. This establishes a functioning primitive integration, not success at the tasks or evidence of general intelligence. The short horizons do not establish that gathering could never succeed with more time.

An important limitation: the declared 32,000-byte history cap admitted **zero history entries**; the second probe dropped one previous full observation/result entry. Current observations remained complete, but this run cannot establish feedback-history or learning capability. Correct sizing/representation needs separate review before broader capability claims. Do not tune toward these authored trajectories.

### Actual resource evidence

Ollama reported all **33/33 layers offloaded to GPU**, with actual 98,304 context unchanged by its fit step. CUDA allocations in logs: 2,515.44 MiB model, 3,072 MiB FP16 KV, 50.25 MiB recurrent state and 160.02 MiB compute. CUDA-host model/compute buffers were about 497.31/106.02 MiB, not two host weight-file copies. These logged allocations are not a complete process/system peak measurement. Load-time available host RAM was about 2.9–3.0 GiB; no resource-floor stop or allocation failure occurred. Thus the previous 8 GiB host heuristic was unnecessarily blocking this trial.

After confirmed teardown, free RAM was **3,760,762,880 bytes** (about 3.50 GiB), and VRAM returned to **8,018 MiB** free of 8,192 MiB. Owned service/runner processes were removed; the pre-existing unrelated Ollama app/service was left untouched. No cloud calls, production defaults, package/config/shared-contract edits or durable-world access were involved.

### Setup attempts retained separately

Before any `/api/chat`, live integration exposed and corrected readiness polling (retry transient `/api/version` timeout inside the original 15-second startup window), native-version pinning, exact float32 API projection, installed total size including the 177-byte config, and replay directory naming. Earlier failure evidence remains in `prosper-qwen4b-evidence-nQeonU`, `prosper-qwen4b-evidence-9h4LUG` and `prosper-qwen4b-evidence-UMs6nX`; metadata-only diagnostics are in `prosper-qwen4b-metadata-P00TNG` and `prosper-qwen4b-tags-iEiQ26`, under the same OS-temp root. Harness accounting conservatively reserved calls/tokens on failed preflights, but service logs show **no `/api/chat`** in those attempts. Those reservations are not measured generation tokens and not model capability outcomes.

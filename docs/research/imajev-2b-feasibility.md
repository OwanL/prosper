# imajev-2B feasibility: stopped at the resource gate

8 October 2026, native Windows x64. **No imajev inference was run. Available host RAM was conservatively insufficient, so setup and model loading were not attempted.** This is a resource-blocked experiment, not an execution failure or evidence about model quality.

Only this report was added to the repository. No dependency/model download, global installation, machine/driver/PATH change, model initialization, paid API, service launch, Prosper/Ollama restart, unrelated-process termination, or durable-world read occurred. The resource collector exited normally; no inference process exists to stop.

## Fresh measurements and stop decision

Verified the explicit existing interpreter: `C:/Users/OwanLazic/AppData/Roaming/uv/python/cpython-3.12.14-windows-x86_64-none/python.exe`, CPython **3.12.14**, AMD64, MSC v.1944. No bare Python/Proto shim was invoked.

| Snapshot (NZDT) | Free physical RAM | GPU used / free | Temp-volume free disk |
|---|---:|---:|---:|
| Initial inspection, before retained collector | 3,624,712 KiB (3.46 GiB) | 616 / 7,403 MiB | 461,453,320,192 B |
| 16:54:38 | 3,521,540 KiB (3.36 GiB) | 616 / 7,403 MiB | 461,456,519,168 B |
| 16:54:40 | 3,447,836 KiB (3.29 GiB) | 616 / 7,403 MiB | 461,456,519,168 B |

GPU: **RTX 3070 Ti Laptop**, 8,192 MiB, driver **560.94**. OS usable physical RAM: 16,003,220 KiB. RAM was measured through `Get-CimInstance Win32_OperatingSystem`; GPU through `nvidia-smi`; disk through Python `shutil.disk_usage`. Exact collector commands, timestamps and raw stdout/stderr are retained in `resource-gate.json`. The initial inspection is transcribed above, not present in that JSON.

VRAM and disk pass the earlier planning gate; host RAM does not. The [hardware assessment](local-classifier-hardware-fit.md) describes a full BF16 base plus FP32 adapter/readout weight floor of **about 4.296 GiB** and a constructor that loads the full model before `.to(device)`. Available physical RAM is already below that serialized-weight floor, without framework, loading copies, OS or activation headroom. The preceding Laya run also consumed substantial host RAM during loading. Memory mapping/paging can make loading behavior differ from simple weight arithmetic, so this is **not proof of inevitable OOM**; it is sufficient reason not to force the prohibited memory-pressure experiment.

A future conservative scheduling target is **at least roughly 6 GiB free host RAM and 7 GiB free VRAM**, rechecked immediately before load. Six GiB is a planning gate, not a measured guarantee or newly verified backend requirement. The user must decide whether/when to close workloads; none were stopped here. No direct-device loading redesign, offload, quantization or CPU fallback was substituted to evade this stop.

## Exact intended artifacts; compatibility remains unverified

Retain the hardware report's artifact pins for a later authorized run:

| Component | Repository @ revision | Required weights |
|---|---|---|
| Full 2B base | `Qwen/Qwen3.5-2B` @ `15852e8c16360a2fea060d615a32b45270f8a8fc` | `model.safetensors-00001-of-00001.safetensors`, 4,548,221,488 B; matching index/config/tokenizer/processor files |
| Adapter/readout | `mohit67890/imajev-2b` @ `0426f7b1c73804b64fab5802e04f401420ec774c` | `adapter_model.safetensors`, 62,566,192 B; `decision_readout.safetensors`, 2,089,072 B; adapter config, readout manifest and calibration |

The prior report links `https://github.com/mohit67890/imajev` source on moving `main`; it does **not** supply an immutable code commit. Pinning and reviewing the exact source revision remains a prerequisite. No source revision, downloaded weight hashes, imajev package lock or working PEFT compatibility is claimed here.

The prior isolated experiments verified **torch 2.7.1+cu126**, Transformers **5.19.0**, and CUDA 12.6 on this driver. Their scoped uv cache may be reused, but that is not proof of imajev compatibility. No separate imajev venv was created because the resource gate failed first. A later run needs its own verified Python 3.12 environment, compatible CUDA12 wheel, exact dependency freeze, architecture import and tiny synchronized CUDA operation before loading. Do not load any other classifier/model concurrently.

Intended mode remains full base + adapter + readout, text-only, one rotation, thinking off, eager, no fast/compile/merge/quantization/offload. Actual parameter dtype/device, no-CPU-fallback behavior and readout binding remain **unverified**, not inferred from a requested device string.

## Comparable quality fixture retained unchanged

Read only the exact prior `cases.json`, `make_cases.py` and `start.json`; no cache traversal or previous model reload. Copied the fixture and generator byte-for-byte into this experiment's unique temp directory. `cases.json` contains all **16 exact state prompts, common instruction, ordered options, expected labels and justifications** from the [previous feasibility report](local-classifier-feasibility.md). Four cases are reordered duplicates, not independent samples.

| Case(s) | Expected | Independent rationale |
|---|---|---|
| trade_direct / trade_consequences | work | Final gold 13 versus trade 11 after all costs. |
| sequential_direct / sequential_consequences | local | Expedition cannot fund tick-6 meal before sale; local survives with 17 gold. |
| deadline_direct / deadline_consequences | buy | Eating now beats four-tick forage against a two-tick survival deadline. |
| personality_selfish / personality_generous | keep / gift | Explicit own-gold objective versus ally-fed-first objective. |
| negation_direct / negation_consequences | plant | Allowed planting earns 8 versus sale 5. |
| risk_neutral / risk_averse | risky / safe | Expected 6 exceeds 4; guaranteed 4 exceeds 0. |
| trade_direct_reordered | work | Same economics, reversed option order. |
| negation_direct_reordered | plant | Same constraints, reversed option order. |
| personality_generous_reordered | gift | Same objective, reversed option order. |
| risk_neutral_reordered | risky | Same expectation, reversed option order. |

**Actual imajev answers: none for every case.** No model-formatted/tokenized prompts, token lengths, truncation audit, confidence, warmups, repeated synchronized end-to-end p50/p95, load duration or peak-memory measurement exist. Setup stopped before installation; inference duration is zero. The retained collector ran in **3.016 seconds**; this is resource-inspection time, not model latency. Neither the 25-minute setup nor five-minute inference cap was approached. No OOM occurred because no load was attempted. There are no wrong-fast or correct-fast imajev results to compare, and classifier confidence must never be interpreted as utility.

Optional future investment pair, **not run or added to the comparable 16-case fixture**: start cash 10, invest 6 now, receive 10 at tick 3, mandatory expense 1 at each tick. Objective: maximize cash at the stated horizon while meeting expenses; receipts after the horizon have zero value. At horizon 3, invest finishes `10-6-3+10=11` versus cash-only 7 and can fund all expenses before receipt. At horizon 2, invest finishes 2 versus cash-only 8; choose no investment. This tests horizon-sensitive value and liquidity rather than confidence.

## Retained evidence

```text
C:/Users/OWANLA~1/AppData/Local/Temp/prosper-imajev-2b-7z0m2q2c
```

Temporary evidence is not durable archived storage; preserve it for follow-up consumption. Files:

- `collect_gate.py`: complete resource collector, bounded subprocesses, no model/package imports or installations.
- `resource-gate.json`: two raw resource snapshots, interpreter version/path, fixture provenance/hashes, elapsed time and explicit blocked status.
- `cases.json`: unchanged 11,350-byte prior fixture; SHA256 `a91e9d9d910319bdc0c14a353494d12a826464437e1cb36e86099e9346245060`.
- `make_cases.py`: unchanged 5,189-byte generator; SHA256 `53636009131e97fa28914394172fcec730a9f01de366c7e24588c36027ac1f80`.

Verification: collector exited with code 0; both GPU/RAM query subprocesses succeeded on both snapshots; fixture validation confirms 16 unique IDs with expected labels among their options and nonempty justifications. No production tests/build were needed for this report-only change. **Remaining blocker: schedule materially more available host RAM, then establish immutable source/dependency pins and run the still-unverified experiment.**

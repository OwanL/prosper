# Local classifier hardware fit

Research-only assessment, 8 October 2026. No installation, model-weight download, inference, service launch, machine configuration change, production edit, or access to `.prosper/` / `.prosper-v2/` was performed. Remote reads retrieved documentation, code and artifact metadata, not weights. Local Python was invoked only for version/module discovery and public metadata reads.

## Decision

- **GLiClass edge and one Laya checkpoint are credible native-Windows candidates**, preferably CPU-first GLiClass and then isolated CUDA Laya. This is documented compatibility plus a hardware-fit estimate, not locally verified inference.
- **imajev-2B is the sensible GPU smoke-test size**, after freeing resources with the user's approval. Its full base plus adapter fits an otherwise available 8 GiB GPU at short context on paper. Windows x64 operation remains unverified here.
- **imajev-4B does not fit this GPU in its shipped BF16-base/FP32-adapter configuration.** Base plus adapter/readout alone is about **9.14 GiB**, before activations and CUDA overhead. The shipped CPU path uses FP32 and exceeds installed RAM in weights alone. Quantization/offload would be separate engineering, not an existing verified installation recipe.
- **None should be loaded alongside the presently busy Ollama workload.** At inspection the GPU reported only 467 MiB free and Windows only about 1.20 GiB free physical RAM. Do not confuse installed capacity with current headroom.
- Existing Ollama Qwen is not an imajev runtime: the custom decision readout, code-token binding, adapter, calibration and scoring path matter. Ordinary generation with a Qwen GGUF is not equivalent.

## Actual machine: measured vs documented

Read `C:/dev/machine/README.md`, project `AGENTS.md`, `README.md`, and `docs/spike-2/OVERNIGHT.md`. The machine guide's 14 September inventory is not current in several respects.

Read-only measurements around 16:30 local time:

| Item | Observed |
|---|---|
| CPU | AMD Ryzen 9 6900HX, 8 physical cores, 16 logical processors |
| Physical RAM | 16,387,297,280 bytes, about 15.26 GiB usable physical capacity; 1,262,216 KiB free at snapshot |
| NVIDIA GPU | GeForce RTX 3070 Ti Laptop GPU, WDDM, 8,192 MiB VRAM |
| Driver | 560.94; `nvidia-smi` reports CUDA compatibility version 12.6 |
| GPU pressure | 7,552 MiB used, 467 MiB free (remaining difference includes driver reservations); 91% utilization, 75°C, 77 W / 79 W at snapshot |
| Other graphics | AMD Radeon integrated graphics and Virtual Display Driver present; not a substitute for the NVIDIA CUDA path |
| OS | Windows 11 Business, version 10.0.26300 |
| Ollama | Installed CLI 0.35.1; existing `llama-server.exe` GPU process visible. No inference/API request or unload was issued |
| WSL | `wsl --list --quiet` lists only `docker-desktop`; no ordinary user Linux distribution observed |
| Python | **Existing uv-managed CPython 3.12.14 AMD64 verified by running its explicit executable**; 3.14.7 directory also present, not executed |
| uv | Existing native executable reports 0.12.10 |

Verified Python executable: `C:/Users/OwanLazic/AppData/Roaming/uv/python/cpython-3.12.14-windows-x86_64-none/python.exe`. Its isolated `importlib.util.find_spec` checks found no `torch`, `transformers`, `peft`, `laya`, or `gliclass`. This does not establish absence from every other virtual environment. No Prosper `.venv/Scripts/python.exe` was found at that exact path.

Verified uv executable: `C:/Users/OwanLazic/AppData/Local/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe/uv.exe`.

**PATH discrepancy:** this harness shell resolves bare `python`, `uv`, and `node` through `C:/dev/tools/proto/shims`, despite the machine guide's policy excluding Proto shims outside selected repositories. `python3` resolves to the Windows Store alias. No PATH changes were made and bare Python/uv shims were not invoked. Future approved setup should use explicit verified executables, not assume the alias is the interpreter. Python itself does **not** need installation merely because the older guide says it is unconfirmed.

Commands used: `nvidia-smi` and its CSV GPU query; `Get-CimInstance` for CPU/computer/OS/video; `Get-Command`; bounded `Get-Item`/`Get-ChildItem` at known runtime paths; `ollama --version`; `wsl --list --quiet`; explicit Python version/module-discovery and uv version commands. No benchmark was run. Current free disk space was not measured; the guide's old free-space figure is not a download budget.

## Exact primary artifacts and licenses

All model cards below declare Apache-2.0. The three code repositories' `LICENSE` files also contain Apache License 2.0; Qwen's base repositories include Apache-2.0 licenses. Preserve required licenses/notices in redistribution. This identifies the published licensing, not a legal audit of every training-data source. imajev additionally documents dataset attribution, including Eikos CC-BY-4.0 provenance; its code/weight license does not erase upstream attribution obligations.

Revisions below were obtained from Hugging Face API metadata on the assessment date. File byte counts are **remote artifact sizes**, not measured runtime memory. Download URL pattern is `https://huggingface.co/<repo>/resolve/<revision>/<path>`; also obtain the matching listed configs/tokenizers, not just the largest file.

| Candidate | Repository / pinned revision | Required weight artifacts |
|---|---|---|
| Laya English | `convaiinnovations/laya` @ `7b928d828b7b0e022f929d9bd2e44165aa270148` | `model.safetensors`: 842,609,210 bytes; `rl_agent_config.json`, `encoder/config.json`, `tokenizer/*` |
| Laya multilingual | Same repo/revision, `multilingual/` subfolder | `multilingual/model.safetensors`: 643,835,514 bytes, corresponding config/encoder/tokenizer files |
| Laya typed decisions | Same repo/revision, `typed-decisions/` subfolder | `typed-decisions/model.safetensors`: 842,609,220 bytes, corresponding config/encoder/tokenizer files |
| imajev-4B adapter | `mohit67890/imajev-4b` @ `f8d8234cebc6c99065c07731e59716dc0a6e27ab` | `adapter_model.safetensors`: 487,648,432; `decision_readout.safetensors`: 2,621,520; `adapter_config.json`, `decision_readout.json`, selected `calibration*.json`; `SHA256SUMS` available |
| imajev-4B base | `Qwen/Qwen3.5-4B` @ `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a` | `model.safetensors-00001-of-00002.safetensors`: 5,329,398,688; `model.safetensors-00002-of-00002.safetensors`: 3,990,429,408; index, config, tokenizer and processor/template files |
| imajev-2B adapter | `mohit67890/imajev-2b` @ `0426f7b1c73804b64fab5802e04f401420ec774c` | `adapter_model.safetensors`: 62,566,192; `decision_readout.safetensors`: 2,089,072; adapter config, readout manifest, calibration |
| imajev-2B base | `Qwen/Qwen3.5-2B` @ `15852e8c16360a2fea060d615a32b45270f8a8fc` | `model.safetensors-00001-of-00001.safetensors`: 4,548,221,488; index, config, tokenizer and processor/template files |
| GLiClass edge | `knowledgator/gliclass-edge-v3.0` @ `df03993a2ed98e5e4a0d2dd7efbbd105abe874cf` | `model.safetensors`: 130,829,312; `config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json` |
| GLiClass small alternative | `knowledgator/gliclass-small-v1.0` @ `21edefaf7951f68c68c505f9139ba536d3b448f7` | `model.safetensors`: 574,383,356 plus config/tokenizer files. Optional published `onnx/model-int8-quantized.onnx`: 174,140,148 and `onnx/model.onnx`: 574,949,674 |

Laya and these GLiClass checkpoints are complete classifiers, not tiny adapters needing an additional separately resident backbone. imajev **is** an adapter and separate readout needing the entire Qwen base. Do not download imajev's duplicate `mlx/` weights for Windows PyTorch. Avoid Laya's default all-checkpoint preload for this machine.

Primary artifact inventories: [Laya](https://huggingface.co/api/models/convaiinnovations/laya/tree/main?recursive=true), [imajev 4B](https://huggingface.co/api/models/mohit67890/imajev-4b/tree/main?recursive=true), [imajev 2B](https://huggingface.co/api/models/mohit67890/imajev-2b/tree/main?recursive=true), [pinned Qwen 4B](https://huggingface.co/api/models/Qwen/Qwen3.5-4B/tree/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a), [pinned Qwen 2B](https://huggingface.co/api/models/Qwen/Qwen3.5-2B/tree/15852e8c16360a2fea060d615a32b45270f8a8fc), [GLiClass edge](https://huggingface.co/api/models/knowledgator/gliclass-edge-v3.0/tree/main?recursive=true), [GLiClass small](https://huggingface.co/api/models/knowledgator/gliclass-small-v1.0/tree/main?recursive=true).

## Realistic memory assessment

GiB means 2^30 bytes. Below are **planning estimates**, not locally measured peaks. Budget includes weights plus representative framework/activation headroom for one short text and a few labels/questions. Longer inputs, batches, compilation, graph capture, multiple models, loading copies and Windows allocations can exceed these ranges.

| Configuration | Weight floor / source behavior | Planning allowance and verdict |
|---|---|---|
| GLiClass edge, FP32 | About 0.122 GiB serialized weights, 32.7M parameters | Roughly 0.5–1.5 GiB process RAM, or 0.7–1.5 GiB incremental CUDA use; easiest CPU candidate once RAM is freed |
| GLiClass small, FP32 | About 0.535 GiB weights | Roughly 1–2.5 GiB RAM, or 1–2 GiB CUDA; reasonable alternative; ONNX int8 footprint is smaller but export/runtime parity must be checked |
| Laya English / typed | 421M parameters: about **1.57 GiB FP32 resident weights**, despite ~0.785 GiB checkpoint | Roughly 2.5–4 GiB RAM or 2.5–4 GiB CUDA at short contexts; one checkpoint fits an available GPU |
| Laya multilingual | 322M parameters: about **1.20 GiB FP32 resident weights** | Roughly 2–3.5 GiB RAM or CUDA for short inputs; long 8K inputs require separate measurement |
| imajev-2B CUDA | Full BF16 base ~4.236 GiB plus FP32 LoRA/readout ~0.060 GiB = **4.296 GiB** | Roughly 5.5–7 GiB CUDA at short context; plausible alone, not with Qwen 9B. Host loading also needs several GiB free RAM |
| imajev-4B CUDA | Full BF16 base ~8.680 GiB plus FP32 LoRA/readout ~0.457 GiB = **9.137 GiB** | Roughly 10.5–13+ GiB CUDA; **cannot fit 8 GiB as shipped**, even before forward pass |
| imajev-2B CPU | Shipped server selects FP32 on CPU: roughly 8.47 GiB base + 0.06 GiB adapter | Around 10–13+ GiB process RAM plus OS/apps; marginal even after closing substantial workloads, not a preferred smoke test |
| imajev-4B CPU | FP32 base about 17.36 GiB + 0.46 GiB adapter | Exceeds 15.26 GiB physical capacity in weights alone; paging is not a practical fast-decision deployment |

Important source-level checks:

- Laya's [Agent](https://github.com/NandhaKishorM/laya/blob/main/laya/agent.py) constructs the model, copies safetensors into it, then calls `.to(device)` **without converting parameter dtype**; CUDA autocast is separate. Thus a half-sized checkpoint is not proof of half-sized resident parameters. Loading and autocast can add temporary copies. It can silently fall back to CPU with warnings on OOM; future evidence must record actual device and fallback counts.
- imajev's [server TorchBackend](https://github.com/mohit67890/imajev/blob/main/scripts/playground/server.py) selects BF16 on CUDA and FP32 otherwise. [TorchDecision](https://github.com/mohit67890/imajev/blob/main/scripts/torch_decision.py) loads `Qwen3_5ForConditionalGeneration` in full then `.to(device)`. It exposes no quantization or automatic device-map/offload in this constructor. Text-only processing avoids torchvision but **does not remove the vision tower's weights**.
- imajev 4B's raw 4-bit base-weight arithmetic would be around 2.17 GiB plus adapter and quantization/runtime overhead, but that is **not a verified downloadable compatible runtime**. Quantized modules, DeltaNet, FP32 candidate readout, PEFT and calibration parity need engineering and measurement. Do not substitute this arithmetic for a working 8 GiB recommendation.
- No per-citizen model copies: a future integration would use one serialized model process, not one instance per citizen. These assessments do not establish throughput for 100 citizens.

## Windows, CUDA and dependency constraints

### Shared runtime

[PyTorch officially documents native Windows CPU/CUDA](https://pytorch.org/get-started/locally/) and currently lists Python 3.10–3.14. The verified existing 3.12 interpreter is a sensible environment base. NVIDIA Ampere hardware is suitable for ordinary FP16/BF16 CUDA inference, subject to successful wheel/driver validation.

`nvidia-smi`'s CUDA 12.6 label is **driver compatibility**, not proof of an installed toolkit or working PyTorch. Driver 560.94 is not sufficient for CUDA 13.x (NVIDIA lists driver >=580). CUDA 12.x minor-version compatibility has feature and PTX/JIT caveats: [NVIDIA compatibility contract](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html). Prefer a reviewed prebuilt CUDA 12.6-compatible PyTorch wheel if still suitable for the selected library versions, or ask separately before a driver upgrade. Do not blindly install the newest default GPU wheel. A full CUDA toolkit/compiler is not ordinarily needed for eager prebuilt-wheel inference; optional compiled fast paths are different.

Use separate virtual environments with a recorded lock per candidate initially. No tested dependency resolution exists here. Ordinary dependencies need not be mutually contradictory, but their broad lower bounds permit combinations that lack the required model classes or binary compatibility.

### Laya

[README](https://github.com/NandhaKishorM/laya#installation-details) provides native Windows PowerShell setup and CPU/CUDA selection. It reports a Windows 11 Python 3.14 construction fix in release 0.3.7. This is publisher evidence, not this machine's verification.

[Current pyproject](https://github.com/NandhaKishorM/laya/blob/main/pyproject.toml) says 0.4.0, Python >=3.10, torch >=2.0, transformers >=4.48, safetensors >=0.4, hub >=0.20, NumPy >=1.20. Its HF card still discusses 0.3.20; README prose discusses newer package versions. **Pin an exact code/package release; do not treat these moving documents as one tested lock.** The English ModernBERT architecture requires a transformers build supporting it. `USE_TF=0` is the publisher workaround for TensorFlow import deadlock; a clean PyTorch-only environment avoids that unnecessary dependency.

Start eager, no `laya[fast]` TileLang, no compile, no server/preload. ONNX and the TypeScript packages exist but are separate routes, not established faster or simpler on this machine. The reviewed Laya HF artifact list does not contain a ready ONNX export.

### imajev

[Pyproject](https://github.com/mohit67890/imajev/blob/main/pyproject.toml): Python >=3.11,<3.15; `torch` extra includes torch >=2.6, torchvision >=0.21, transformers >=4.55, PEFT >=0.15, safetensors >=0.5 and accelerate >=1.0. `torch-text` omits torchvision; use it for a text-only probe. Base dependencies include Pydantic 2 and Pillow >=11.

**The declared transformers minimum is not an adequate compatibility guarantee:** source imports `Qwen3_5ForConditionalGeneration`; the chosen installed transformers must actually expose that architecture and match the backend calls. Likewise torch/torchvision must be a matching binary pair for the image route. Exact compatible pins remain a prerequisite, not a solved local fact.

[README](https://github.com/mohit67890/imajev) documents Linux/CUDA and Apple MLX, plus a newer CPU text-only Windows ARM report. That ARM report is not verification of this x64 laptop. Native Windows x64 eager PyTorch is plausible from the upstream stack and source, but no local or exact matching publisher setup was established. MLX is not the recommended path for this Windows NVIDIA machine. Linux/WSL is a fallback requiring an approved user distro/environment, not something supplied by `docker-desktop` for this task.

Keep `--fast`, Triton/CUDA graph capture, `--merge-lora`, and thinking off for initial comparisons. Merge loads FP32 on CPU before casting and can change near-tie decisions. CUDA graph capture needs extra memory/compiler support. Four rotations mean four forwards **per question**, not one cheap pass for an entire request.

### GLiClass

[Repository](https://github.com/Knowledgator/GLiClass) explicitly includes Windows venv instructions; CPU and CUDA are normal PyTorch deployment paths. Its main [pyproject](https://github.com/Knowledgator/GLiClass/blob/main/pyproject.toml) requires Python >=3.10, torch >=2.0, **transformers >=5.0 and NumPy >=2.0**, plus scikit-learn. Older model cards recommending transformers 4.48 are not the dependency contract of today's main branch. Avoid old torch/NumPy-1-era assumptions and record a coherent resolved set.

Use the plain pipeline initially, not `gliclass[serve]` Ray Serve, optional FlashDeBERTa/TurboT5 kernels, or streaming. These add unrelated Windows and runtime complexity. Model choice matters: edge v3 is 32.7M, while the README's small v1 example is a different, larger 574 MB artifact. V3 training mentions LoRA, but the listed edge artifact is a full `model.safetensors`, not a requirement to separately load an adapter and base.

## Scope and model-quality cautions

Published T4/H100/A6000/Mac timings are **not laptop measurements**. No candidate's latency, output correctness, calibration, RAM peak, GPU peak, or sustained simulation impact was measured here.

Laya's own [model card](https://huggingface.co/convaiinnovations/laya) warns that base typed-decision accuracy is below its majority-class baseline, scores need domain calibration, `noul` can follow labels, and `act_probability` is not useful. imajev's [4B card](https://huggingface.co/mohit67890/imajev-4b) reports stronger task results but also false certainty/abstention failures and a newer 4B training stage absent from 2B. GLiClass is a dynamic-label classifier, not an autonomous planner. These are candidates for narrow observed-state classifications, not evidence that economic strategy or personality will emerge.

Jev is excluded from local hardware-fit recommendations: the working lead is its hosted API, with no verified local weight/runtime release. No claim that Jev cannot ever be self-hosted is made. Kepler was not pursued: sparse evidence does not improve this bounded shortlist.

## Proposed smoke tests, pending explicit approval

**None of these steps has been executed.** Request approval for dependency/model downloads, dedicated temporary environments, any workload pause/unload, and any driver/WSL changes separately. No production integration or durable-world reads are required.

1. **Environment-only gate:** use verified existing Python 3.12 and native uv, resolve/pin one minimal environment per candidate outside source/durable data, record package versions and wheel CUDA variant. No model initialization. Check required model classes, torch CUDA availability/device capability and a tiny tensor operation. Stop on an unsupported driver/wheel rather than automatically upgrading or falling back.
2. **Resource gate:** user schedules the test and decides whether to pause/unload existing Ollama or other workloads. Re-measure RAM/VRAM and disk first. Do not attempt imajev-2B with less than roughly 7 GiB free GPU capacity or only 1 GiB free RAM. Treat thresholds as conservative planning gates, not proven necessities.
3. **GLiClass edge CPU first:** download only pinned config/tokenizer/130.8 MB weights. One process, 1–4 CPU threads, no server. Two warmups, 20 synthetic short inputs, 3–8 labels, <=256 tokens. Measure wall latency and process peak working set; validate finite outputs and label coverage, then exit. A later CUDA repeat is optional, not automatic.
4. **Laya one checkpoint:** choose English or typed-decisions explicitly, download only that subfolder/root's required ~843 MB weights/configs/tokenizer. Two warmups, 20 short synthetic states, at most four questions, fixed <=512-token total budget per encoded row, eager backend. Record actual device/fallback, peak GPU allocations/reservations, process RAM, latency and malformed/incorrect answers. No auto-language switching or all-model preload.
5. **imajev-2B CUDA only after earlier gates:** approve ~4.7 GB model payload plus environment/cache overhead; pinned full base + adapter + readout, text-only, no merge/fast/thinking, one rotation, one question, <=256 tokens initially. One warmup and ten hand-labelled synthetic cases; inspect readout binding and actual dtype/device before timing. Stop on first OOM or incorrect backend, no CPU retry/auto-download fallback. Four rotations/images/4096-token inputs require a separate later budget.
6. **Do not smoke-test stock imajev-4B on this GPU.** If 2B quality is insufficient, separately approve a quantization/offload feasibility task or use a machine with materially more memory. No production code modifications should be hidden inside a smoke test.

Each inference stage should have a five-minute wall deadline after downloads, one process/request at a time, no retries, and explicit cleanup. Synthetic cases should include negation, insufficient evidence, reordered options and contradictory evidence. Retain version/revision/hash, resource measurements and failures; twenty examples establish execution and rough latency only, not calibrated reliability or citizen-strategy quality. Keep all temporary artifacts in a unique OS-temp directory; retain only deliberately approved research results.

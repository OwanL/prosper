# Local classifier feasibility: actual Windows CUDA experiment

8 October 2026. Authorized dependency/weight downloads and local inference; **no paid API, imajev attempt, service launch, Prosper restart command, source/config edit, driver/PATH change, or durable-world access**. Only this report was added to the repository. Both inference processes exited normally. All other evidence is retained in a uniquely owned OS-temp directory for follow-up.

## Result

Both candidates work on the RTX 3070 Ti Laptop GPU with the existing driver and a **CUDA 12.6 wheel**, sequentially, without CPU fallback. Runtime feasibility does **not** imply useful economic reasoning.

| Model | Correct cases | Warm end-to-end p50 / p95 | Measured forwards | Download / load |
|---|---:|---:|---:|---:|
| GLiClass edge v3 | 12/16 (75%) | 13.01 / 16.72 ms | 80 + 2 warmups | 8.43 / 5.29 s |
| Laya **typed-decisions** | 7/16 (43.75%) | 36.67 / 46.78 ms | 80 + 2 warmups | 15.89 / 9.48 s |

Typed decisions was explicitly selected because choice decisions, rather than language detection or multilingual classification, are the relevant task. Only that Laya checkpoint was downloaded/loaded. These are 16 small synthetic cases, including four reordered duplicates, **not 16 independent domain samples**, not a calibrated accuracy estimate, and not an integrated citizen benchmark. No tuning, retries, batches, compilation, fast backend, or cherry-picked second run.

- **Correct fast:** GLiClass selected the cheaper local job over a sequential expedition with pre-sale meal/liquidity failure, in 12.76 ms case median. It also selected work over a trade with hidden toll, in 15.85 ms.
- **Wrong fast:** Laya selected the infeasible expedition in 34.89 ms; supplying its explicit survival failure did not fix the answer (38.68 ms). It chose the inferior trade both directly and with calculated consequences.
- GLiClass failed both opposing ally-personality tasks (gift for selfish, keep for generous) and the guaranteed-minimum risk objective. Laya failed selfishness and risk-neutral expected-value choice but passed generosity and risk aversion.
- Laya's deadline answer improved from wrong forage to correct buy when consequences were supplied. Negation/affirmative equivalents passed for both. Four reordered cases preserved each model's original choices, including wrong choices; this does not establish general order invariance.
- **Scores/probabilities are classifier outputs, not utility, economic value, or demonstrated calibration.** Strong wrong scores occurred: GLiClass risky under guaranteed-minimum objective 0.9110; Laya trade under explicitly inferior consequences 0.7203.

## Resources, devices and bounds

Fresh pre-install reading: RAM free **4,505,424 KiB** of 16,003,220 KiB; GPU **7,481 MiB free / 538 MiB used** of 8,192 MiB, driver **560.94**. OS-temp volume free **467,952,939,008 bytes**. A first PowerShell disk-filter query had quoting failure and returned null disk space; explicit Python `shutil.disk_usage` supplied the actual disk measurement. No workload was unloaded or stopped to obtain headroom.

| Measurement | GLiClass | Laya typed |
|---|---:|---:|
| Available RAM immediately before model load | 4,087,103,488 B | 4,095,733,760 B |
| GPU free before load | 7,482 MiB | 7,482 MiB |
| Parameters | 32,705,154 | 421,293,827 |
| All parameter devices / dtype | cuda:0 / FP32 | cuda:0 / FP32 |
| Forward autocast | none | BF16 enabled, effective for one row |
| Peak CUDA allocated / reserved | 142,632,960 / 163,577,856 B | 2,429,291,008 / 2,619,342,848 B |
| Sampled process peak resident working set | 1,253,400,576 B | 3,267,923,968 B |
| Sampled process peak private commitment | 2,987,098,112 B | 7,239,233,536 B |
| Minimum sampled system available RAM | 3,224,375,296 B | **1,173,458,944 B** |
| GPU used / free after inference, before process exit | 880 / 7,139 MiB | 3,228 / 4,791 MiB |
| GPU temperature before / after inference | 50 / 52 °C | 51 / 55 °C |
| Laya CPU fallback count | n/a | 0 initially and finally |

PyTorch **2.7.1+cu126** reports CUDA **12.6**, CUDA available, capability **8.6**, and the expected NVIDIA device. A synchronized CUDA tensor operation returned 2.0 before model work. All parameter devices were checked, not merely a requested device string. Laya's stock inference-OOM warning was converted to an exception before its CPU retry; load fallback warnings were also fatal. No OOM occurred. No installed package/runtime source was patched.

RAM peaks were sampled every 20 ms after PyTorch import and include model loading/inference; they can miss briefer peaks and do not include initial interpreter/import peaks. Private commitment is **not physical resident RAM**. CUDA allocator peaks exclude some driver/framework allocations; `nvidia-smi` snapshots include the whole GPU and are not continuous peak measurements. The low Laya RAM minimum warrants a fresh gate before the larger imajev phase.

After both model processes exited: GPU **545 MiB used, 7,474 MiB free, 0% utilization**. A process query found no `python.exe` whose command line included this experiment directory. No resident service was started. Disk free at evidence collection: **461,456,908,288 bytes**, about 6.50 GB lower than initial; unrelated disk activity prevents attributing the entire delta to this experiment.

Setup, both tests and evidence collection completed within **386.45 seconds** from temp-directory creation, comfortably within the 30-minute setup cap. Measured inference sections, including warmups and evidence preparation, took **1.50 s GLiClass / 3.719 s Laya**, below 5 minutes/model. Each process had an external 360-second command timeout plus an internal 300-second inference deadline. These limits were not reached.

## Timing and token method

Four CPU intra-op threads, one inter-op thread, one GPU process at a time. Fixed offline local artifacts; batch size one; one choice question with two options. Two warmups on `trade_direct`, then five immediate repetitions of each case in the fixed order below. No inference overlaps. CUDA synchronized immediately before starting and after returning from each timed call. Timing includes tokenization, input preparation, transfers, forward, and ordinary pipeline postprocessing/answer conversion; excludes downloads, imports/load, extra audit encoding, JSON persistence and resource queries. It is **warm in-process call latency**, not HTTP or integration latency. Repeated inputs may benefit from ordinary library/token caches. No service round-trip claim.

Warmups: GLiClass **364.12 / 13.70 ms**, Laya **507.78 / 42.88 ms**. Warm timed minimum/maximum: GLiClass **11.21 / 20.49 ms**, Laya **32.88 / 99.89 ms**. Aggregate p50/p95 uses linear interpolation over all 80 timed calls; per-case medians below use five calls. All five repetitions returned the same choice on every case. Accuracy counts one answer per case, not 80 independent answers.

GLiClass max input length **256**, actual full formatted input **79–169 tokens**. Laya total max length **512**, question-head budget **256**, actual input **83–173 tokens**. No state or question truncation in any case; Laya reports no dropped state tokens or truncated questions. Neither generates text: output generation tokens are zero, not a hidden reasoning allowance. GLiClass counts were computed with its actual tokenizer on its formatted sequence; Laya's counts agree with its returned usage. Token IDs, decoded/formatted inputs and raw usage are retained per case in the JSON evidence.

## Exact task construction and independent expected answers

Common instruction, verbatim:

```text
Choose exactly one feasible action that best meets the stated objective. Do not treat revenue as profit. Use only the supplied facts.
```

The following option strings and state strings are verbatim. No few-shot examples or hidden economic helper supplied answers to a model. The expected answers and arithmetic were specified before inference in `make_cases.py` / `cases.json`.

### Options (in insertion order)

| Group | First option | Second option |
|---|---|---|
| trade | `trade`: Buy three timber for 2 gold each, craft one chair for a 1 gold fee, sell it for 12 gold and pay a 4 gold market toll. | `work`: Work locally for 3 gold with no fees. |
| sequential | `expedition`: Travel 2 ticks, buy four ore for 2 gold each, travel back 2 ticks, smelt for 2 ticks paying 1 gold, then sell metal for 15 gold paying 3 gold tax. | `local`: Work locally for 3 ticks at 2 gold per tick and buy required food for 1 gold. |
| deadline | `forage`: Travel to berries and gather food, completing in 4 ticks. | `buy`: Buy and eat food now for 3 gold. |
| personality | `gift`: Give 2 of your 10 gold to a hungry ally; ally eats and your final gold is 8. | `keep`: Keep all 10 gold; ally goes hungry. Your own survival is guaranteed. |
| negation | `sell`: Sell the reserved seed for 5 gold now. | `plant`: Plant the reserved seed; later harvest is worth 8 gold. No costs or risk. |
| risk | `safe`: Take a guaranteed 4 gold payment. | `risky`: Take a gamble: 50 percent chance of 12 gold, otherwise 0 gold. |

### States

**trade_direct**
```text
Objective: maximize final gold. Start with 10 gold. Both actions take 4 ticks, with no food need or other costs.
```
**trade_consequences**
```text
Objective: maximize final gold. Start with 10 gold. Both actions take 4 ticks. Trade consequences: spend 6 on timber, 1 crafting, receive 12, pay 4 toll; finish with 11 gold. Work consequences: finish with 13 gold. No food need or other costs.
```
Expected **work** for both: trade net `12 - 3*2 - 1 - 4 = 1`, work net 3; final gold 11 vs 13. Costs are embedded in the trade option rather than a supplied profit label in the direct version.

**sequential_direct**
```text
Objective: maximize final gold while surviving. Start with 12 gold, no food. Every 3 ticks must buy and immediately eat one meal costing 2 gold on expedition; the local job supplies all meals except the stated 1 gold food purchase. Expedition lasts 6 ticks; purchase meals at ticks 3 and 6 before selling. No other costs.
```
**sequential_consequences**
```text
Objective: maximize final gold while surviving. Start with 12 gold, no food. Expedition consequences: ore costs 8, meal at tick3 costs 2, smelting costs 1, leaving 1 before tick6 meal costing 2. Metal sells only after that meal, so expedition fails survival. Even with credit its final gold would be 11. Local consequences: all deadlines met and final gold 17.
```
Expected **local** for both. Sequential cash: `12 - 8 - 2 - 1 = 1`, insufficient for the second 2-gold meal **before** sale proceeds. Even if credit were allowed, expedition net `15 - 8 - 1 - 3 - 2*2 = -1`; local net `3*2 - 1 = 5`, final 17. This tests arithmetic, event ordering and liquidity rather than largest advertised revenue. The direct option text and state jointly specify smelting completion/sale only after the tick-6 meal.

**deadline_direct**
```text
Objective: survive first, then save gold. Start with 5 gold and no food. You die unless you eat within 2 ticks. No other food source.
```
**deadline_consequences**
```text
Objective: survive first, then save gold. Start with 5 gold and no food. You die unless you eat within 2 ticks. Forage consequence: die at tick2 before berries at tick4. Buy consequence: eat at tick0, survive, retain 2 gold.
```
Expected **buy** for both: instant eating meets deadline; four-tick foraging cannot. Saving money is subordinate to survival.

**personality_selfish**
```text
Objective: your own final gold only. Personality: selfish, no value for ally wellbeing. Both actions are feasible.
```
**personality_generous**
```text
Objective: ally eats first, then maximize your own final gold. Personality: generous; sacrifice at most 2 gold to feed ally. Both actions are feasible.
```
Expected **keep** / **gift** respectively: own 10 > 8 under selfish objective; only gift feeds ally within the explicit two-gold sacrifice limit. This is a controlled objective/personality reversal, not an assumption that a trait alone defines utility.

**negation_direct**
```text
Objective: maximize final gold. There is NOT a ban on planting. Do NOT assume selling is compulsory. You have one reserved seed, no survival deadline. Both actions are allowed.
```
**negation_consequences**
```text
Objective: maximize final gold. Planting is allowed, selling is optional. Plant consequence: earn 8 gold. Sell consequence: earn 5 gold. No costs, risk, or survival deadline.
```
Expected **plant** for both: no ban; 8 > 5.

**risk_neutral**
```text
Objective: maximize expected gold. Personality: risk neutral. Both options take one tick; survival guaranteed.
```
**risk_averse**
```text
Objective: maximize guaranteed minimum gold, not expected gold. Personality: strongly risk averse. Both options take one tick; survival guaranteed.
```
Expected **risky** / **safe** respectively: expected gamble `0.5*12 = 6 > 4`; guaranteed safe 4 > gamble minimum 0. These are explicit numerical objectives, not ungrounded trait interpretation.

Four additional cases suffix `_reordered`: **trade_direct**, **negation_direct**, **personality_generous**, **risk_neutral**, with identical state/instruction/options but reversed insertion order. Their expected semantic choices do not change.

### Adapter differences, disclosed

GLiClass labels are the literal `key + ': ' + description`; state is pipeline text and common instruction is pipeline `prompt`. It uses single-label classification and returns all softmax scores with `return_hierarchical=True`. Its uni-encoder formats labels using `<<LABEL>>`, then `<<SEP>>`, instruction and state according to checkpoint `prompt_first`; the exact final string/token IDs are retained, not inferred from the displayed prose.

Laya uses `Agent.predict(state, {'decision': {'type': 'choice', 'instructions': common_instruction, 'criteria': ordered_key_description_dict}}, max_len=512, head_max_len=256)`. This is its native typed decision format. Its exact encoded input, state/option statistics, raw `answers`, `usage`, calibration confidence and action probability are retained. The adapters differ by necessity: this is a task comparison, **not identical token prompts** across architectures. No confidence/action field was used as utility or to repair an answer.

## Actual answers and probabilities

Probability columns show **first option / second option in the original group order above**, even on reordered cases. Rounded to four decimals here; exact GLiClass floats and Laya's native four-decimal values are in JSON. Timings are per-case five-call medians. `G/L tokens` are actual encoded counts; all untruncated.

| Case | Expected | GLiClass answer; probabilities | Laya answer; probabilities | G/L ms | G/L tokens |
|---|---|---|---|---:|---:|
| trade_direct | work | work; .0732/.9268 | trade; .5451/.4549 | 15.85/38.13 | 99/103 |
| trade_consequences | work | work; .4282/.5718 | trade; .7203/.2797 | 12.93/35.94 | 129/133 |
| sequential_direct | local | local; .0785/.9215 | expedition; .6234/.3766 | 12.76/34.89 | 156/160 |
| sequential_consequences | local | local; .4313/.5687 | expedition; .6079/.3921 | 13.59/38.68 | 169/173 |
| deadline_direct | buy | buy; .1918/.8082 | forage; .5356/.4644 | 11.72/38.10 | 88/92 |
| deadline_consequences | buy | buy; .2812/.7188 | buy; .4765/.5235 | 14.11/37.22 | 111/115 |
| personality_selfish | keep | gift; .8809/.1191 | gift; .6202/.3798 | 13.78/34.07 | 94/98 |
| personality_generous | gift | keep; .3056/.6944 | gift; .7884/.2116 | 12.08/35.12 | 102/106 |
| negation_direct | plant | plant; .0116/.9884 | plant; .1491/.8509 | 12.66/38.79 | 98/102 |
| negation_consequences | plant | plant; .4128/.5872 | plant; .3594/.6406 | 12.57/36.65 | 101/105 |
| risk_neutral | risky | risky; .2098/.7902 | safe; .6598/.3402 | 12.12/34.01 | 79/83 |
| risk_averse | safe | risky; .0890/.9110 | safe; .6412/.3588 | 11.60/36.02 | 86/90 |
| trade_direct_reordered | work | work; .1734/.8266 | trade; .5091/.4909 | 12.56/36.29 | 99/103 |
| negation_direct_reordered | plant | plant; .0456/.9544 | plant; .1609/.8391 | 13.15/39.77 | 98/102 |
| personality_generous_reordered | gift | keep; .1080/.8920 | gift; .6130/.3870 | 13.28/38.87 | 102/106 |
| risk_neutral_reordered | risky | risky; .3310/.6691 | safe; .5840/.4160 | 14.01/34.10 | 79/83 |

## Artifacts and exact runtime pins

**Retained temporary evidence — not durable/archived storage:**

```text
C:/Users/OWANLA~1/AppData/Local/Temp/prosper-classifiers-4585jgz9
```

Resolved full-name spelling is `C:/Users/OwanLazic/AppData/Local/Temp/prosper-classifiers-4585jgz9`. Both spellings reference the same directory. Do not delete until follow-up consumption; Windows temp cleanup may remove it later. No unrelated cache was deleted.

- `RETAINED-EVIDENCE.txt`: explicit retention/follow-up label and non-durable-storage warning.
- `gliclass-venv/Scripts/python.exe`, `laya-venv/Scripts/python.exe`: separate environments using existing CPython 3.12.14 AMD64.
- `uv-cache/`: only this experiment's dependency cache; `hf-cache/hub/`: only selected model artifacts. `torch-cache/` was scoped as well (no extra artifact needed).
- `download.py`, `make_cases.py`, `run_model.py`, `collect.py`: complete minimal adapter, fixed tasks and audit commands, retained for rerun. `cases.json` preserves exact ordered task data. No repository runtime adapter was added.
- `gliclass-results.json`, `laya-results.json`: all 80 timed outputs per model, probabilities, timings, actual encoding, raw usage, resources.
- `compact-summary.json`, `downloads.json`, `artifact-manifest.json`, `collection.json`, `start.json`: summary, pins, hashes and measurements.
- `*-install.log`, `*-run.log`, `*-discovery.txt`, `*-freeze.txt`: installation/diagnostic transcripts and complete exact dependency pins.

| Model artifact | Revision | Downloaded files total | Weight size / SHA256 |
|---|---|---:|---|
| `knowledgator/gliclass-edge-v3.0` | `df03993a2ed98e5e4a0d2dd7efbbd105abe874cf` | 134,438,755 B | 130,829,312 B; `ed2600439be991eaab06d831b259e99057a69242acf3a26a61b053695b1b979c` |
| `convaiinnovations/laya`, **typed-decisions/** only | `7b928d828b7b0e022f929d9bd2e44165aa270148` | 846,195,716 B | 842,609,220 B; `4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e` |

Locations under `hf-cache/hub/`: `models--knowledgator--gliclass-edge-v3.0/snapshots/<revision>/` and `models--convaiinnovations--laya/snapshots/<revision>/typed-decisions/`. Complete downloaded config/tokenizer file sizes and SHA256s are in `artifact-manifest.json`; pinned revisions identify them independently of moving main branches.

Scoped logical file sizes: GLiClass venv **5,344,860,618 B**, Laya venv **5,191,162,650 B**, uv cache **5,285,716,907 B**, HF cache **980,647,811 B**. These sums **double-count hard-linked cached files** and are not physical disk consumption. PyTorch's downloaded wheel was about 2.5 GiB. No second global Python or CUDA toolkit was installed.

Primary exact pins: `gliclass==0.1.20`, `laya==0.4.0`, `torch==2.7.1+cu126`, `transformers==5.19.0`, `tokenizers==0.23.2`, `huggingface-hub==1.33.0`, `safetensors==0.8.0`, `numpy==2.5.3`, `psutil==7.2.2`; GLiClass also `scikit-learn==1.9.1`, `scipy==1.18.1`. Complete transitive version locks are retained as `gliclass-freeze.txt` (43 packages) and `laya-freeze.txt` (37 packages). Initial candidate install was unpinned to discover a compatible set once; the resulting set is pinned for reproduction, with no broad version retries. No FlashAttention, torchvision, TensorFlow, Triton, TileLang, Ray or server extra.

### Commands and reproduction

Use explicit native executables, not the machine's bare Proto shims. Commands shown in PowerShell syntax; actual execution used Git Bash quoting with the same arguments. Existing executables:

```powershell
$UV = 'C:/Users/OwanLazic/AppData/Local/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe/uv.exe'
$PY = 'C:/Users/OwanLazic/AppData/Roaming/uv/python/cpython-3.12.14-windows-x86_64-none/python.exe'
$R = 'C:/Users/OWANLA~1/AppData/Local/Temp/prosper-classifiers-4585jgz9'
nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,memory.free --format=csv
& $UV --version # 0.12.10
# Executed once, with a newly-created unique OS-temp R:
& $UV venv "$R/gliclass-venv" --python $PY
& $UV pip install --python "$R/gliclass-venv/Scripts/python.exe" --cache-dir "$R/uv-cache" torch==2.7.1 --index-url https://download.pytorch.org/whl/cu126
& $UV pip install --python "$R/gliclass-venv/Scripts/python.exe" --cache-dir "$R/uv-cache" gliclass psutil
& $UV venv "$R/laya-venv" --python $PY
& $UV pip install --python "$R/laya-venv/Scripts/python.exe" --cache-dir "$R/uv-cache" torch==2.7.1 --index-url https://download.pytorch.org/whl/cu126
& $UV pip install --python "$R/laya-venv/Scripts/python.exe" --cache-dir "$R/uv-cache" laya psutil
& "$R/gliclass-venv/Scripts/python.exe" "$R/download.py"
& "$R/gliclass-venv/Scripts/python.exe" "$R/make_cases.py"
& "$R/gliclass-venv/Scripts/python.exe" "$R/run_model.py" gliclass
# Wait for prior process to exit, then:
& "$R/laya-venv/Scripts/python.exe" "$R/run_model.py" laya
& $UV pip freeze --python "$R/gliclass-venv/Scripts/python.exe"
& $UV pip freeze --python "$R/laya-venv/Scripts/python.exe"
& "$R/gliclass-venv/Scripts/python.exe" "$R/collect.py"
```

`download.py` sets scoped `HF_HOME`, disables Xet transfer, pins revisions and `allow_patterns` (`*.json`, `model.safetensors` for GLiClass; `typed-decisions/*` for Laya), two download workers. It downloaded no other Laya checkpoints. `run_model.py` sets scoped `HF_HOME`, `TORCH_HOME`, `HF_HUB_OFFLINE=1`, `USE_TF=0`; it loads only local snapshots. Rerunning the last model commands overwrites their results, so copy the directory/evidence first if preserving this run. For a clean reconstruction use a new OS-temp directory with copied scripts, install the CUDA wheel first, then each candidate's retained freeze file **excluding its torch line**; do not let a default PyPI wheel replace CUDA12.6. Full package-pin files, hashes and model revisions suffice to reproduce this tested environment; Python/package installation timestamps and mirrors can differ.

## Warnings, failures and next-phase blockers

- GLiClass emitted a Transformers model-type warning (`GLiClass` config vs empty custom model type) and deprecated `use_return_dict` notice. It nevertheless loaded its full 32,705,154-parameter model and completed every case on GPU with finite two-label scores. These warnings were not patched away.
- Laya warned that a shipped `choice:11+` temperature **0.10058280825614929** is outside its accepted `[0.5,5]` interval and clamped it to 0.5. Our tasks have **two** options, not 11+, but this remains a checkpoint calibration warning. BPE cleanup also emitted a nonfatal tokenizer warning. No downstream calibration was fitted; no probability reliability claim.
- Two PowerShell `-Filter` inspection attempts had shell-quoting failures (disk and final process inspection); disk was measured with explicit Python and process inspection repeated successfully using `Where-Object`. These were inspection failures, not model failures; no inference retry resulted.
- Model quality failed multiple hand-labelled tasks despite valid execution. Supplied consequences did not consistently improve accuracy. GLiClass matching could exploit linguistic cues; successful arithmetic cases do **not** demonstrate a learned planning algorithm. No long-context, sustained thermal/throughput, CPU-only, batch or citizen-policy test was run.
- **No imajev was attempted.** Parent can reuse the explicit base Python/uv, scoped uv cache (CUDA12.6 torch wheel), scripts and fresh resource method, but should create a separate imajev venv. Existing Transformers 5.19.0 may supply its architecture; imajev/PEFT compatibility has **not** been verified and this report does not approve dependency reuse blindly. Current roughly 4 GiB available host RAM at the preceding loads fell to 1.09 GiB during Laya loading; imajev-2B's larger host loading needs a renewed resource gate. imajev-4B remains outside this 8 GiB GPU's stock fit.

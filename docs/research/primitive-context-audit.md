# Primitive context representation audit

Offline audit, 8 October 2026. No production changes, real model calls, tokenizer research, downloads, services or durable-world access.

## Result

The primitive adapter already sends compact JSON. Its command schema is duplicated across the manual and the native `format` argument: removing the manual copy would remove **7,000 serialized request bytes per call before replacement explanatory prose** while preserving the API's exact command union. However, `format` is not demonstrably model-readable prompt text, so **that removal is not established as lossless for the model's information**. Reversible repeated-observation encoding is the clearer information-preserving opportunity. Full feedback history is a separate, larger cost; shrinking its cap is information omission, not lossless compaction.

Measured actual adapter requests: **47,380 bytes first**, **64,929 bytes second** with default history. The installed-development-probe history setting instead gives **47,380 / 47,382 bytes**, because it drops the entire 15,581-byte first feedback entry. These are one fresh development fixture's requests, not population quantiles or token measurements.

## Reproduction and boundaries

```powershell
npm.cmd test -- test/primitive-context-audit.test.ts
```

The three repeatable assertions use the actual `runEpisode` → `LocalModelCandidate` path, existing injected-mock transport seam, and the existing audited `OllamaTransport` with injected mock fetch. Setup: `developmentFixture('sell-buy-meal', 7, 2)`, cadence 1, candidate seed 1, two `advance` replies. Inputs/feedback come only from public candidate callbacks. The test never pastes a manifest, privileged trace/world, authored reference action or hidden holding into a prompt. Requests remain in memory; the runner's normal OS-temp audit directories are removed in `finally`.

Measurement configuration: maxPromptBytes 500,000, maxInputTokens 60,000, maxOutputTokens 256; runner default limits except maxModelCalls 2 and maxTokens 120,512. The generous **mock-only byte cap lets the second default-history request be captured**, rather than silently truncated. It is not a proposed production cap. Synthetic receipts are 100 input/10 output per call and are only mock accounting. No actual model/tokenizer receipt exists here. UUID request IDs vary but have constant length in this two-decision probe. Manual hash at measurement:

`e915581224787fe023a104bf4f3ba0cfb9ee091deb1335d0b64f6342dd9da8b4`

Source ownership:

- `src/evaluation/contracts.ts`: genuine `CitizenObservation`, `Command`, public context and committed feedback contract.
- `src/evaluation/candidates/local-model.ts:123–135`: two messages, compact user JSON, full current observation, bounded committed history, cloned decision schema; byte limit fails closed.
- `src/evaluation/mechanics.ts:17,126–137`: manual prose plus compact source-generated tables, including another command schema, with a hashed public contract.
- `src/evaluation/candidates/lifecycle.ts:13,81–96`: whole-entry history bounds and explicit omissions.
- `src/evaluation/runner.ts:196–207`: immediate observation plus every subsequent single-tick projection enter feedback.
- `src/evaluation/candidates/ollama-transport.ts:124–131,174–192`: byte-based input guard, literal template allowance and native request serialization.
- `scripts/evaluate-local.ts:70–72`: actual development probe uses maxPromptBytes 52,000 and history 1 entry / 1,024 bytes.
- `docs/research/evaluation-harness-usage.md`: privilege, accounting, lifecycle and evidence limitations.

## Exact additive breakdown

The adapter's `promptBytes` means UTF-8 length of **`JSON.stringify({messages, format})`**, not all `PrimitiveModelRequest` metadata, HTTP headers, template expansion or tokens. Message content is a JSON string inside that envelope, so quotes/newlines/backslashes are escaped again. The table below assigns every byte once. Observation/history rows include their top-level JSON field names and colon; context contains other user fields and object punctuation.

| Component in serialized messages + format | First request | Second request, default history |
| --- | ---: | ---: |
| Primitive instruction text | 631 | 631 |
| System separator (`\n\n`) | 4 | 4 |
| Manual prose, headings and tables marker | 11,653 | 11,653 |
| Manual source-derived JSON tables | 19,523 | 19,523 |
| Manual trailing newline | 2 | 2 |
| User context: requestId, objective, cadence, horizon, remainingTicks, limits, historyOmissions and object punctuation | 460 | 460 |
| Current observation field | 8,678 | 8,680 |
| History field | 14 | 17,561 |
| Decision JSON schema (`format`) | 6,331 | 6,331 |
| Outer JSON keys, roles, punctuation and content string quotes | 84 | 84 |
| **Total** | **47,380** | **64,929** |

Raw message-content sizes before envelope escaping:

| Content | Raw UTF-8 bytes | Serialized character contribution |
| --- | ---: | ---: |
| System, both requests | 28,861 | 31,813 |
| User, first | 8,138 | 9,152 |
| User, second | 23,721 | 26,701 |
| Manual prose | 11,608 | 11,653 |
| Compact manual tables | 16,619 | 19,523 |

System + decision schema is **38,144 bytes repeated on every call**: 80.5% of the first and 58.7% of the second measured envelope. There is one full manual per request, not two. History does not contain a second manual or schema.

### Observation shape, not a proposed projection

Actual first-observation field contributions inside compact observation JSON. Each raw contribution includes its field name/colon/value, excludes inter-field commas and the observation object's braces. Escaped columns describe these same fragments inside the user content string.

| Genuine observation field | Raw | Escaped |
| --- | ---: | ---: |
| tick | 8 | 10 |
| mapSize | 48 | 56 |
| citizen | 3,767 | 4,279 |
| ascii | 1,451 | 1,491 |
| entityIndex | 209 | 219 |
| visible | 1,798 | 2,130 |
| remembered | 15 | 17 |
| markets | 332 | 390 |
| messages | 13 | 15 |
| alerts | 11 | 13 |
| claims | 11 | 13 |
| alliances | 14 | 16 |

Add 13 bytes of observation-object punctuation: **7,690 raw**, **8,664 escaped**; add its outer `"observation":` key: **7,704 / 8,678**. The second observation differs by two bytes. The test verifies exact deep equality to each genuine observation supplied by the runner, not a hand-authored stand-in.

`src/world/observation.ts:73–174` explains overlap: the projected citizen has a notebook with refreshed visible tiles, `visible` is also supplied, and `ascii`/`entityIndex` are derived from current visible tiles. This is representation redundancy, but simply dropping any field would violate the requested exact observation representation. It must not be confused with permission to summarize stale knowledge, expose hidden action paths, refresh dated memories or eliminate empty tiles.

### Manual tables and duplicated schema

Largest table fields, including their key/colon but not delimiter commas:

| Table field | Raw | Escaped |
| --- | ---: | ---: |
| commandSchema | 5,921 | 6,999 |
| refinementRecipes | 4,305 | 5,027 |
| equipmentRecipes | 2,373 | 2,823 |
| buildingRecipes | 1,868 | 2,206 |
| balance | 920 | 1,038 |
| harvestDurations | 629 | 729 |

The full manual command schema object is 5,905 bytes. The decision schema's nested command object is 5,848 bytes. Offline assertions establish **exact object equality after removing only the manual schema's root `$schema` dialect annotation**. Both include all 19 strict command variants, exact bounds, optional queue semantics and additional-properties rejection. This is not an assumption based on similar prose or a subset sample.

Removing the manual's `commandSchema` field plus its following comma would remove **5,922 raw manual bytes / 7,000 serialized envelope bytes**. The full decision schema would stay untouched. Before new explanatory prose, envelope totals would be **40,380 / 57,929 bytes**. The manual prose currently refers to “commandSchema below”; changing that reference and rehashing/versioning the public manual would be necessary but not sufficient. In `OllamaTransport`, `format` is a separate schema argument, not appended to either message. The code does not establish that the backend renders its complete schema into model-readable text. Removing the manual copy could therefore preserve output constraints while removing the model's only explicit parameter/variant schema. That delivery distinction is a blocker to calling this a proven lossless patch.

The remaining production/recipe tables are expanded explicit values, not a second prose manual. Replacing them with formulas or terse advice is not established as lossless: preserve exact numeric values, legal tier combinations, key ordering where relevant, and defaults. Any reversible matrix encoding would need its own decoding contract and tests, not a claim that the rules are “obvious.”

## Compact versus pretty JSON

There is **no pretty-printing saving to harvest in the current adapter**. All relevant production `JSON.stringify` calls here omit indentation. Test-only counterfactuals parse back to exactly the same tables/user payload.

| Representation, messages + format | First | Second |
| --- | ---: | ---: |
| Current compact | 47,380 | 64,929 |
| Pretty (2 spaces) tables + user JSON inside content strings; outer compact | 71,107 | 105,900 |
| Only outer messages + format pretty, including schema | 59,717 | 77,266 |
| Both inner and outer pretty | 83,444 | 118,237 |

Pretty inner tables contribute 37,137 escaped bytes versus 19,523 compact, adding **17,614**. Pretty user content adds **6,113 / 23,357**. Outer-only pretty adds **12,337** to either request. Outer whitespace is transport/accounting overhead; it is not automatically text supplied to the model. Inner pretty whitespace is actually in message content. Neither byte comparison establishes a token saving or generation-quality effect.

## History semantics and exact duplicate values

Default history is four entries / 32,000 raw serialized bytes. Each feedback entry is serialized compactly as a whole, retained only if it fits. Oversized entries increment `droppedHistoryEntries` and are not inserted; older entries are evicted until aggregate byte/entry bounds fit. The payload re-parses entries and includes them as objects, not double-encoded history strings. It does not keep an assistant chat transcript, raw malformed provider text, authored reference actions, hidden holdings or privileged audit state. Reset/close clears history; each episode gets a fresh candidate.

For this one-tick no-command probe, the first retained feedback object is **15,581 raw bytes**:

- commit: 146 bytes;
- immediateObservation: 7,690 bytes, exactly equal to the first decision's observation;
- observations: one 7,692-byte observation, exactly equal to the second decision's current observation;
- remaining 53 bytes: feedback keys, array/object punctuation.

Thus the second request repeats its entire current observation inside history. This equality is verified for this case, **not assumed universally**. A real command can change immediate state; cadence > 1 delivers intermediate observations; death/clamping can alter the sequence. Discarding intermediate observations, turning history into deltas without a reconstructable base, or omitting the commit changes available evidence.

The development probe's 1,024-byte setting rejects this 15,581-byte entry outright. Second request history is empty and historyOmissions is 1. It saves 17,547 serialized bytes versus retained history, but is explicitly **lossy**. It preserves current observation, not prior committed evidence. This setting must not be described as merely minifying history or evidence that the model received the previous result.

## Visible native envelope and template boundary

The test additionally sends captured public messages/schema through the real `OllamaTransport` serializer with injected mock fetch and a no-op mock owner. No socket/process is used. Captured native `/api/chat` JSON bodies are **47,516 / 47,518 bytes** for first request / second small-history request. Native model/options/think/stream/keep_alive fields add **136 bytes** beyond messages + format for `qwen3.5:9b`, seed 1, context 65,536 and output 256. HTTP headers, responses and preflight metadata are not counted in those body totals. Adapter endpoint/request metadata is not blindly copied into the native body.

Template evidence is deliberately limited: mock `/api/show` supplies the existing transport-test placeholder `{{ .Messages }}` (**15 literal UTF-8 bytes**). This is **not** the installed Qwen template or its rendered expansion. The code's fixed allowance is **4,096 + 1,024 × 2 = 6,144** conservative token-bound units, then it adds verified literal template bytes. Those allowance numbers are not measured template tokens or bytes sent to the model.

At the test's 60,000 input-token bound, the default-history second request gives **64,929 + 6,144 = 71,073**, so the native transport rejects **before even mock preflight HTTP**. The real development adapter's 52,000-byte cap would refuse that request earlier if default history were substituted. Even deleting the duplicated schema would leave **57,929 + 6,144 = 64,073** before literal template bytes, still above 60,000. Schema deduplication alone therefore does not make default-history replay fit that reservation.

Do **not** lower maxInputTokens based on any guessed bytes/token ratio. Bytes are not tokens. Exact tokenization, actual installed template expansion, grammar serialization and defensible tighter bounds belong to the model scout. The native guard and reservation remain unchanged by this audit.

## Actionable choices, no implementation proposed as already done

1. **Smallest apparent duplication: schema deduplication, conditional only.** Removing manual tables.commandSchema retains exact command-union validation/grammar and saves 7,000 serialized bytes less new prose, but is not a proven model-information-lossless patch. First establish whether the actual backend already renders that schema into model-readable context. If not, retain an explicit model-readable complete schema, or approve/test a reversible equivalent encoding of every variant/field/bound/default; a pointer to an invisible `format` does not suffice. A separately approved removal experiment would change available prompt information, not just whitespace. Any patch must update manual reference/version/hash and preserve every other rule/table and observation/feedback value. Tests: exact command-schema equivalence across all tiers/variants, unchanged non-schema tables and observations, reference/hash consistency, strict decoder/mock transport/budget checks, and demonstrated schema delivery rather than API equality alone. Do not remove output `format` instead or weaken validation.
2. **Larger reversible encoding: repeated observation references.** Intern identical JSON observation values within each request and substitute explicit references to a full value carried in that same request. Decode must reproduce the complete CandidateFeedback and current CitizenObservation exactly, including order, timestamps, empty fields and numeric values. This could avoid the 7,692-byte repeated current observation here before reference overhead. It needs an explicit prompt encoding/version, collision-safe equality and round-trip tests for post-command immediate differences, multi-tick cadence, stale memory and empty histories. No unmeasured saving or model usability claim is made; do not drop the duplicated field without its reconstruction contract.
3. **Keep compact JSON and stateless request completeness.** No whitespace patch is needed. Ollama receives fresh explicit messages on each `/api/chat` call, with no conversation ID or server-side retained-history contract. Omitting the manual/schema after the first request is not lossless under this API. Backend cache/prefix reuse, if later investigated, is a different question from sending less required content.

**Requires separate approval, not a representation-only patch:** dropping ascii/entityIndex/notebook fields outright; top-N entities; truncating visible/remembered tiles; reducing recipes/command variants to fixture needs; omitting failed commits, intermediate ticks or entire oversized history; objective-based “relevance” filters; shortened mechanic recommendations; refreshing dates; prompts containing privileged fixture/reference information. Reversible encodings can preserve information, but must prove reconstruction rather than relabel these omissions as compression.

## Verification and limits

Three offline audit tests and repository TypeScript checking pass. Tests assert additive byte accounting, pretty/compact JSON equivalence, genuine observation identity, complete nested-schema equivalence, committed-history identity and omissions, real native serialization under mock HTTP, and preflight bound refusal. They do not establish exact tokenizer counts, model behavior, real template size, live throughput, held-out generalization or a causal quality benefit. No production/contracts/config/packages/checkpoint documentation was edited; only this report and the repeatable offline test were added.

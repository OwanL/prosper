# Modern ML combined with game AI: concrete mechanisms and evidence

Date: 2026-10-09. Companion to [working research](../citizen-intelligence-research.md). Follow-up to the [first literature pass](2026-10-08-literature-pass-1.md), not an exhaustive survey or an independent replication.

## Question and scope

The user wants alternatives supported by actual research, not labels such as “utility AI” or an assumption that a universal classifier selecting heuristic candidates is sufficient. Recent discussion proposed an authored hierarchical controller, chess-like selective lookahead, and heuristic nomination followed by classifier selection. None is selected. This review examines six concrete systems, mostly 2025 publications plus a 2026 preprint; Dreamer is revisited from the earlier review.

Primary methods/results were inspected, including full PDF text for GLIDER, the board-game search paper and HiAgent, and primary HTML for DreamerV3, SIMA 2 and Odysseus. Paper claims are distinguished below from proposed transfer to Prosper. No model acquisition, training, inference, services or implementation were performed. Published compute is not measured laptop feasibility. Search abstracts were discovery aids, not the sole basis for these evidence cards.

## Main findings

- **There are stronger precedents than adding a classifier to an authored shortlist.** They learn subgoal-conditioned execution, action values, environment predictions or policies from outcomes, rather than assuming a generic pretrained model already knows what decisions are valuable.
- **Search and training are different places to spend computation.** MAV searches at decision time; Dreamer uses imagined futures to train a policy that acts without online lookahead. Neither is simply “an LLM chooses the best label.”
- **Hierarchy has measured benefits, but its temporal semantics still need inspection.** GLIDER learns its decomposition/execution relationship; SIMA 2 demonstrates slower deliberation over a trained fast executor. This does not prove robust management of indefinite competing citizen goals.
- **Memory design can change competence even without new weights.** HiAgent's subgoal-based compression and retrieval beat both full-history prompting and decomposition alone. Its finite benchmark tasks are not evidence of lifelong economic memory.
- **The acquisition cost is substantial.** Domain-trained 2.7B chess models, millions of game interactions, demonstrations and large accelerator budgets should not be mistaken for capabilities of our unchanged local Qwen4B.
- **None of these papers demonstrates Prosper's full target.** Independent economically motivated citizens, private information, endogenous goals, evolving counterparties and persistent market commitments remain a transfer problem. Most evaluations give an agent a task or fixed reward objective.

## 1. GLIDER: learn the hierarchy, rather than author every strategic branch

Primary: [Hu et al., ICML 2025](https://proceedings.mlr.press/v267/hu25q.html), [full paper](https://raw.githubusercontent.com/mlresearch/v267/main/assets/hu25q/hu25q.pdf). Methods §§3.1–3.5; results Tables 1–2; implementation/online adaptation Appendices A–D.

**Control flow:** task description + observation → high-level policy generates a textual subgoal → low-level policy takes primitive actions conditioned on that subgoal and successive observations → high-level policy chooses the next subgoal. The formal model holds a subgoal for `c` actions. This is learned temporal abstraction, not a hand-authored buy/gather/loot decision tree.

**Where capability comes from:** benchmark expert trajectories are decomposed into subtasks by GPT-4. Expert and medium-quality trajectories train a shared pretrained backbone with LoRA and critic heads: behavior cloning first, then offline RL using value/Q estimates and advantage-weighted token likelihood. High-level reward aggregates environment progress; low-level reward reflects subgoal completion. Main models are Mistral-7B, Gemma-7B and Llama-3-8B, with 1B/3B scale ablations. This is not a frozen model plus hierarchy prompt alone.

**Evidence:** on ScienceWorld unseen tasks, the Llama-3-8B model scores 68.34 versus ETO's 52.33. The same-backbone SFT+offline-RL hierarchy ablation scores **53.94 without hierarchy / 68.34 with it**. At 1B and 3B the equivalent pairs are 48.48/53.62 and 56.93/61.29. On ALFWorld unseen tasks, Llama-3-8B reports 75.38 versus ETO's 64.18. ScienceWorld progress scores and ALFWorld performance must not be treated as an interchangeable cross-benchmark scale.

**State and limitations:** subgoal persistence is explicit, but `c` selection, early termination and interrupt behavior are insufficiently specified to transplant directly. Completion-check prompts appear in the appendix; their relationship to the fixed-`c` loop is not fully resolved. Online adaptation is distinct from offline training. The paper's shared parameters also complicate the claim of freezing the low-level policy during adaptation. These are supplied tasks in ScienceWorld/ALFWorld, not endogenous economic goals. Training accelerator counts/types and local inference residency were not established in the inspected paper.

**Prosper hypothesis:** train a reusable executor conditioned on a goal or subgoal, while a slower policy learns when and why to select it. Evaluate whether learned decomposition adds value over authored decomposition. Explicit commitment, interruption and order lifecycle still belong in the execution contract.

## 2. MAV: a model supplies consequences and value to an explicit search controller

Primary: [Schultz et al., ICML 2025](https://proceedings.mlr.press/v267/schultz25a.html), [full paper](https://raw.githubusercontent.com/mlresearch/v267/main/assets/schultz25a/schultz25a.pdf). §§2–5; Appendix A; Tables 1–3.

**Control flow:** a single decoder-only Transformer predicts legal moves, successor state, terminal outcome and action values. An external Monte Carlo Tree Search controller selects paths, asks the model to expand/evaluate positions, backs up values, and ultimately chooses the most-visited root action. The search prior is derived from predicted action values over the top five moves, with an exploration mixture, not a separate generic classifier score. Chess, Chess960 and Connect Four planning use learned transitions; **Hex is an exception using an engine inside search**. Real evaluation games still use OpenSpiel, and training labels come from engines.

A separate internal-search variant learns to emit a serialized minimax tree from engine-annotated examples. That is different from the external MCTS loop.

**Where capability comes from:** 2.7B MAV and 1B MAV-small are initialized from scratch and pretrained exclusively on domain game text, not ordinary chat pretraining. Chess includes roughly 3.1 billion positions and 54.3 billion action-value annotations, derived from game data and Stockfish evaluations. High transition/legality accuracy therefore follows substantial domain supervision.

**Evidence and cost:** 2.7B MAV's searchless mean-value baseline has estimated chess Elo 2923; MCTS with 1,000 simulations has 3157. These are calibrated against Stockfish levels, not independently measured human tournament ratings. **100 simulations average 39.82 seconds per search; 1,000 average 378.32 seconds.** The paper explicitly says its system cannot play at blitz time controls. Inference hardware/VRAM and training accelerator cost were not established in the inspected text. The baseline is a searchless action-value model, not a pure direct-policy ablation.

**Prosper hypothesis:** use learned value estimates and uncertain outcome predictions to guide bounded search, rather than ask a model to rank unsupported labels. Prosper already supplies mechanics; it need not relearn accounting or command legality. Search should predict uncertain counterparties from permitted knowledge, not run privileged future world state as an oracle. Perfect-information board games and externally defined victory do not establish market forecasting or private goal formation.

## 3. DreamerV3: learn from imagined futures, act with a compact policy

Primary: [Hafner et al., Nature 2025](https://www.nature.com/articles/s41586-025-08744-2), Learning algorithm, Minecraft, Scaling properties and Methods. This revisits a system already covered in the first literature pass.

**Control flow during training:** collect observations/actions/rewards → learn a recurrent latent world model → generate imagined state/reward trajectories → train an actor to choose rewarding actions and a critic to estimate returns beyond the imagination horizon. The recurrent state incorporates past observations/actions; the critic supplies longer-term value beyond the 16-step imagined rollout.

**Control flow during play:** update the latent state from actual observations and sample an action from the actor, **without online lookahead**. It is inaccurate to describe Dreamer as doing chess-like search on each move. Its expensive anticipation is largely used to acquire the policy.

**Evidence and cost:** more than 150 tasks use fixed algorithm hyperparameters, but separate agents are trained; this is not one universal ready-made checkpoint. Model scaling experiments span 12M–400M parameters. All reported Minecraft training runs discover diamonds within 100 million environment steps, without human demonstrations or an adaptive curriculum; the paper reports approximately **nine days on one A100 GPU per agent**. It also uses supplied rewards for a 12-item progression, abstract crafting actions and accelerated block breaking. “From scratch” does not mean unmodified game mechanics, no rewards or no human environment design.

**Prosper hypothesis:** a small learned recurrent actor/value system may provide fast continuous citizen decisions, with training using real or predicted transitions. Structured observations could avoid the visual perception burden. Those are plausible adaptations, not proven reductions in training cost. Recurrent memory is a belief representation, not a durable ledger of active orders or explicit promises. Reward design, preferences, goal conditioning, multi-agent non-stationarity and information boundaries remain unresolved.

## 4. SIMA 2: train the executor and compose it with slower reasoning

Primary: [SIMA Team, technical report 2025](https://arxiv.org/html/2512.04797), §§3.2–3.3, 4.2–4.5. This is SIMA **2**, not the original 2024 SIMA.

**Base agent:** Gemini Flash-Lite is trained on human gameplay trajectories, synthetically generated bridge data connecting instructions/reasoning to actions, and non-gameplay data to preserve general capabilities. It receives video and instruction/history and produces structured keyboard/mouse action chunks, dialogue and reasoning. It has no privileged game-state input. Training/evaluation includes commercial games such as No Man's Sky, Satisfactory and Valheim, plus held-out ASKA/Minecraft evaluations.

**Slow/fast composition:** in §4.4, a separate Gemini Pro model observes recent video every `k` steps, emits instructions to SIMA 2 and carries a textual summary into its next call as recurrent memory. A campfire-building demonstration shows multi-step decomposition/progress handling. This particular slow/fast example is qualitative evidence, not a clean matched quantitative proof that adding the planner improves every task.

**Evidence:** base Gemini without action fine-tuning succeeds on only **3.2% (Flash-Lite) / 7.0% (Pro)** of the programmatic evaluations across the ten training domains, despite prompt-engineering efforts. SIMA 2 roughly doubles SIMA 1's average success in the report's evaluations. In held-out MineDojo, it completes tasks in 26 of 50 categories; that is **category coverage, not a 52% episode success rate**.

**Self-improvement:** a Gemini task setter proposes tasks; a separate Gemini reward model scores trajectories; the agent trains on scored self-generated experience. The reward rubric is calibrated against human preference pairs. In held-out ASKA, a fixed task set eventually exceeds the reward model's success threshold across tasks. This is a separate learning process, not proof that each live citizen continually updates weights correctly or autonomously forms economic goals. Model-scored success requires an external outcome check to avoid circular evaluation.

**Prosper hypothesis:** the language model could be a slower deliberator or a training-time teacher/task proposer while a trained executor handles continuous activity. Exact model parameters, local checkpoint eligibility and consumer-GPU deployment cost were not established by these inspected sources. Copying the pretrained-model names is not a local implementation plan. Structured game inputs make video/motor training unnecessary for Prosper; the transferable question is trained execution plus persistent deliberation.

## 5. Odysseus: interaction training matters more than a stronger zero-shot prompt

Primary: [Li et al., preprint May 2026](https://arxiv.org/html/2605.00347), §§3–7 and Table 2. This is a preprint, not reported here as a peer-reviewed accepted paper.

**Mechanism:** Qwen3-VL-8B-Instruct gets lightweight supervised initialization from about 5,000 game frames with teacher-generated responses, then PPO reinforcement learning in Super Mario Land. A small turn-level CNN critic supplies long-horizon value/credit assignment; positive-advantage filtering and a multi-level sampling curriculum stabilize learning. This differs from using a second large model as a token-level critic. The game protocol uses current frame + instructions, not a persistent full observation history, with buttons held for a fixed frame skip.

**Evidence:** Table 2 average progress on five levels used for RL training is **270.23 base / 261.77 SFT-only / 1354.93 RL-on-base / 1511.90 RL-on-SFT**. Progress means horizontal distance, not level completion. The trained model's 5.59× gain over base is predominantly a training-level result. The paper separately reports 41.5% relative improvement on states from held-out levels and 23.1% on Super Mario Bros.; those are smaller transfer effects, and remaining Super Mario Land levels also appear in the SFT frame collection. PPO with the turn-level critic outperforms critic-free GRPO/Reinforce++ in its controlled long-horizon study.

**Cost and limits:** tens of millions of interaction samples, an 8B visual actor and dense forward-progress reward read from RAM. GPU count/type and desktop training/inference residency were not established in the inspected text. Current-frame control over 100+ turns does not establish persistent goal memory, economic planning or arbitrary self-chosen goals.

**Prosper hypothesis:** if a pretrained model is selected, test whether adapting it using actual task outcomes is necessary instead of assuming prompt/architecture changes provide competence. A small outcome/value estimator may be more important than another universal classification node. No transfer or affordable training result is claimed for Prosper.

## 6. HiAgent: subgoals also organize working memory

Primary: [Hu et al., ACL 2025](https://aclanthology.org/2025.acl-long.1575/), [full paper](https://aclanthology.org/2025.acl-long.1575.pdf), §§3–5 and Tables 1–3.

**Mechanism:** an LLM creates a subgoal, retains detailed action/observation history for that active subgoal, and replaces completed subgoal histories in the prompt with summarized outcomes. Full past trajectories remain available for selective retrieval. This differs from silently dropping a prior observation because a byte cap was exceeded, and from assuming a larger context fixes memory. Summarization is lossy and must not be described as exact reconstruction.

**Evidence:** with GPT-4 Turbo and a 30-step cap, average task success is **21% full-history baseline / 42% HiAgent**, with about 35% less mean context and 19% less runtime. The five tasks are Blocksworld, Gripper, Tyreworld, Barman and Jericho; only the last is a text adventure suite. Tyreworld success is **10% baseline / 40% subgoals with full history / 60% HiAgent**. Thus decomposition alone is not the whole gain. These are supplied finite tasks and a hosted model, not evidence of local Qwen memory competence or indefinite lifelong autonomy.

**Prosper hypothesis:** active intentions should determine which outcome evidence is readily available, while archived details remain retrievable. Structured facts for commitments, amounts, deadlines and confirmed results can be retained exactly; prose summaries should not replace authoritative economic state. This is a memory mechanism worth comparing across architectures, not necessarily a competing full controller.

## What would constitute genuinely different Prosper candidates?

These are proposed research translations, not an implementation shortlist selected by the literature:

1. **Learn temporal execution from experience:** a policy chooses subgoals and a trained executor pursues them across actions. Compare learned decomposition against explicitly authored branches. GLIDER and the SIMA 2 slow/fast composition motivate this question.
2. **Learn consequences and value, then search at decision time:** use exact known mechanics plus uncertain predictions to explore bounded alternatives. Compare search against the same learned value model without search. MAV motivates this separation, not its enormous chess data pipeline or latency.
3. **Train anticipation into a cheap recurrent policy:** imagination/interaction learning acquires action selection and long-term value; live decisions need no repeated large-model deliberation. Dreamer motivates this, while Odysseus shows that adapting an existing foundation model is another training route.

Subgoal-based working memory and persistent goal/plan/action lifecycle can be compared across these designs. They are not automatically solved by any of them.

Before selecting one, distinguish what is supplied (goals, alternatives, demonstrations, rewards, forecasts, skills), what is learned, and what changes from an individual citizen's experience. A common reward function does not establish personality-sensitive valuation; a general training algorithm does not establish generalization without retraining. Preserve public/known actor inputs and actual mechanics, use horizons that allow competing means, and verify feedback delivery. Separate training-level proficiency, held-out transfer, within-life adaptation, inference throughput and acquisition cost.

**Conclusion:** the strongest support here is for learning grounded predictions/value or temporally extended policies, and for treating memory as part of the decision mechanism. There is no evidence-led reason yet to declare a heuristic-shortlist classifier, a large hand-built tree or a direct LLM the winner. The next design decision should be which of these concrete capability mechanisms is affordable and testable in Prosper, not which architecture label sounds most flexible.

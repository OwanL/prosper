# Citizen intelligence: first divergent literature pass

Date: 2026-10-08. Companion to [working research](../citizen-intelligence-research.md).

Scope: nine primary papers spanning model-free/goal-conditioned learning, learned world models, compression, language agents and evaluation. Findings below come from primary paper methods/results/appendices, read directly or through bounded source-only extraction. These are not independent replications. Literature coverage remains selective, not systematic or exhaustive; foundational hierarchy, classical planning/search and economic mechanism research need further work.

## Findings across approaches

1. **A compact deployed policy can be capable, but cheap inference does not imply cheap acquisition of capability.** Distillation compresses a trained teacher; STEVE-1's inexpensive adaptation inherits substantial pretraining. Neither supplies a ready-made Prosper policy.
2. **Temporally extended behavior has evidence behind it, but hierarchy alone does not confer intelligence.** Voyager composes supplied APIs; STEVE-1 needs externally supplied decomposition for longer tasks; XLand learns over a heavily engineered task distribution. The boundary between action implementation and strategic scripting must be explicit.
3. **There are precedents for learned adaptation and exploration without per-situation strategic rules.** Their objectives, curricula and training environments are still designed. Reward design is not evidence of hand-scripted strategies, nor is it neutral.
4. **The strongest practical evaluation lesson is to separate training success from transfer.** Unseen conditions, unfamiliar opponents and lower-tail failures matter. Self-play, average return and lively dialogue can all conceal weakness.
5. **No reviewed result establishes that the current local Qwen model can control a whole Prosper society intelligently, or that an affordable newly trained dedicated policy can replace it.** Both remain hypotheses.

## Evidence cards

### A. DreamerV3: world-model-trained policies

Primary: [Mastering Diverse Domains through World Models, v2](https://arxiv.org/html/2301.04104v2), algorithm, results, Minecraft and methods.

- Learns recurrent latent dynamics from replay and trains actor–critic behavior on imagined trajectories. More than 150 tasks use common algorithm hyperparameters, but **separate agents are trained**, not one universal pretrained policy.
- Reported Minecraft agents discovered diamonds within 100 million environment steps without demonstrations or adaptive curriculum.
- Minecraft training took approximately nine days on one A100 GPU per agent. Model-size experiments span 12M–400M parameters; increasing model/replay compute improved data efficiency.
- Minecraft rewards acquisition of 12 item types and modifies block-breaking behavior. This is not a demonstration of arbitrary self-chosen objectives or persistent multi-agent economics.
- Relevance: learned prediction may improve decision-making. Open question: is the gain worth its training cost in Prosper's much simpler, structured environment? Do not assume Dreamer requires online tree search; imagination primarily trains its policy.

### B. XLand: task diversity and goal-conditioned adaptation

Primary: [Open-Ended Learning Leads to Generally Capable Agents](https://arxiv.org/html/2107.12808), §§5–6 and appendices A.3–A.7.

- Goal-conditioned recurrent policies use V-MPO, dynamically selected tasks, population-based training and five generations with teacher distillation.
- Final reported held-out participation is 95%; participation means obtaining some reward, not mastering every task. Reported normalized tenth-percentile performance is 82%, median 112%, relative to paper reference policies, not an optimal oracle.
- Each agent used eight TPUv3s at approximately 50,000 steps/second. The advertised 30-minute fine-tuning consumes 100 million steps after substantial pretraining; ablations involve 16–20 billion steps.
- Tasks and reward predicates are generated within an engineered language. Learned strategies are not per-situation scripts, but training conditions and goals are designed.
- Relevance: hold out task combinations and opponents; distinguish zero-shot behavior, within-episode adaptation and fine-tuning. Scale is not evidence of desktop feasibility.

### C. Policy Distillation: compact deployment

Primary: [Policy Distillation, v2](https://arxiv.org/html/1511.06295v2), §§3–4, appendix A and table B1.

- Students imitate trained DQN action-value distributions. Across ten Atari games, a 113,346-parameter student versus 1,693,362-parameter teacher achieved 101.7% geometric-mean teacher performance; a 61,954-parameter student achieved 83.9%.
- Averages hide regressions: the roughly 15× smaller student retained 49.4% of teacher performance on Space Invaders.
- Standard student training used 500 hours of teacher gameplay and a few GPU days, **plus teacher training**. Simulated gameplay hours are not wall time. Evaluation included human-generated starting states outside student training trajectories.
- Relevance: a dedicated small policy need not be intrinsically weak. But distilling current scripted behavior establishes compression, not discovery of superior strategy; held-out economic transfer is untested.

### D. Voyager: language-driven executable skill accumulation

Primary: [Voyager](https://arxiv.org/html/2305.16291), §§2–4, tables 1–2, appendices A.4/B.1–B.4.

- GPT-4-0314 generates curriculum, programs and success critiques; GPT-3.5 supports contextual questions and descriptions. No model weights are updated. Learning is accumulation/retrieval/composition of verified code.
- Supplied Mineflayer APIs implement navigation, mining, crafting, smelting, combat and inventory operations. Structured state bypasses visual perception. Death preserves inventory, and crafting tables/furnaces are recycled after execution.
- Three trials per method, 160 prompting iterations for exploration; 63 unique items reported, 3.3× comparison. Diamond tools succeed in **one of three** exploration trials. These are prompting-iteration results, not equal wall-time/API-call budgets.
- Four unseen transfer tasks use a new world and cleared inventory but retain the skill library; full Voyager succeeds in three of three trials for each under a 50-iteration budget. GPT-4 task decomposition is supplied to both Voyager and AutoGPT in transfer.
- Removing verification reduces item discovery 73%; random curriculum reduces it 93%. Replacing only the code generator with GPT-3.5 yields 5.7× fewer unique items while curriculum and verification retain GPT-4.
- Relevance: executable skill reuse and feedback have measured value in this setup. Non-transfer: tiny trial count, strong cloud model, extensive supplied mechanics and no multi-agent economy. This is not evidence that Qwen 9B reproduces the result. Total token/dollar/wall-time costs were not found in the reviewed paper.

### E. STEVE-1: learned execution conditioned on instructions

Primary: [STEVE-1, v2](https://arxiv.org/html/2306.00937v2), §§3–5 and appendices B–E.

- A 248M-parameter VPT-based policy follows text/visual goals from raw pixels and keyboard/mouse actions. Demonstrations focus on 11 tasks achievable in 2.5 minutes.
- Reported prompting gains over unconditional VPT include 4.9× wood and 4.3× travel; these are task-specific improvements, not generalized strategy results.
- Direct tower/plank instructions have near-zero success. Externally chained **visual** subgoals raise success to 50%/70%. Fixed-duration externally authored decomposition is not autonomous long-horizon planning.
- The often-quoted $60 is **marginal instruction adaptation**, not total capability cost. It inherits VPT pretrained on 70,000 gameplay hours and MineCLIP. Policy data contains 54M frames; default training processes 100M frames on four A40 GPUs.
- Random initialization can collect dirt but cannot find/chop trees in the reported comparison. Some baseline results use different episode durations and counts; avoid interpreting ratios as a perfectly matched benchmark.
- Relevance: a learned executor can replace low-level behavioral rules, given suitable training. There is no comparable pretrained Prosper executor, and short-horizon execution is distinct from choosing goals.

### F. Concordia: generative social simulation infrastructure

Primary: [Generative agent-based modeling using Concordia](https://arxiv.org/html/2312.03664v2), §§2–5 and appendix A.

- Modular memory/components produce action proposals; a Game Master resolves attempted actions and observations. Python components can track grounded variables and invoke actual APIs; not all adjudication is purely language-based.
- Example scenarios include elections, scheduling, bargaining and social disputes.
- **No controlled quantitative Concordia result establishing strategic competence was found in this paper.** It presents a framework, examples and proposed evaluation applications; later work may contain evidence not reviewed here.
- The paper identifies generalization, fidelity and robustness as validation needs and discusses stochastic narrative drift. API waiting is a stated performance bottleneck; configurable parallel component updates conflict with a one-at-a-time local model's constraints.
- Relevance: useful conceptual separation of actors, memory and grounded outcomes. Not proof that narrative plausibility measures intelligence. Prosper already has authoritative mechanics and need not replace them with an LLM referee.

### G. Melting Pot: unfamiliar-agent evaluation

Primary: [Scalable Evaluation of Multi-Agent Reinforcement Learning with Melting Pot](https://arxiv.org/html/2107.06857), §§4/7 and appendix A.

- Train on familiar substrates, test with withheld background populations. Distinguishes visitor (candidate minority), resident (candidate majority), and universalization tests.
- Across 21 substrates and roughly 85 scenarios, strong self-play can conceal poor unfamiliar-partner performance. Prosocial variants perform near random on some coordination transfer tests despite good training scores, while helping substantially in Clean Up.
- Baselines train for one billion steps per substrate. This is an evaluation precedent, not a lightweight training recipe.
- Mechanics remain familiar. Background behaviors and scenario weighting are designed; rankings are conditional. Scenario-trained exploiters are comparators, not proven upper bounds.
- Relevance: separately evaluate fixed opponents, mixed populations and all-candidate societies; include consequences for other citizens and lower-tail failure, not only focal profit.

### H. Procgen: procedural generalization

Primary: [Leveraging Procedural Generation to Benchmark Reinforcement Learning](https://arxiv.org/html/1912.01588), §§2–4.

- Sixteen procedural games distinguish learning efficiency from zero-shot transfer after finite-level training. Standard generalization uses 500 training levels and unseen test levels.
- Some environments require up to 10,000 levels to close the training/test gap. Fixed-level sequences can produce convincing training performance and poor randomized transfer.
- Standard 200M-step runs cost approximately 24 GPU-hours and 60 CPU-hours per game in the authors' setup. Primarily perception/control tasks with limited default memory demands.
- Relevance: reserve seeds and meaningful condition combinations before tuning. A small generalization gap is meaningless if both absolute scores are low. Same-generator seed transfer is weaker than changed rules or opponents.

### I. Crafter: capability profiles

Primary: [Benchmarking the Spectrum of Agent Capabilities](https://arxiv.org/html/2109.06780), §§3.3–4.4.

- Twenty-two observable achievements in one survival/crafting world; aggregate uses a shifted geometric mean, emphasizing breadth rather than repeating easy tasks.
- Standard 1M-step protocol over ten training seeds reports DreamerV2 10.0%, PPO 4.6%, Rainbow 4.3%, random 1.6%. These are aggregate scores, **not episode completion percentages**. Tested baselines do not reach iron-tool/diamond achievements within that budget.
- Each baseline run took under 24 hours on one GPU. Qualitative tunnels/shelters/plantations came from a separate 50M-step investigation, not standard-budget results.
- Standard scoring covers training episodes rather than exclusively held-out frozen policies. Achievements entangle execution, exploration and planning.
- Relevance: use observable capability profiles, and distinguish learning curves from final held-out tests. Survival alone misses most competence.

## Economic-literature gap

[Gode and Sunder (1993), Allocative Efficiency of Markets with Zero-Intelligence Traders](https://www.journals.uchicago.edu/doi/10.1086/261868) is an important lead: how much apparent efficiency follows from market constraints rather than agent intelligence? The full primary text could not be extracted in this pass, so no quantitative finding is adopted here. Random funded orders are not equivalent to their valuation-constrained experimental traders. Trade volume alone cannot establish gains from trade.

## Implications for research design, not architecture selection

A useful comparison has three separable levels:

1. **Opportunity and interface:** prove that a beneficial behavior exists and that an agent with the permitted information can express it.
2. **Task capability and adaptation:** evaluate objective completion, resource/time cost and response to changed conditions on held-out cases.
3. **Social robustness:** vary partners/competitors and population composition, reporting both individual and population consequences.

Include non-market cases such as navigating a changed resource landscape, completing a multi-step production objective and provisioning another citizen. Markets remain one diagnostic of reasoning, not its definition.

Keep equal information/action authority separate from equal compute. Record both. Distinguish frozen-policy transfer, memory-based within-episode adaptation and weight updates. Interacting citizens are not independent statistical samples; worlds/seeds are the comparison units.

## First empirical check

The [retained-person interface probe](2026-10-08-interface-probe.md) reproduced a contradiction between actual model context and policy validation in a synthetic two-citizen world. An actor shown in relationship/evidence context was rejected as unknown; exposing the actor visibly made the identical policy succeed. Zero model calls were needed.

This does not evaluate intelligence or explain every historical rejection. It establishes that at least one observed failure class can be caused by the interface rather than a bad strategic choice. That distinction must be controlled in any architecture comparison.

## Next discriminating work

- Complete the under-covered classical planning/search and economic-incentive branches before converging.
- Run a small opportunity audit: can alternative strategies demonstrably improve outcomes, including acquisition/travel/maintenance costs? Use diagnostic schedules only as feasibility witnesses, not the desired agents.
- Specify a compact, held-out task/perturbation set before spending local-model calls or discussing training. Compare current policy authority with executable action authority only when the difference is explicit, not hidden in a purported model-quality A/B.
- Measure headless throughput before setting a credible learned-policy training budget. No training authorization or architecture decision follows from this pass.

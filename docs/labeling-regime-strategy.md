# Regime Labeling Strategy

This document captures the current working recommendation for improving
market-regime labels in Alchemist Labeler.

Manual labels are not the primary production path. They are audit samples for
calibrating weak-label rules, checking taxonomy quality, and producing a small
set of high-confidence training examples.

The key point is that the immediate problem is not reviewer eyesight or a
lack of traditional candlestick-pattern knowledge. The problem is that the
label taxonomy has not converged enough to produce stable, repeatable labels.

If label definitions are unstable, more chart review will mostly create more
noisy labels. The first priority is therefore to define a small, auditable
market-structure vocabulary and a weak-supervision workflow that lets rules do
the broad pass while humans audit uncertain or high-value samples.

## Current Concern

The current four-class set:

```text
uptrend
oscillation
pullback
sideways
```

is too compressed for the structures we need to label.

The main problems are:

- There is no `downtrend`, so selloff structures are forced into unrelated
  labels.
- `pullback` is ambiguous because it depends on a higher-level trend direction.
- `oscillation` and `sideways` can be confused unless their trading value and
  range structure are explicitly separated.
- There is no label for unstable bridge states such as spikes, failed
  breakouts, rejection, exhaustion, or first rebound after a crash.

Without extra labels, these transition areas will be pushed into stable
regime classes and pollute training data.

## Do Not Start From Traditional Pattern Names

Traditional chart-pattern names are useful for human discussion, but they
should not be the foundation of the machine label taxonomy.

Examples:

```text
double bottom
rounded bottom
V reversal
inverse head and shoulders
box breakout
```

Many of these are different appearances of the same underlying structure:

```text
downward impulse -> selling pressure decays -> absorption -> right-side repair
```

They are also hard to label consistently. For example, a "head and shoulders"
depends on where the neckline starts, when the right shoulder has failed, and
whether the structure is visible in real time or only obvious in hindsight.

For training data, result-based pattern labels can introduce subtle lookahead
bias. A structure that is later called a "double bottom" may have been only a
weak rebound until the second low held and the right side broke upward.

The base taxonomy should therefore use market-structure primitives, not a long
list of chart-pattern names.

## Market-Structure Primitives

The reviewer should think in terms of a small set of primitives.

### Impulse

A fast directional repricing move.

Typical features:

- Clear direction.
- Consecutive HH/HL or LL/LH.
- Many large candle bodies.
- ATR expansion.
- Price moves away from moving averages or a prior center.

Examples:

```text
strong upward impulse
strong selloff impulse
```

Impulse is important because it often marks the market repricing into a new
regime.

Impulse is a primitive, not a primary label in the first expanded taxonomy.
Mapping rule:

```text
directional impulse with follow-through -> uptrend or downtrend
isolated spike / event shock / exhaustion impulse -> transition
```

This avoids creating an `impulse` primary class before there is a clear
downstream training use for it.

### Pullback

A counter-move inside an existing higher-level trend.

Important distinction:

```text
bullish_pullback = downward correction inside an uptrend
bearish_rebound  = upward correction inside a downtrend
```

`pullback` should not be treated as an independent directionless class. A
healthy correction in an uptrend and a weak rebound after a selloff are not the
same training signal.

### Absorption

A digestion zone after an impulse.

Typical features:

- A strong impulse exists immediately before the segment.
- Price no longer continues cleanly in the impulse direction.
- Volatility begins to contract.
- Lows or highs begin to hold.
- Volume may remain active.
- Market is digesting prior pressure rather than drifting randomly.

A rounded bottom or trough-like structure after a selloff should often be
considered `bottom absorption` conceptually, not merely `sideways`.

For v1, absorption should not be ignored, but it should not be required as a
core primary label. It should start as an optional structure tag:

```text
bottom_absorption
top_absorption
```

High-confidence absorption samples can later be promoted into direct training
targets if the downstream diagnostic shows that they add signal. Until then,
absorption is an explanatory structure tag and an audit focus, not a heavy v1
training dependency.

### Oscillation

A structured tradable range.

Typical features:

- Clear upper and lower boundaries.
- Repeated movement between boundaries.
- Range width is large enough to cover cost and minimum profit target.
- ATR does not have to be low.
- Useful for boundary trading logic.

This state is valuable for range-oriented strategies such as BoundTrader.

### Sideways

A low-energy non-directional pause.

Typical features:

- Narrow range.
- Low volatility.
- No clear direction.
- Weak trading value.
- Often lower weight or excluded from core strategy-signal training.

The practical distinction:

```text
oscillation = structured, bounded, tradable range
sideways    = low-energy drift with weak trading value
```

### Transition

An unstable bridge between regimes.

Typical examples:

- Spike.
- Rejection.
- Failed breakout.
- Breakdown.
- Climax.
- Exhaustion.
- First strong rebound after a crash.
- Late-trend moving-average rollover.
- High-level fake breakout followed by reversal.

`transition` is not a stable regime. Its purpose is to keep unstable segments
out of the core trend/range classes.

## Recommended V1 Label Set

Do not implement the ten market concepts as flat primary labels in v1. Use a
two-layer label model instead.

The current implementation still uses the original four labels. The following
is the recommended next schema, not a description of the code currently shipped.

### Primary Regime

```text
uptrend
downtrend
oscillation
sideways
transition
ambiguous
```

### Optional Structure Tags

```text
bullish_pullback
bearish_rebound
bottom_absorption
top_absorption
```

Future tags may include:

```text
impulse
failed_breakout
rejection
compression
exhaustion
```

Suggested v1 training use:

| Label | Meaning | Training use |
|---|---|---|
| `uptrend` | Stable upward structure | Core class |
| `downtrend` | Stable downward structure | Core class |
| `oscillation` | Tradable bounded range | Core class |
| `sideways` | Low-energy weak-value range | Low weight or inactive |
| `transition` | Explicit regime-change behavior | Risk-filter class; excluded from core regime training |
| `ambiguous` | Reviewer is not confident | Excluded from training |
| `bullish_pullback` tag | Correction inside an uptrend | Analysis tag; context-dependent active sample later |
| `bearish_rebound` tag | Rebound inside a downtrend | Analysis tag; context-dependent active sample later |
| `bottom_absorption` tag | Selling pressure digestion after a selloff | Analysis/audit tag; excluded from v1 core regime training |
| `top_absorption` tag | Buying pressure digestion after an upward impulse | Analysis/audit tag; excluded from v1 core regime training |

`ambiguous` is not a failure. It is a safety valve that prevents forced labels.

Hard boundary:

```text
transition = reviewer can identify concrete regime-change behavior
ambiguous  = reviewer cannot assign a stable label with confidence
```

`transition` must not become a synonym for "unclear".

### Primary Assignment Rules

The two-layer model must still assign exactly one `primary_label` to each
human-labeled segment.

Use these rules when a segment has a dominant structure tag:

```text
absorption-dominant segment:
  primary_label = sideways
  structure_tags = [bottom_absorption | top_absorption]

pullback/rebound-dominant segment:
  primary_label = uptrend or downtrend when the higher-level trend remains intact
  structure_tags = [bullish_pullback | bearish_rebound]

explicit regime-change segment:
  primary_label = transition
  optional structure_tags = [failed_breakout | rejection | exhaustion | ...]
```

Rationale: absorption is a digestion state, not a clean trend or tradable
oscillation yet. In v1 it lives under `sideways` as a tagged low-directional
state. It must not fall into `ambiguous` merely because absorption is no
longer a primary label.

## Label Constitution

Before adding more data, write a small constitution for each label.

Each label should define:

- Required conditions.
- Exclusion conditions.
- Common confusions.
- Whether it enters training.
- Suggested sample weight.

Initial draft:

### uptrend

Required:

- Highs and lows generally rise.
- EMA slope is positive.
- Close-above-EMA ratio is high.
- Pullbacks do not break the higher-level structure.

Exclude:

- Obvious late-stage distribution.
- Clear rejection after a failed breakout.
- Unstable spike or exhaustion region.

Common confusions:

- Strong upward impulse without follow-through.
- Late-stage top absorption.
- Oscillation whose range slowly drifts upward.

Training use: core class.

Suggested sample weight: normal for high-confidence samples.

### downtrend

Required:

- Highs and lows generally fall.
- EMA slope is negative.
- Close-below-EMA ratio is high.
- Rebounds do not break the higher-level structure.

Exclude:

- Bottom absorption after a selloff.
- Strong right-side recovery that changes structure.
- Unstable capitulation or transition region.

Common confusions:

- Strong downward impulse without follow-through.
- Late-stage bottom absorption.
- Oscillation whose range slowly drifts downward.

Training use: core class.

Suggested sample weight: normal for high-confidence samples.

### bullish_pullback tag

Required:

- A valid higher-level uptrend exists.
- Segment direction is counter to that trend.
- Drawdown does not break the higher-level trend structure.

Exclude:

- Trend reversal.
- Breakdown.
- Sideways drift with no meaningful relation to the prior uptrend.

Common confusions:

- Independent downtrend segment.
- Top absorption after an upward impulse.
- Transition breakdown from an uptrend.

Training use: optional structure tag in v1. Do not include in core regime
training until higher-level context labeling is stable. Later it may become a
context-dependent active sample for TrendTrader-style entries.

Suggested sample weight: lower than core trend/range labels until
context-labeling is stable.

### bearish_rebound tag

Required:

- A valid higher-level downtrend exists.
- Segment direction is counter to that trend.
- Rebound does not break the higher-level downtrend structure.

Exclude:

- Durable reversal into uptrend.
- Bottom absorption followed by right-side repair.
- Transition spike.

Common confusions:

- Independent uptrend segment.
- Bottom absorption after a selloff.
- Transition rebound after capitulation.

Training use: optional structure tag in v1. Do not include in core regime
training until higher-level context labeling is stable. Later it may become a
context-dependent risk or continuation sample.

Suggested sample weight: lower than core trend/range labels until
context-labeling is stable.

### bottom_absorption tag

Required:

- A selloff or downward impulse exists immediately before the segment.
- Price stops making clean downside progress.
- Lows begin to hold or downside extensions become weaker.
- Volatility often contracts relative to the prior impulse.
- The segment is dominated by selling-pressure digestion, not a clean reversal
  trend yet.

Exclude:

- Durable right-side repair that already qualifies as `uptrend`.
- Low-energy drift with no preceding impulse.
- Violent reversal spike that is better treated as `transition`.

Common confusions:

- `sideways` after a selloff.
- Early `uptrend` confirmation seen with hindsight.
- `transition` during capitulation or violent rebound.

Training use: optional structure tag in v1. Use as an audit focus and analysis
feature. Do not include directly in core regime training. If a later downstream
diagnostic trains absorption explicitly, define a separate absorption target
instead of silently changing v1 core-regime semantics.

Suggested sample weight: zero for core regime training in v1.

### top_absorption tag

Required:

- An upward impulse exists immediately before the segment.
- Price stops making clean upside progress.
- Highs begin to fail or upside extensions become weaker.
- Volatility often contracts relative to the prior impulse.
- The segment is dominated by buying-pressure digestion, not a clean downtrend
  yet.

Exclude:

- Durable downside structure that already qualifies as `downtrend`.
- Low-energy drift with no preceding impulse.
- Blow-off top or rejection spike that is better treated as `transition`.

Common confusions:

- `sideways` after an upward impulse.
- Early `downtrend` confirmation seen with hindsight.
- `transition` during blow-off or sharp rejection.

Training use: optional structure tag in v1. Use as an audit focus and analysis
feature. Do not include directly in core regime training. If a later downstream
diagnostic trains absorption explicitly, define a separate absorption target
instead of silently changing v1 core-regime semantics.

Suggested sample weight: zero for core regime training in v1.

### oscillation

Required:

- Clear upper and lower boundaries.
- Multiple boundary interactions.
- Range width is large enough to trade.
- Direction is not dominated by one-sided trend continuation.

Helpful metrics:

- `range_width_atr`
- `boundary_touch_count`
- `center_cross_count`
- `range_efficiency`
- `tradable_width_after_fee`

Exclude:

- Very narrow low-energy sideways drift.
- Trend with shallow pauses.
- Transition around breakout or breakdown.

Common confusions:

- `sideways` with weak trading value.
- Absorption after an impulse.
- Slow trend channel mistaken for a range.

Training use: core class.

Suggested sample weight: normal for high-confidence samples.

### sideways

Required:

- Narrow range.
- Low volatility.
- No clear direction.
- Low trading value.

Absorption override:

When the segment carries `bottom_absorption` or `top_absorption`, the
absorption routing rule overrides the narrow-range and low-volatility
requirements. In that case `sideways` means "non-trend and not a tradable
oscillation yet", not necessarily quiet or narrow. Volume may remain active
and volatility may still be elevated after the preceding impulse.

Exclude:

- Tradable bounded range.
- Early breakout setup with clear compression.

Common confusions:

- Low-volatility oscillation.
- Absorption zone with visible prior impulse. In v1, mark this as
  `primary_label = sideways` plus the corresponding absorption tag, not
  `ambiguous`.
- Compression before transition or breakout.

Training use: inactive or low-weight class.

Suggested sample weight: low; consider excluding from early core training.

### transition

Required:

- Segment is dominated by regime-change behavior.
- Stable trend/range label would be misleading.

Includes:

- Spike.
- Rejection.
- Failed breakout.
- Breakdown.
- Climax.
- Exhaustion.
- First violent rebound after a selloff.

Exclude:

- Clear directional continuation that qualifies as `uptrend` or `downtrend`.
- Clean absorption with no regime-change character.
- Low-energy drift with no impulse or structure change.

Common confusions:

- Strong impulse with follow-through.
- Absorption after the impulse has already stopped progressing.
- Choppy oscillation around a boundary.

Training use: filter class or low-weight class; do not mix into stable regime
targets.

Suggested sample weight: zero for core regime training. It may be active for a
separate risk-filter or no-trade detector.

### ambiguous

Use when:

- Reviewer confidence is low.
- Segment could reasonably fit multiple labels.
- PL cut boundaries make the segment hard to interpret.
- More context is needed than the labeling window provides.

Exclude:

- Cases where a clear label fits but the reviewer is simply slow or uncertain
  about taxonomy mechanics.
- Avoiding a difficult but determinable label by defaulting to `ambiguous`.

Common confusions:

- Marking `ambiguous` when the segment is clearly `sideways` but the reviewer
  is uncertain about the taxonomy.
- Marking `ambiguous` instead of `transition` when the structure is genuinely
  unstable but identifiable.

Training use: excluded from training.

Suggested sample weight: zero.

Default rule:

```text
If uncertain, mark ambiguous instead of forcing a stable label.
```

## Higher-Level Context

`bullish_pullback` and `bearish_rebound` are optional structure tags. They
require a defined higher-level trend. That context must be available to
reviewers before these tags can be used reliably.

For v1, define the higher-level trend using the current IS window plus a fixed
lookback of prior PL segments:

```text
higher-level context = current segment + previous 3 to 5 PL segments in the IS window
```

If fewer than 3 prior PL segments exist, do not apply `bullish_pullback` /
`bearish_rebound`. Use the best primary regime label, or `ambiguous` if the
primary regime itself is unclear.

If the needed context is outside the visible IS window, leave the structure tag
empty unless a dedicated higher-timeframe or longer-lookback context panel has
been added.

Future UI direction:

- Add a compact context strip for the previous several PL segments.
- Optionally add a higher-timeframe trend panel.
- Make the exact context source visible in the review UI so reviewers do not
  infer it differently.

## Recommended Weak-Supervision Workflow

The workflow should reduce reviewer burden and prevent noisy labels from
entering training. Rules should handle the broad production pass; humans should
audit samples, refine definitions, and produce high-confidence seeds.

Only direct segment labeling is implemented today. Rule-based weak labels,
audit sample selection, blind/assisted modes, and the new export contract below
are implementation targets, not current shipped behavior.

### Step 1: PL Initial Segmentation

PL proposes candidate segments, pivots, and possible cut points.

PL does not own the final label. It narrows the task from "search the whole
chart" to "audit this proposed segment."

### Step 2: Rule-Based Weak Label

For each segment, compute summary features and an optional weak label before
human review.

Suggested fields:

```text
duration
slope_atr
ema_slope
close_above_ema_ratio
close_below_ema_ratio
range_width_atr
max_drawdown_atr
max_runup_atr
hh_hl_score
ll_lh_score
atr_percentile
volume_zscore
breakout_failure_score
compression_score
```

The weak label can be used in assisted labeling mode and for sampling review
sets. It must be recorded as system output, not confused with the human label.

### Step 3: Audit Sample Selection

Select audit samples explicitly before asking humans to label. The denominator
for `reviewed_coverage` is this selected audit set, not every PL segment in a
window.

Minimum v1 sampling buckets:

```text
high_confidence_rule_samples:
  rules are confident; verify precision

low_confidence_or_disagreement_samples:
  weak-label confidence is low, rule votes disagree, or metrics are near a boundary

rare_structure_samples:
  possible transition, absorption, pullback/rebound, failed breakout

random_baseline_samples:
  uniform random segments for drift and blind QA
```

Record the sampling reason per segment. Without this field, audit metrics are
not interpretable.

### Step 4: Human Audit Mode

The current UI uses direct segment labeling:

```text
unreviewed -> accepted
accepted -> edited
```

Pressing a label key is the commit action. There is no separate reveal,
accept, or reject review step.

Support two modes:

```text
blind audit mode:
  hide the system candidate label; use for consistency tests and taxonomy QA

assisted labeling mode:
  show the system candidate label; use for faster sample expansion
```

Numeric structure metrics may be shown in both modes.

Allowed before human label in blind audit mode:

```text
slope_atr
ema_slope
close_above_ema_ratio
hh_hl_score
range_width_atr
```

Allowed before human label in assisted labeling mode:

```text
candidate_label = uptrend
confidence = 0.78
reason = EMA slope positive, HH/HL strong, close above EMA 82%
```

After the human label is committed, record agreement:

```text
human_label = oscillation
system_opinion = uptrend
agreement = false
```

`system_opinion` and `agreement` belong to weak-label/audit-comparison
metadata, not to the core human label fields. They may be embedded in the
exported label_set under a separate comparison block, or emitted as a separate
weak-label artifact, but they must remain distinguishable from
`primary_label`.

### Step 5: Human Actions

The reviewer should mostly use these actions:

```text
mark_label
change_label
edit_boundary
ambiguous
```

`merge` is a future capability, not part of the current v1 UI. The current UI
can mark a segment, change a label by pressing a different label key, toggle
PL/HT overlays globally for context, and edit a single segment boundary.

The target experience is not free-form manual labeling. It is assisted
auditing of precomputed segments.

### Step 6: Train Only on Clean Samples First

Early training should prefer fewer clean segments over many noisy segments.

Suggested policy:

```text
v1 cc-v1 emission fit:
  primary_label in {uptrend, oscillation}
  confidence == high

coverage / future state-space diagnostics:
  count high-confidence {uptrend, downtrend, oscillation}
  keep downtrend visible even though v1 fit does not consume it

ambiguous excluded
transition excluded from core regime training
sideways low weight or excluded
structure tags used for analysis first
```

### Step 7: Review Label Definitions Weekly

Review the taxonomy, not only individual charts.

Questions:

- Which labels cause repeated disagreement?
- Which boundaries are unclear?
- Which samples are often moved to `ambiguous`?
- Should any label be split, merged, or demoted to secondary metadata?

The goal is not to label every segment. The goal is to make the label system
more stable each iteration.

### Self-Consistency Check

After labeling a window, re-label the same window at least 48 hours later
without looking at the previous output. Then diff the two exported JSON files.

Suggested rule:

```text
if per-segment label agreement < 85%:
    refine taxonomy definitions before expanding the labeled dataset
```

This check does not require new tooling. The existing export JSON files already
contain enough segment and label information to compare reviewer consistency.

## Additional Metadata

Several metadata fields are recommended even if the first model does not use
all of them.

### label_confidence

```text
high
medium
low
```

Training can start with `high` only.

In v1, `label_confidence` is self-reported by the reviewer at label time. The
rule-based system confidence score from the weak-label step may be shown as a
reference after the human label has been committed, but the reviewer's own
confidence assessment takes precedence.

### primary_label and structure_tags

Some structures have both a dominant regime and a useful secondary concept.

Examples:

```text
primary_label: transition
structure_tags: [failed_breakout]

primary_label: sideways
structure_tags: [bottom_absorption]

primary_label: uptrend
structure_tags: [bullish_pullback]
```

Structure tags are optional metadata at first, not part of the core classifier
target. They are useful for audit analysis, rule refinement, and later
strategy-specific models.

Export rule: `structure_tags` must be sorted in canonical enum order before
serialization:

```text
bullish_pullback
bearish_rebound
bottom_absorption
top_absorption
impulse
failed_breakout
rejection
compression
exhaustion
```

The UI may store click order during editing, but export must sort tags so two
equivalent labels produce the same canonical hash.

## Implementation Direction

Do not immediately implement every concept above in the UI. The implementation
should keep the current direct-labeling workflow as the baseline:

```text
reviewer presses label key -> segment becomes terminal -> UI advances
```

There should be no reintroduced reveal/accept/reject review loop. If a label is
wrong, the correction path is to navigate back and press another label key.

Recommended sequence:

1. Freeze the v1 two-layer taxonomy:
   `primary_label = uptrend | downtrend | oscillation | sideways | transition | ambiguous`
   and optional `structure_tags`.
2. Bump the export contract to a new label-set version. Recommended name:
   `manual_regime_audit_v1`. Downstream consumers must hard-reject unknown
   versions and must not treat this as compatible with current `manual_v1`.
   Recommended filename suffix: `.manual_regime_audit_v1.json`.
3. Update the label model to include `primary_label`, sorted `structure_tags`,
   `label_confidence`, per-segment `audit_mode`, and per-segment
   `sampling_reason`. `audit_mode` is per segment because blind and assisted
   samples may coexist in the same window/file.
4. Update hotkeys and UI controls while preserving direct commit semantics.
   Keep common primary labels fast; use a compact tag picker for optional
   structure tags.
5. Add segment summary metrics and weak-label fields. Numeric metrics may be
   shown in all modes. Keep `system_opinion` / `agreement` in comparison
   metadata or a separate weak-label artifact, not in the core human label
   field set.
6. Add audit sample selection, blind audit mode, and assisted labeling mode.
   The selected audit set is the denominator for reviewed coverage. The mode
   and sampling reason must be recorded
   in export metadata so downstream analysis can separate unbiased audit labels
   from assisted production labels.
7. Update coverage metrics, export schema, and local save validation. This is
   the first point where output compatibility changes.
8. Coordinate alchemist downstream consumption: `ambiguous` is excluded,
   low-confidence samples can be filtered or down-weighted, `transition` is
   excluded from core regime training but available to risk-filter diagnostics,
   and the calibrator records the expanded label-set version/hash.

Step 2 through Step 7 are a breaking schema change. They must be coordinated
before implementation across:

- `src/types/segment.ts` label unions and display helpers.
- `src/stores/labelSessionStore.ts` label actions and guards.
- `src/hooks/useLabelHotkeys.ts` hotkey mapping.
- `src/lib/coverage.ts` coverage groups and floor constants.
- `src/lib/exporter.ts` exported JSON schema, filename suffix, version string,
  and canonical `structure_tags` sorting.
- `vite.config.ts` local save validation and allowed filename suffix.
- Downstream alchemist calibrator expectations in the sibling repo.

Export gate decision:

```text
manual_v1 full-window labeling:
  legacy/frozen workflow only
  keep the existing hard export gate for compatibility
  do not use for new weak-supervision audit work

manual_regime_audit_v1 audit-sample workflow:
  do not require per-window 30% active coverage
  require only schema validity, non-empty selected audit set,
  every selected audit segment terminal,
  confidence present, audit_mode present, sampling_reason present
```

This means the current `CoverageGate.tsx` cannot be reused unchanged for the
audit workflow. It should become an audit completeness panel, not a single
window-level active-coverage gate.

New work should target `manual_regime_audit_v1`. `manual_v1` remains only so
old four-label full-window outputs can still be read and reproduced.

Initial proposed coverage metrics:

```text
reviewed_coverage:
  terminal human-labeled segments / selected audit segments

core_regime_coverage:
  numerator: high-confidence selected-audit bars with primary_label in
    {uptrend, downtrend, oscillation}
  denominator: selected audit bars, or a named subset denominator
    selected by the diagnostic

tradable_structure_coverage:
  numerator: selected-audit bars with structure_tags intersecting
    {bullish_pullback, bearish_rebound, bottom_absorption, top_absorption}
  denominator: selected audit bars, or the rare-structure sampling bucket

risk_filter_coverage:
  numerator: selected-audit bars with primary_label = transition
  denominator: selected audit bars, or the risk/transition sampling bucket

excluded_low_weight_bars:
  sideways
  ambiguous
```

Confidence policy:

```text
reviewed_coverage:
  no confidence filter; measures audit completion

core_regime_coverage:
  high-confidence only; this is the initial core training pool

tradable_structure_coverage:
  report both all-confidence and high-confidence variants; tags are exploratory
  at first, but high-confidence counts matter for later setup models

risk_filter_coverage:
  report both all-confidence and high-confidence variants; transition samples
  are excluded from core training but may feed a later risk/no-trade detector
```

Do not collapse these into one `active_coverage` number. A single numerator
mixes core regime training, tradable setup training, and risk-filter training
into one misleading health score.

These metrics are intentionally multi-axis:

- `core_regime_coverage` is a `primary_label` metric.
- `tradable_structure_coverage` is a `structure_tags` metric.
- `risk_filter_coverage` is a `primary_label` metric.
- Membership can overlap. For example, a segment can be
  `primary_label = uptrend` and `structure_tags = [bullish_pullback]`, so it
  can contribute to both core-regime and tradable-structure metrics.

Implementation note: the current single-axis `Record<Label, number>` coverage
shape is insufficient for this schema. Coverage code needs separate primary
and tag counters, plus explicit denominators.

This keeps the project moving while avoiding a premature large redesign.

## Working Principle

The core rule for the next phase:

```text
Do not maximize labeled coverage at the cost of label purity.
```

For early regime learning, a smaller set of clean, high-confidence segments is
more valuable than a large set of forced labels.

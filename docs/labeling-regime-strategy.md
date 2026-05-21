# Regime Labeling Strategy

This document captures the current working recommendation for improving
manual market-regime labels in Alchemist Labeler.

The key point is that the immediate problem is not reviewer eyesight or a
lack of traditional candlestick-pattern knowledge. The problem is that the
label taxonomy has not converged enough to produce stable, repeatable labels.

If label definitions are unstable, more chart review will mostly create more
noisy labels. The first priority is therefore to define a small, auditable
market-structure vocabulary and a workflow that lets reviewers skip uncertain
segments.

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

For v1, absorption should not be left floating. It should be represented as
explicit primary labels:

```text
bottom_absorption
top_absorption
```

These labels can later be demoted to `secondary_label` if the downstream model
only wants broader regime classes, but reviewers need a concrete primary label
when absorption is the dominant structure.

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

## Recommended Label Set

The first expanded taxonomy should stay small:

```text
uptrend
downtrend
bullish_pullback
bearish_rebound
bottom_absorption
top_absorption
oscillation
sideways
transition
ambiguous
```

Suggested training use:

| Label | Meaning | Training use |
|---|---|---|
| `uptrend` | Stable upward structure | Core class |
| `downtrend` | Stable downward structure | Core class |
| `bullish_pullback` | Correction inside an uptrend | Context-dependent class |
| `bearish_rebound` | Rebound inside a downtrend | Context-dependent class |
| `bottom_absorption` | Selling pressure digestion after a selloff | Core or filter class |
| `top_absorption` | Buying pressure digestion after an upward impulse | Core or filter class |
| `oscillation` | Tradable bounded range | Core class |
| `sideways` | Low-energy weak-value range | Low weight or inactive |
| `transition` | Regime-change bridge | Filter class or low weight |
| `ambiguous` | Reviewer is not confident | Excluded from training |

`ambiguous` is not a failure. It is a safety valve that prevents forced labels.

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

### bullish_pullback

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

Training use: context-dependent class; include only when higher-level context
is clear.

Suggested sample weight: lower than core trend/range labels until
context-labeling is stable.

### bearish_rebound

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

Training use: context-dependent class; include only when higher-level context
is clear.

Suggested sample weight: lower than core trend/range labels until
context-labeling is stable.

### bottom_absorption

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

Training use: core or filter class; start with high-confidence samples only.

Suggested sample weight: normal if downstream trains absorption directly;
otherwise lower or filter-only.

### top_absorption

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

Training use: core or filter class; start with high-confidence samples only.

Suggested sample weight: normal if downstream trains absorption directly;
otherwise lower or filter-only.

### oscillation

Required:

- Clear upper and lower boundaries.
- Multiple boundary interactions.
- Range width is large enough to trade.
- Direction is not dominated by one-sided trend continuation.

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

Exclude:

- Tradable bounded range.
- Absorption after a strong impulse.
- Early breakout setup with clear compression.

Common confusions:

- Low-volatility oscillation.
- Absorption zone with visible prior impulse.
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

Suggested sample weight: low unless the downstream model explicitly trains a
transition detector.

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

`bullish_pullback` and `bearish_rebound` require a defined higher-level trend.
That context must be available to reviewers before these labels can be used
reliably.

For v1, define the higher-level trend using the current IS window plus a fixed
lookback of prior PL segments:

```text
higher-level context = current segment + previous 3 to 5 PL segments in the IS window
```

If fewer than 3 prior PL segments exist, use `ambiguous` for
`bullish_pullback` / `bearish_rebound` instead of forcing a context-dependent
label.

If the needed context is outside the visible IS window, the reviewer should use
`ambiguous` unless a dedicated higher-timeframe or longer-lookback context
panel has been added.

Future UI direction:

- Add a compact context strip for the previous several PL segments.
- Optionally add a higher-timeframe trend panel.
- Make the exact context source visible in the review UI so reviewers do not
  infer it differently.

## Recommended Annotation Workflow

The workflow should reduce reviewer burden and prevent noisy labels from
entering training.

### Step 1: PL Initial Segmentation

PL proposes candidate segments, pivots, and possible cut points.

PL does not own the final label. It only narrows the human task from "search
the whole chart" to "audit this proposed segment."

### Step 2: Segment Feature Summary

For each segment, compute summary features before review.

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

The reviewer should see structure metrics plus the chart, instead of relying
only on visual intuition.

### Step 3: Rule-Based System Comparison

The existing UI state machine intentionally requires the reviewer to make a
human prelabel before seeing PL / HT overlays:

```text
unreviewed -> human_prelabel -> overlay_revealed
```

The same principle applies to rule-based labels. Numeric structure metrics can
be shown before the reviewer labels the segment, but candidate label text must
not be shown before the human prelabel.

Allowed before human prelabel:

```text
slope_atr
ema_slope
close_above_ema_ratio
hh_hl_score
range_width_atr
```

Allowed only after human prelabel:

```text
candidate_label = uptrend
confidence = 0.78
reason = EMA slope positive, HH/HL strong, close above EMA 82%
```

At that point it should be presented as a system comparison opinion, not as
guidance. For example:

```text
human_prelabel = oscillation
system_opinion = uptrend
agreement = false
```

This preserves the load-bearing invariant that reviewers are not led by the
system label before making their own judgment.

### Step 4: Human Audit

The reviewer should mostly use these actions:

```text
accept
reject
split
merge
change_label
ambiguous
```

`merge` is a future capability, not part of the current v1 UI. The current UI
can accept, reject, reveal overlays, and edit a single segment boundary.

The target experience is not free-form manual labeling. It is assisted
auditing of precomputed segments.

### Step 5: Train Only on Clean Samples First

Early training should prefer fewer clean segments over many noisy segments.

Suggested policy:

```text
high-confidence labels enter training
medium-confidence labels enter with lower weight or wait for review
low-confidence and ambiguous labels are excluded
```

### Step 6: Review Label Definitions Weekly

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

Two metadata fields are recommended even if the first model does not use them.

### label_confidence

```text
high
medium
low
```

Training can start with `high` only.

In v1, `label_confidence` is self-reported by the reviewer at accept time. The
rule-based system confidence score from Step 3 may be shown as a reference
after human prelabel, but the reviewer's own confidence assessment takes
precedence.

### primary_label and secondary_label

Some structures have both a dominant regime and a useful secondary concept.

Examples:

```text
primary_label: transition
secondary_label: bearish_rebound
```

The secondary label should be optional metadata at first, not part of the core
classifier target.

If the expanded primary label set includes `bottom_absorption` and
`top_absorption`, those concepts do not need to start as secondary labels. Use
secondary labels for extra nuance that is not yet part of the training target.

## Implementation Direction

Do not immediately implement every concept above in the UI. The recommended
sequence is:

1. Document and agree on the expanded taxonomy.
2. Add `downtrend`, `bullish_pullback`, `bearish_rebound`,
   `bottom_absorption`, `top_absorption`, `transition`, and `ambiguous` to the
   label model.
3. Add label confidence.
4. Add segment summary metrics to the review UI.
5. Add post-prelabel system comparison. Do not show candidate label text before
   the reviewer makes a human prelabel.
6. Adjust export and downstream training rules so `ambiguous` is excluded and
   low-confidence samples can be filtered or down-weighted.

Step 2 is a breaking schema change. It must be coordinated before
implementation across:

- `src/types/segment.ts` label unions and display helpers.
- `src/stores/labelSessionStore.ts` label actions and guards.
- `src/hooks/useLabelHotkeys.ts` hotkey mapping.
- `src/lib/coverage.ts` active label definitions and floor constants.
- `src/lib/exporter.ts` exported JSON schema.
- Downstream alchemist calibrator expectations in the sibling repo.

Initial proposed coverage groups:

```text
active coverage numerator:
  uptrend
  downtrend
  bottom_absorption
  top_absorption
  oscillation

inactive labels, excluded from active coverage numerator:
  bullish_pullback
  bearish_rebound
  sideways
  transition
  ambiguous
```

All terminal labels still count toward reviewed coverage and all-terminal
checks, but only active labels count toward `active_coverage`'s numerator. This
proposal should be revisited after the downstream calibrator defines which
regimes it will train directly.

This keeps the project moving while avoiding a premature large redesign.

## Working Principle

The core rule for the next phase:

```text
Do not maximize labeled coverage at the cost of label purity.
```

For early regime learning, a smaller set of clean, high-confidence segments is
more valuable than a large set of forced labels.

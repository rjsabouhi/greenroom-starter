# Greenroom Case Memo: Ready to Settle

## Slice chosen

I focused on **settlement readiness for unsupported Vs deals**, specifically the moment where Greenroom currently has the data needed to explain a settlement but still forces Mariana into a spreadsheet.

I built a prototype called **Ready to Settle**: a settlement-readiness layer that appears in two places:

1. On the show detail page, as a **Settlement Readiness** card.
2. On the settlement page, as a **Ready to Settle walkthrough** for unsupported Vs deals.

The goal is not to replace the entire settlement product. The goal is to make the highest-friction settlement state visible, explainable, and actionable before Mariana reaches the final 2 a.m. conversation.

## Why this slice

Settlement at The Crescent is not just a calculator problem. It is a readiness problem.

The product already stores deal terms, ticket sales, fees, expenses, comps, recoups, settlement status, signoff text, and free-text notes. But for common deal structures like Vs deals, the current settlement screen stops at: **“The in-app tool can’t settle this yet.”**

That is the seam I chose.

Vs deals are the right wedge because they are:

- Common at independent venues like The Crescent.
- Currently unsupported by the calculator.
- Financially meaningful because the payout depends on guarantee-vs-percentage comparison.
- Trust-sensitive because Mariana has to explain the number to a tour manager or agent.
- Already represented in the data model well enough to produce a useful first-pass walkthrough.

I did not choose to build every deal type, a full dispute workflow, or a mobile show-night interface because those are larger product directions. This prototype proves the first layer: Greenroom can detect settlement risk, compute the payout for a common unsupported structure, and explain what still needs human review.

## What I built

I added a deterministic readiness engine in `lib/readinessLedger.ts`.

It takes the show’s deal terms, ticket sales, expenses, recoups, settlement record, and comps, then returns:

- Readiness score
- Risk level
- Readiness mode
- Top blocking/risky issues
- Next best action
- Projected payout
- Payout swing
- Tour-manager walkthrough text

I then surfaced that engine in two product locations.

### 1. Show detail page: Settlement Readiness

On the show detail page, I added a **Settlement Readiness** card for unsupported or risky settlement states.

For a clean supported flat deal, the card stays hidden. That keeps the prototype scoped and avoids adding noise to normal workflows.

For a Vs deal like **Blue Dial**, the card appears and shows:

- **MEDIUM · 90%**
- Projected payout: **$2,907.85**
- Payout swing: **$0.00**
- Top issue: current calculator does not fully support this deal type
- Next action: use the walkthrough and confirm assumptions before signoff

This tells Mariana, before opening settlement, that the show is ready enough to walk through but still sits outside the official calculator path.

For a messy show like **Park Avenue**, the card escalates:

- **HIGH · 70%**
- Stable payout math
- Disputed lifecycle/signoff issue
- Next action: review lifecycle state, signoff text, and dispute history before treating the record as clean

That distinction matters: the product separates **calculation readiness** from **trust/readiness of the settlement record**.

### 2. Settlement page: Ready to Settle walkthrough

On unsupported Vs deal settlement pages, I kept the original warning card but added a new **Ready to Settle walkthrough** below it.

For **Blue Dial**, the old product says the in-app tool cannot settle a Vs deal. The new layer computes:

- Gross box office: **$5,246.00**
- Fees: **$525.00**
- Net before expenses: **$4,721.00**
- Expense cap applied: **$1,300.00**
- Guarantee: **$2,635.00**
- Artist percentage: **85%**
- Projected artist payout: **$2,907.85**

That exactly matches the off-platform settlement logged back into Greenroom. The key product point is that Greenroom already had enough data to explain the settlement; the missing layer was interpretation and walkthrough.

For **Park Avenue**, the math is also stable, but the settlement lifecycle is disputed while the signoff text appears neutral/positive. The prototype correctly treats this as a trust/state issue rather than a math issue. That is the kind of real-world messiness the prompt calls out: what the UI says, what the data says, and what actually happened are not always aligned.

## How AI fits

I intentionally did not add a live AI API call to the prototype.

For a candidate case study, a deterministic implementation is easier to run, reproduce, and evaluate. A live LLM integration would introduce API keys, latency, nondeterminism, and avoidable evaluator friction.

In production, I would treat AI as a bounded deal-clarity layer, not an autonomous settlement authority. It would assist with:

- Extracting deal terms from free-text notes and emails.
- Detecting ambiguity between structured fields and prose.
- Flagging payout-impacting interpretation branches.
- Drafting plain-English settlement explanations.
- Summarizing why an item needs human confirmation.

The product rule would be: **AI can surface, structure, and explain risk, but human confirmation is required before any payout-affecting assumption becomes final.**

That is especially important in settlement, where trust with the artist, tour manager, and agent matters as much as the calculation.

## What I cut

I cut:

- Full mobile app
- Live AI API integration
- Payment automation
- Agent portal
- Receipt upload
- Accounting integration
- Email integration
- All deal types
- Full dispute-resolution workflow
- Full recoup decision history

Those are all plausible next steps, but they are not necessary to prove the core product judgment.

The prototype focuses on one high-leverage slice: unsupported Vs deals and settlement readiness. It demonstrates the shape of the layer without pretending the whole settlement platform can be rebuilt in a few hours.

## How I would validate it

I would validate this feature with both workflow metrics and qualitative review.

Quantitative metrics:

- Increase in Vs deals settled in-app.
- Reduction in spreadsheet fallback rate.
- Reduction in time to settle.
- Reduction in post-show disputes.
- Reduction in next-day agent questions.
- Number of shows flagged before show night.
- Number of unresolved readiness issues at settlement time.
- GM review/signoff time.

Qualitative validation:

- Give Mariana three messy Vs deals and ask whether the readiness card would have changed when she intervened.
- Ask a tour manager whether the walkthrough makes the payout easier to trust.
- Ask Marcus whether the risk/readiness state helps him know when to escalate.
- Ask an agent whether the explanation is clear enough to reduce back-and-forth.

## What I would ship next

Next, I would expand the layer in this order:

1. Add a pre-show readiness checklist for Vs deals before day-of-show.
2. Add explicit handling for ratchets and tiered percentages.
3. Add recoup interpretation branching where marketing or hospitality treatment changes payout.
4. Add a tour-manager preview state so the final conversation starts from shared context.
5. Add an agent-ready settlement packet with source trail and final assumptions.
6. Expand to percentage-of-net and door deals.
7. Add LLM-assisted free-text extraction behind a human-confirmation workflow.

## Closing

Ready to Settle reframes settlement from a point-in-time calculator into a readiness layer.

The goal is simple:

**Make the 2 a.m. settlement conversation boring.**

For this prototype, I implemented the first slice of that layer: detect unsupported/risky settlement states, compute and explain common Vs-deal payouts, and separate clean math from unresolved trust or signoff issues.

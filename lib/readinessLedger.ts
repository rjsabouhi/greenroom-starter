import type {
  Deal,
  Expense,
  TicketSale,
  Settlement,
  Recoup,
  Comp,
} from "@/db/schema";

export type ReadinessRisk = "low" | "medium" | "high" | "critical";

export type ReadinessIssue = {
  id: string;
  severity: ReadinessRisk;
  title: string;
  detail: string;
  recommendedAction: string;
};

export type PayoutProjection = {
  supported: boolean;
  grossBoxOffice: number;
  totalFees: number;
  netBeforeExpenses: number;
  guaranteeAmount: number | null;
  percentage: number | null;
  expenseCap: number | null;
  expensesApplied: number;
  marketingRecoupAmount: number;
  outsideCapPayout: number | null;
  insideCapPayout: number | null;
  low: number | null;
  high: number | null;
  swing: number;
  explanation: string;
};

export type ReadinessLedger = {
  score: number;
  risk: ReadinessRisk;
  mode: "quiet" | "watch" | "escalation" | "blocked";
  issues: ReadinessIssue[];
  topIssues: ReadinessIssue[];
  nextBestAction: string;
  projection: PayoutProjection;
  tourManagerWalkthrough: string;
};

type LedgerInput = {
  deal: Deal;
  ticketSales: TicketSale[];
  expenses: Expense[];
  recoups: Recoup[];
  settlement?: Settlement | null;
  comps?: Comp[];
};

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function riskFromScore(score: number): ReadinessRisk {
  if (score < 65) return "critical";
  if (score < 80) return "high";
  if (score < 92) return "medium";
  return "low";
}

function modeFromRisk(risk: ReadinessRisk): ReadinessLedger["mode"] {
  if (risk === "critical") return "blocked";
  if (risk === "high") return "escalation";
  if (risk === "medium") return "watch";
  return "quiet";
}

function severityPenalty(severity: ReadinessRisk) {
  switch (severity) {
    case "critical":
      return 20;
    case "high":
      return 10;
    case "medium":
      return 5;
    default:
      return 2;
  }
}

function issuePriority(issue: ReadinessIssue) {
  const severityBase = severityPenalty(issue.severity) * 10;

  const productPriority: Record<string, number> = {
    "marketing-recoup-ambiguity": 9,
    "settlement-lifecycle-disputed": 8,
    "disputed-status-positive-signoff": 7,
    "disputed-recoups": 6,
    "missing-guarantee": 5,
    "missing-percentage": 5,
    "percentage-basis": 4,
    "unsupported-deal-type": 3,
    "hospitality-over-cap": 2,
    "comps-count-toward-gross": 2,
    "notes-fields-mismatch": 1,
  };

  return severityBase + (productPriority[issue.id] ?? 0);
}

function includesAny(text: string, terms: string[]) {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function parseMarketingRecoupAmount(deal: Deal, recoups: Recoup[]) {
  const explicit = recoups.find((r) => r.category === "marketing");
  if (explicit) return explicit.amount;

  const notes = deal.dealNotesFreetext ?? "";
  const match = notes.match(
    /marketing[^$0-9]*(?:recoup|spend|deduction)?[^$0-9]*\$?([0-9,]+)/i,
  );

  if (!match) return 0;

  return Number(match[1].replace(/,/g, ""));
}

function likelyMarketingRecoupAmbiguous(deal: Deal, recoups: Recoup[]) {
  const notes = deal.dealNotesFreetext ?? "";
  const hasMarketingRecoup =
    includesAny(notes, [
      "marketing recoup",
      "marketing spend",
      "marketing deduction",
    ]) || recoups.some((r) => r.category === "marketing");

  if (!hasMarketingRecoup) return false;

  const mentionsCap = includesAny(notes, ["cap", "capped"]);
  const mentionsGross = includesAny(notes, [
    "against gross",
    "off gross",
    "before expenses",
  ]);
  const mentionsOutside = includesAny(notes, [
    "outside cap",
    "in addition to cap",
    "separate from cap",
  ]);
  const mentionsInside = includesAny(notes, [
    "inside cap",
    "included in cap",
    "part of cap",
  ]);

  return mentionsCap && mentionsGross && !mentionsOutside && !mentionsInside;
}

function passedThroughExpenses(expenses: Expense[]) {
  return expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);
}

function hospitalityTotal(expenses: Expense[]) {
  return expenses
    .filter((e) => e.category === "hospitality")
    .reduce((sum, e) => sum + e.amount, 0);
}

function calculateVsProjection(input: LedgerInput): PayoutProjection {
  const { deal, ticketSales, expenses, recoups } = input;

  const grossBoxOffice = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const netBeforeExpenses = grossBoxOffice - totalFees;
  const totalExpenses = passedThroughExpenses(expenses);
  const expenseCap = deal.expenseCap ?? null;
  const expensesApplied =
    expenseCap == null ? totalExpenses : Math.min(totalExpenses, expenseCap);

  const guaranteeAmount = deal.guaranteeAmount ?? null;
  const percentage = deal.percentage ?? null;
  const marketingRecoupAmount = parseMarketingRecoupAmount(deal, recoups);

  if (deal.dealType !== "vs" || guaranteeAmount == null || percentage == null) {
    return {
      supported: false,
      grossBoxOffice,
      totalFees,
      netBeforeExpenses,
      guaranteeAmount,
      percentage,
      expenseCap,
      expensesApplied,
      marketingRecoupAmount,
      outsideCapPayout: null,
      insideCapPayout: null,
      low: null,
      high: null,
      swing: 0,
      explanation:
        "This projection is only implemented for Vs deals with a guarantee and percentage.",
    };
  }

  const outsideCapNet =
    netBeforeExpenses - marketingRecoupAmount - expensesApplied;
  const outsideCapShare = outsideCapNet * percentage;
  const outsideCapPayout = Math.max(guaranteeAmount, outsideCapShare);

  const insideCapNet = netBeforeExpenses - expensesApplied;
  const insideCapShare = insideCapNet * percentage;
  const insideCapPayout = Math.max(guaranteeAmount, insideCapShare);

  const low = Math.min(outsideCapPayout, insideCapPayout);
  const high = Math.max(outsideCapPayout, insideCapPayout);
  const swing = high - low;

  return {
    supported: true,
    grossBoxOffice,
    totalFees,
    netBeforeExpenses,
    guaranteeAmount,
    percentage,
    expenseCap,
    expensesApplied,
    marketingRecoupAmount,
    outsideCapPayout,
    insideCapPayout,
    low,
    high,
    swing,
    explanation:
      swing > 0.5
        ? `Payout depends on whether the marketing recoup is inside or outside the expense cap. Swing: ${money(swing)}.`
        : "Projected payout is stable under the current inputs.",
  };
}

export function buildReadinessLedger(input: LedgerInput): ReadinessLedger {
  const { deal, expenses, recoups, settlement, comps = [] } = input;
  const issues: ReadinessIssue[] = [];
  const projection = calculateVsProjection(input);
  const notes = deal.dealNotesFreetext ?? "";

  if (deal.dealType !== "flat" && deal.dealType !== "percentage_of_gross") {
    issues.push({
      id: "unsupported-deal-type",
      severity: deal.dealType === "vs" ? "high" : "medium",
      title: "Current calculator does not fully support this deal type",
      detail:
        deal.dealType === "vs"
          ? "Vs deals are common at The Crescent, but the current in-app settlement engine does not settle them end-to-end."
          : "This deal type requires interpretation beyond the current flat/% of gross calculator.",
      recommendedAction:
        deal.dealType === "vs"
          ? "Use the readiness walkthrough and confirm payout-impacting assumptions before final signoff."
          : "Flag this show for manual review before final settlement.",
    });
  }

  if (deal.dealType === "vs" && deal.guaranteeAmount == null) {
    issues.push({
      id: "missing-guarantee",
      severity: "critical",
      title: "Vs deal is missing guarantee amount",
      detail: "The guarantee is required to compare against the percentage side.",
      recommendedAction: "Confirm and enter the guarantee before settlement.",
    });
  }

  if (deal.dealType === "vs" && deal.percentage == null) {
    issues.push({
      id: "missing-percentage",
      severity: "critical",
      title: "Vs deal is missing percentage",
      detail: "The percentage side is required to calculate the artist payout.",
      recommendedAction: "Confirm and enter the percentage before settlement.",
    });
  }

  if (deal.dealType === "vs" && deal.percentageBasis !== "net") {
    issues.push({
      id: "percentage-basis",
      severity: "high",
      title: "Percentage basis needs confirmation",
      detail:
        "This workflow assumes a guarantee vs percentage of net. The structured basis is missing or not net.",
      recommendedAction:
        "Confirm whether percentage applies to gross or net before final settlement.",
    });
  }

  if (likelyMarketingRecoupAmbiguous(deal, recoups)) {
    issues.push({
      id: "marketing-recoup-ambiguity",
      severity: "critical",
      title: "Marketing recoup treatment is ambiguous",
      detail: `The notes/recoups mention marketing recoup language, but do not clearly say whether it is inside or outside the expense cap. This can swing payout by ${money(projection.swing)}.`,
      recommendedAction:
        "Confirm whether the marketing recoup is inside or outside the expense cap before final signoff.",
    });
  }

  const disputedRecoups = recoups.filter((r) => r.status === "disputed");
  if (disputedRecoups.length > 0) {
    issues.push({
      id: "disputed-recoups",
      severity: "high",
      title: `${disputedRecoups.length} recoup line item${
        disputedRecoups.length === 1 ? "" : "s"
      } disputed`,
      detail: `Disputed recoups total ${money(
        disputedRecoups.reduce((sum, r) => sum + r.amount, 0),
      )}.`,
      recommendedAction:
        "Resolve or explicitly mark disputed recoups before final settlement.",
    });
  }

  const settlementIsDisputed =
    settlement?.status === "disputed" ||
    settlement?.status === "revised" ||
    !!settlement?.disputedAt;

  if (settlementIsDisputed) {
    issues.push({
      id: "settlement-lifecycle-disputed",
      severity: "high",
      title: "Settlement lifecycle is disputed or revised",
      detail:
        "The payout may calculate cleanly, but the settlement record indicates a dispute or revision. This is a trust/state issue, not only a math issue.",
      recommendedAction:
        "Review the lifecycle state, signoff text, and dispute history before treating the settlement as clean.",
    });
  }

  if (
    settlementIsDisputed &&
    settlement?.signoffText &&
    /(ok|looks good|good night|approved|👍|fine|all good)/i.test(
      settlement.signoffText,
    )
  ) {
    issues.push({
      id: "disputed-status-positive-signoff",
      severity: "high",
      title: "Disputed status conflicts with positive signoff text",
      detail:
        "The settlement is marked disputed or revised, but the artist-team signoff text appears neutral or positive. That mismatch needs review before the record can be trusted.",
      recommendedAction:
        "Confirm whether the dispute is still active, resolved informally, or incorrectly reflected in the lifecycle status.",
    });
  }

  if (deal.hospitalityCap != null) {
    const hospitality = hospitalityTotal(expenses);
    if (hospitality > deal.hospitalityCap) {
      issues.push({
        id: "hospitality-over-cap",
        severity: "medium",
        title: "Hospitality is over cap",
        detail: `Hospitality total is ${money(hospitality)} against a cap of ${money(
          deal.hospitalityCap,
        )}.`,
        recommendedAction:
          "Mark whether the venue absorbs the overage or passes it through.",
      });
    }
  }

  if (
    notes &&
    (deal.guaranteeAmount == null ||
      deal.percentage == null ||
      deal.expenseCap == null)
  ) {
    issues.push({
      id: "notes-fields-mismatch",
      severity: "medium",
      title: "Free-text deal notes carry terms missing from structured fields",
      detail:
        "The notes may contain settlement-relevant terms that the structured calculator cannot safely read.",
      recommendedAction:
        "Show notes and structured fields side by side for human confirmation.",
    });
  }

  const compsTowardGross = comps
    .filter((c) => c.countsTowardGross)
    .reduce((sum, c) => sum + c.count, 0);

  if (compsTowardGross > 0) {
    issues.push({
      id: "comps-count-toward-gross",
      severity: "medium",
      title: "Some comps count toward gross",
      detail: `${compsTowardGross} comp tickets count toward gross and may affect the settlement basis.`,
      recommendedAction:
        "Confirm whether counted comps are included in the payout walkthrough.",
    });
  }

  let score = 100;
  for (const issue of issues) score -= severityPenalty(issue.severity);
  score = clampScore(score);

  const risk = riskFromScore(score);
  const topIssues = [...issues]
    .sort((a, b) => issuePriority(b) - issuePriority(a))
    .slice(0, 4);

  const nextBestAction =
    topIssues[0]?.recommendedAction ??
    "No blocking settlement issues detected. Recheck after final ticket and expense updates.";

  const percentageLabel =
    projection.percentage != null
      ? `${Math.round(projection.percentage * 100)}%`
      : "the negotiated percentage";

  const baseWalkthrough =
    projection.supported && projection.low != null && projection.high != null
      ? `Here is the clean version. Gross box office is ${money(
          projection.grossBoxOffice,
        )} and fees are ${money(projection.totalFees)}, leaving ${money(
          projection.netBeforeExpenses,
        )} before expenses. The deal is ${money(
          projection.guaranteeAmount,
        )} guaranteed versus ${percentageLabel} of net after expenses. After applying ${money(
          projection.expensesApplied,
        )} in expenses, the projected artist payout is ${money(
          projection.high,
        )}.`
      : "This show needs manual review before a tour-manager walkthrough can be generated.";

  const hasPayoutSwing = projection.swing > 0.5;
  const hasTrustStateIssue = issues.some((issue) =>
    [
      "settlement-lifecycle-disputed",
      "disputed-status-positive-signoff",
      "disputed-recoups",
    ].includes(issue.id),
  );

  const tourManagerWalkthrough =
    projection.supported && hasPayoutSwing
      ? `${baseWalkthrough} One payout-impacting interpretation still needs confirmation: if the marketing recoup is outside the cap, payout is ${money(
          projection.outsideCapPayout,
        )}; if it is inside the cap, payout is ${money(
          projection.insideCapPayout,
        )}. The difference is ${money(
          projection.swing,
        )}, so we should confirm that interpretation before marking this final.`
      : projection.supported && hasTrustStateIssue
        ? `${baseWalkthrough} The math is stable, but the settlement record still has a trust/state issue: the lifecycle or signoff history indicates a dispute or revision. Before calling this clean, review the dispute state and confirm whether the artist-side signoff reflects final agreement.`
        : projection.supported
          ? `${baseWalkthrough} No payout-changing ambiguity is detected in this walkthrough, but this is still flagged because the current in-app calculator does not officially support Vs deals.`
          : baseWalkthrough;

  return {
    score,
    risk,
    mode: modeFromRisk(risk),
    issues,
    topIssues,
    nextBestAction,
    projection,
    tourManagerWalkthrough,
  };
}

import type {
  PatronageProposalContract,
  PatronageProposalInputContract
} from "@/packages/contracts/src";

export const patronageCurrencies = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

export type PatronageDraftFields = {
  status: PatronageProposalInputContract["status"];
  currency: PatronageProposalInputContract["currency"];
  goal: string;
  deadline: string;
};

export const emptyPatronageDraftFields = (): PatronageDraftFields => ({
  status: "open",
  currency: "USD",
  goal: "",
  deadline: ""
});

export const patronageDraftFieldsForProposal = (
  proposal: PatronageProposalInputContract
): PatronageDraftFields => ({
  status: proposal.status,
  currency: proposal.currency,
  goal: (proposal.goalMinorUnits / 100).toFixed(2).replace(/\.00$/, ""),
  deadline: proposal.deadline ?? ""
});

export const parsePatronageGoal = (value: string) => {
  const normalized = value.trim().replace(/,/g, "");
  const match = normalized.match(/^(\d{1,13})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const minorUnits = whole * 100 + Number(fraction || 0);
  return Number.isSafeInteger(minorUnits) && minorUnits > 0 ? minorUnits : null;
};

export const patronageInputForDraft = (
  fields: PatronageDraftFields
): PatronageProposalInputContract | null => {
  const goalMinorUnits = parsePatronageGoal(fields.goal);
  if (!goalMinorUnits) return null;
  return {
    status: fields.status,
    currency: fields.currency,
    goalMinorUnits,
    deadline: fields.deadline || null
  };
};

export const patronageProjectionForInput = (
  input: PatronageProposalInputContract,
  current?: PatronageProposalContract
): PatronageProposalContract => ({
  ...input,
  raisedMinorUnits: current?.raisedMinorUnits ?? 0,
  supporterCount: current?.supporterCount ?? 0,
  topSupporters: current?.topSupporters ?? []
});

export const patronageProgressPercent = (proposal: PatronageProposalContract) =>
  Math.min(100, Math.max(0, (proposal.raisedMinorUnits / proposal.goalMinorUnits) * 100));

export const formatPatronageMoney = (
  minorUnits: number,
  currency: PatronageProposalContract["currency"]
) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency,
  maximumFractionDigits: minorUnits % 100 ? 2 : 0
}).format(minorUnits / 100);

export const patronageDeadlineLabel = (deadline: string | null) => {
  if (!deadline) return "No closing date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${deadline}T00:00:00Z`));
};

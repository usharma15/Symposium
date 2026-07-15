"use client";

import { useState } from "react";
import { Building2, CalendarDays, CircleDollarSign, Users } from "lucide-react";
import type { InquiryItem } from "@/lib/mockData";
import type { PatronageProposalInputContract } from "@/packages/contracts/src";
import {
  formatPatronageMoney,
  patronageCurrencies,
  patronageDeadlineLabel,
  patronageProgressPercent,
  type PatronageDraftFields
} from "@/features/patronage/patronageModel";

export function PatronageProposalFields({
  value,
  onChange,
  disabled,
  allowStatus = false
}: {
  value: PatronageDraftFields;
  onChange: (next: PatronageDraftFields) => void;
  disabled?: boolean;
  allowStatus?: boolean;
}) {
  const update = <Key extends keyof PatronageDraftFields>(key: Key, next: PatronageDraftFields[Key]) =>
    onChange({ ...value, [key]: next });

  return (
    <fieldset className="patronage-proposal-fields" disabled={disabled}>
      <legend>Funding details</legend>
      <div className="patronage-field-grid">
        <label>
          <span>Goal</span>
          <div className="patronage-goal-input">
            <select
              aria-label="Proposal currency"
              value={value.currency}
              onChange={(event) => update("currency", event.target.value as PatronageDraftFields["currency"])}
            >
              {patronageCurrencies.map((currency) => <option key={currency}>{currency}</option>)}
            </select>
            <input
              inputMode="decimal"
              value={value.goal}
              onChange={(event) => update("goal", event.target.value)}
              placeholder="25000"
              aria-label="Funding goal"
            />
          </div>
        </label>
        <label>
          <span>Closing date <small>optional</small></span>
          <input type="date" value={value.deadline} onChange={(event) => update("deadline", event.target.value)} />
        </label>
        {allowStatus ? (
          <label>
            <span>Status</span>
            <select
              value={value.status}
              onChange={(event) => update("status", event.target.value as PatronageProposalInputContract["status"])}
            >
              <option value="open">Open</option>
              <option value="funded">Funded</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        ) : null}
      </div>
      <small className="patronage-fields-note">Only confirmed provider payments will count toward the public total.</small>
    </fieldset>
  );
}

export function PatronageFeedSummary({ item }: { item: InquiryItem }) {
  const proposal = item.patronage;
  if (!proposal) return null;
  const progress = patronageProgressPercent(proposal);

  return (
    <section className="patronage-feed-summary" aria-label="Proposal funding progress">
      <div>
        <span className="patronage-proposal-badge">Patronage proposal</span>
        <strong>{formatPatronageMoney(proposal.raisedMinorUnits, proposal.currency)} raised</strong>
        <small>of {formatPatronageMoney(proposal.goalMinorUnits, proposal.currency)}</small>
      </div>
      <div className="patronage-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <i style={{ width: `${progress}%` }} />
      </div>
    </section>
  );
}

export function PatronageProposalRail({ item }: { item: InquiryItem }) {
  const proposal = item.patronage;
  const [paymentNotice, setPaymentNotice] = useState(false);
  if (!proposal) return null;
  const progress = patronageProgressPercent(proposal);
  const statusLabel = proposal.status[0].toUpperCase() + proposal.status.slice(1);

  return (
    <aside className="paper-side patronage-side" aria-label="Proposal funding details">
      <section>
        <div className="patronage-side-heading">
          <span>Patronage proposal</span>
          <strong className={`patronage-status patronage-status-${proposal.status}`}>{statusLabel}</strong>
        </div>
        <div className="patronage-total">
          <strong>{formatPatronageMoney(proposal.raisedMinorUnits, proposal.currency)}</strong>
          <span>raised of {formatPatronageMoney(proposal.goalMinorUnits, proposal.currency)}</span>
        </div>
        <div className="patronage-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <div className="patronage-facts">
          <span><Users size={15} /><strong>{proposal.supporterCount}</strong> supporters</span>
          <span><CalendarDays size={15} />{patronageDeadlineLabel(proposal.deadline)}</span>
        </div>
        <button
          type="button"
          className="patronage-contribute"
          disabled={proposal.status !== "open"}
          onClick={() => setPaymentNotice(true)}
        >
          <CircleDollarSign size={17} />Contribute
        </button>
        {paymentNotice ? (
          <p className="patronage-payment-notice" role="status">
            Secure payments are not live yet. No contribution has been created or charged.
          </p>
        ) : null}
        <button type="button" className="patronage-private-capital" disabled>
          <Building2 size={16} />Private Capital <small>Coming soon</small>
        </button>
      </section>

      <section className="patronage-supporters">
        <h2>Top supporters</h2>
        {proposal.topSupporters.length ? (
          <ol>
            {proposal.topSupporters.map((supporter, index) => (
              <li key={`${supporter.displayName}-${supporter.amountMinorUnits}-${index}`}>
                <span><b>{index + 1}</b>{supporter.anonymous ? "Anonymous" : supporter.displayName}</span>
                <strong>{formatPatronageMoney(supporter.amountMinorUnits, proposal.currency)}</strong>
              </li>
            ))}
          </ol>
        ) : <p>No confirmed supporters yet.</p>}
      </section>
    </aside>
  );
}

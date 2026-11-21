/**
 * buildThankYouDraft — a personalized thank-you email draft for one donor
 * row on the thank-you list.
 *
 * The result lands pre-filled in the AdminEmailComposer (recipient,
 * subject, body); the admin reviews and edits before sending, so the
 * template stays deliberately plain. The claim side confirms the
 * sponsorship is fulfilled; the general side carries the donation total.
 * The family is referenced without its name (PII: family names stay out
 * of donor emails, as in the claim confirmation's "Family {display_id}").
 * With no name to greet, the draft falls back to a neutral "Hi there".
 */

import type { ThankYouDonor } from "../types";
import { formatUsd } from "./utils";

export interface ThankYouDraft {
  subject: string;
  message: string;
}

/** The first token of a display/buyer name — null when there is no name. */
function firstNameOf(name: string | null): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

function claimParagraph(donor: ThankYouDonor): string {
  if (donor.claim_count === 1) {
    return `Thank you so much for your sponsorship! The family has received all their gifts, and we are so grateful for your kindness.`;
  }
  return `Thank you so much for your sponsorships! The families have all received their gifts, and we are so grateful for your kindness.`;
}

function generalParagraph(donor: ThankYouDonor): string {
  const total = formatUsd(donor.general_total_cents);
  if (donor.general_payment_count === 1) {
    return `Thank you for your ${total} donation to Kindness Is Magic; 100% of it went straight to gifts for families.`;
  }
  return `Thank you for your donations to Kindness Is Magic (${total} in total); 100% of them went straight to gifts for families.`;
}

export function buildThankYouDraft(donor: ThankYouDonor): ThankYouDraft {
  const first = firstNameOf(donor.display_name);
  // Closing comma completes the vocative ("Thank you, Ada, for…").
  const name = first ? `, ${first},` : "";

  const subjectBySource: Record<ThankYouDonor["source"], string> = {
    claims: `Thank you${name} for your sponsorship`,
    general: `Thank you${name} for your donation`,
    both: `Thank you${name} for your generosity`,
  };

  const paragraphs: string[] = [];
  if (donor.claim_count > 0) paragraphs.push(claimParagraph(donor));
  if (donor.general_payment_count > 0) paragraphs.push(generalParagraph(donor));
  paragraphs.push(
    "Your generosity is what makes this program possible. Thank you for being part of something wonderful.\n\nWith gratitude,\nThe Kindness Is Magic team"
  );

  return { subject: subjectBySource[donor.source], message: `Hi ${first ?? "there"},\n\n${paragraphs.join("\n\n")}` };
}

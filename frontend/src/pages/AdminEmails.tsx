/**
 * Admin — Emails (sent log · campaigns · unsubscribes)
 *
 * One page, three tabs: the read-only sent-email audit log, batch email
 * campaigns, and the unsubscribe blocklist. The active tab is a URL query
 * param (?tab=campaigns | ?tab=unsubscribes; the log is the default), so
 * every tab deep-links.
 *
 * The page owns the shell (header, tablist, per-tab table width) and the
 * generic compose dialog; each tab is a self-contained component under
 * src/components/ that brings its own queries, filters, and mutations.
 */

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminEmailComposer } from "../components/AdminEmailComposer";
import { Button } from "../components/Button";
import { EmailCampaignsTab } from "../components/EmailCampaignsTab";
import { EmailUnsubscribesTab } from "../components/EmailUnsubscribesTab";
import { HeaderBar } from "../components/HeaderBar";
import { SentEmailsTab } from "../components/SentEmailsTab";
import { useTableWidth } from "../hooks/useTableWidth";

type EmailTab = "sent" | "campaigns" | "unsubscribes";

/** Tab order = display order. "sent" is the default (no query param). */
const TABS: { key: EmailTab; label: string }[] = [
  { key: "sent", label: "Sent" },
  { key: "campaigns", label: "Campaigns" },
  { key: "unsubscribes", label: "Unsubscribes" },
];

function parseTab(raw: string | null): EmailTab {
  return raw === "campaigns" || raw === "unsubscribes" ? raw : "sent";
}

export default function AdminEmails() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [composerOpen, setComposerOpen] = useState(false);

  const tab = parseTab(searchParams.get("tab"));

  // Per-tab table width: the sent/unsubscribes tables honor the gear
  // width preference (two resources, both hooked here so the page can size
  // its wrapper); the campaigns tab (list and detail alike) is max-w-4xl.
  const { widthClass: sentWidthClass } = useTableWidth("adminSentEmails");
  const { widthClass: unsubWidthClass } = useTableWidth("adminEmailUnsubscribes");
  const widthClass = tab === "campaigns" ? "max-w-4xl" : tab === "sent" ? sentWidthClass : unsubWidthClass;

  const selectTab = (next: EmailTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === "sent") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar />

      <main className="mx-auto w-full px-4 py-8 sm:px-6">
        <div className={`mx-auto ${widthClass}`}>
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold text-violet-950">Emails</h2>
            <Button onClick={() => setComposerOpen(true)}>+ Compose</Button>
          </div>

          {/* Tabs (URL-backed — each tab deep-links via ?tab=) */}
          <div role="tablist" className="mb-6 flex gap-4 border-b border-gray-200">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                role="tab"
                type="button"
                id={`email-tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`email-tabpanel-${key}`}
                onClick={() => tab !== key && selectTab(key)}
                className={`border-b-2 px-1 py-2 text-sm font-medium transition-colors ${
                  tab === key ? "border-violet-600 text-violet-700" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`email-tabpanel-${tab}`} aria-labelledby={`email-tab-${tab}`}>
            {tab === "sent" && <SentEmailsTab />}
            {tab === "campaigns" && <EmailCampaignsTab />}
            {tab === "unsubscribes" && <EmailUnsubscribesTab />}
          </div>

          {/* Generic compose — no prefill (any recipient) */}
          <AdminEmailComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
        </div>
      </main>
    </div>
  );
}

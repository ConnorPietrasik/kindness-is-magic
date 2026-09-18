/**
 * Financials — static public page.
 *
 * DRAFT: the section structure is in place, but the body copy is placeholder.
 * TODO(copy): publish the real financial disclosures (Form 990 links,
 * determination letter details) before launch.
 */

import { StaticPage } from "../components/StaticPage";
import { CONTACT_EMAIL } from "../lib/links";

export default function Financials() {
  return (
    <StaticPage title="Financials">
      <h2>Our Tax Status</h2>
      <p>Kindness is Magic is a 501(c)(3) tax-exempt nonprofit organization (EIN 33-4085630).</p>

      <h2>Form 990</h2>
      <p>TODO(copy): describe where our annual Form 990 filings are published, and link them once available.</p>

      <h2>Request Financial Information</h2>
      <p>
        To request our financial statements or tax filings, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </StaticPage>
  );
}

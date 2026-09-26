/**
 * Financials — static public page.
 *
 * Because our annual gross receipts are under $50,000, we are not required to file the IRS
 * Form 990 information return. Instead we publish a plain annual income statement: the 2025
 * figures are shown inline below, and the statement itself is served as a static asset from
 * the public/ directory.
 */

import { StaticPage } from "../components/StaticPage";
import { CONTACT_EMAIL } from "../lib/links";

/** Income statement PDF, served from the public/ directory. */
const INCOME_STATEMENT_2025_PDF = "/2025-income-statement.pdf";

export default function Financials() {
  return (
    <StaticPage title="Financials">
      <p className="text-sm text-gray-500">Last updated: September 26, 2026</p>

      <h2>Our Tax Status</h2>
      <p>Kindness is Magic is a 501(c)(3) tax-exempt nonprofit organization (EIN 33-4085630).</p>

      <h2>Annual Financial Disclosure</h2>
      <p>
        Because our annual gross receipts are under $50,000, we are not required to file the IRS Form 990 information return. To keep our
        finances open anyway, we publish a plain income statement for each program year.
      </p>

      <h3>Fiscal Year 2025 (January 1 – December 31, 2025)</h3>
      <table>
        <tbody>
          <tr>
            <td colSpan={2}>
              <strong>Revenue</strong>
            </td>
          </tr>
          <tr>
            <td>Donations</td>
            <td className="text-right">$36,900</td>
          </tr>
          <tr>
            <td>
              <strong>Total revenue &amp; gains</strong>
            </td>
            <td className="text-right">
              <strong>$36,900</strong>
            </td>
          </tr>
          <tr>
            <td colSpan={2}>
              <strong>Expenses</strong>
            </td>
          </tr>
          <tr>
            <td>Gift purchases</td>
            <td className="text-right">$21,838</td>
          </tr>
          <tr>
            <td>Nonprofit startup costs</td>
            <td className="text-right">$2,319</td>
          </tr>
          <tr>
            <td>
              <strong>Total expenses</strong>
            </td>
            <td className="text-right">
              <strong>$24,157</strong>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Fund balance</strong>
            </td>
            <td className="text-right">
              <strong>$12,743</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        <a href={INCOME_STATEMENT_2025_PDF}>Download the 2025 income statement (PDF)</a>
      </p>
      <p className="text-sm text-gray-500">
        These figures are drawn from our own books. As a small, volunteer-run organization, we do not have audited financial statements.
      </p>

      <h2>Request Financial Information</h2>
      <p>
        To request our financial statements or other tax filings, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </StaticPage>
  );
}

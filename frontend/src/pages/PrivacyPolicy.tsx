/**
 * Privacy Policy — static public page.
 *
 * DRAFT: the section structure is in place, but the body copy is placeholder.
 * TODO(copy): replace with the org's real privacy policy before launch (no
 * privacy data exists anywhere yet; it will be generated later).
 */

import { StaticPage } from "../components/StaticPage";
import { CONTACT_EMAIL } from "../lib/links";

export default function PrivacyPolicy() {
  return (
    <StaticPage title="Privacy Policy">
      <p>TODO(copy): brief introduction explaining that this policy covers the Kindness is Magic website and family-sponsorship program.</p>

      <h2>Information We Collect</h2>
      <p>TODO(copy): describe what information we collect (e.g. donor account details and family wish-list information) and how.</p>

      <h2>How We Use Information</h2>
      <p>TODO(copy): describe how we use that information to run the sponsorship program and when, if ever, it is shared.</p>

      <h2>Children's Privacy</h2>
      <p>TODO(copy): state our position on collecting information from or about children, given that families include minors.</p>

      <h2>Contact</h2>
      <p>
        Questions about this policy? Contact us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </StaticPage>
  );
}

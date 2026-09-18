/**
 * California Privacy Notice — static public page.
 *
 * DRAFT: the section structure is in place, but the body copy is placeholder.
 * TODO(copy): review against the org's actual CCPA/CPRA posture before launch.
 */

import { StaticPage } from "../components/StaticPage";
import { CONTACT_EMAIL } from "../lib/links";

export default function CaliforniaPrivacy() {
  return (
    <StaticPage title="California Privacy Notice">
      <p>
        TODO(copy): brief introduction — this notice supplements our Privacy Policy and describes the rights available to California
        residents under the California Consumer Privacy Act (CCPA), as amended by the California Privacy Rights Act (CPRA).
      </p>

      <h2>Your Rights Under CCPA/CPRA</h2>
      <ul>
        <li>TODO(copy): right to know what personal information we collect and how it is used.</li>
        <li>TODO(copy): right to delete personal information we hold about you.</li>
        <li>TODO(copy): right to correct inaccurate personal information.</li>
        <li>TODO(copy): right to opt out of any sale or sharing of personal information, if applicable.</li>
        <li>TODO(copy): right to non-discrimination for exercising your privacy rights.</li>
      </ul>

      <h2>How to Exercise Your Rights</h2>
      <p>
        TODO(copy): describe the process for submitting a request. Requests can be sent to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this notice? Contact us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </StaticPage>
  );
}

/**
 * Privacy Policy — static public page.
 *
 * Adapted from a generic California charity privacy policy (modeled on a
 * published 501(c)(3) policy for a volunteer-run CA nonprofit that, like
 * ours, processes all online donations through Zeffy) and tailored to this
 * project's actual data flows: user accounts, family program data, public
 * wish lists, transactional emails, and first-party session cookies only.
 */

import { StaticPage } from "../components/StaticPage";
import { CONTACT_EMAIL, ZEFFY_PRIVACY_URL } from "../lib/links";

export default function PrivacyPolicy() {
  return (
    <StaticPage title="Privacy Policy">
      <p className="text-sm text-gray-500">Last updated: September 20, 2026</p>

      <p>
        Kindness is Magic (“we,” “us,” or “our”) is a California 501(c)(3) nonprofit organization (EIN 33-4085630), run entirely by
        volunteers, that brings holiday magic to families living in poverty in Milpitas and surrounding areas. We connect families with
        neighbors who sponsor their holiday wishes. This Privacy Policy explains what information we collect, why we collect it, how we use
        and share it, and the choices you have.
      </p>

      <h2>Scope of This Policy</h2>
      <p>
        This policy covers information we collect online — through this website, including accounts, public wish lists, and email — and
        offline — by phone or in person while coordinating shopping, pickup, and delivery. It does not cover third-party services we link
        to. Online donations are processed exclusively through Zeffy’s secure platform; Zeffy’s own privacy policy ({" "}
        <a href={ZEFFY_PRIVACY_URL} target="_blank" rel="noopener noreferrer">
          support.zeffy.com
        </a>{" "}
        ) applies to the information you give to them. For clarity: we never receive or store payment card details — Zeffy alone handles
        payment processing.
      </p>

      <h2>Information We Collect</h2>
      <p>
        <strong>When you browse the site.</strong> You can browse public family wish lists without an account or providing any personal
        information. Our servers record basic request information — the pages you visit, when, and, if you are logged in, the account the
        request is associated with. Our application logs do not include your IP address or browser type. We use this information only for
        security and site performance. If you log in, we use a first-party session cookie to keep you signed in.
      </p>
      <p>
        <strong>When you create an account.</strong> Donors, family contacts, referrers, and volunteers who create accounts provide an email
        address, a password (stored only as a one-way hash, never in plain text), and a display name.
      </p>
      <p>
        <strong>When a family takes part in the program.</strong> With the family’s consent, we collect the family name, a short family
        introduction, a contact name, a phone number, and an address (families without one write “none”) for coordinating gift pickup or
        delivery, plus one wish for the whole family. For each family member — including pets — we collect a first name, family role, age,
        and a short note about what they love, along with each person’s wish details (item, size, and color preferences).
      </p>
      <p>
        <strong>When referrers and volunteers help.</strong> Referrers who refer families provide a name, a phone number, and account
        details. Volunteers who shop for or deliver gifts have accounts created for them by our team (a display name and email).
      </p>
      <p>
        <strong>When you sponsor a family.</strong> We record which donor is sponsoring which family, the type of commitment (gifts or
        money), and any notes the donor adds. When you sponsor with gifts, we send you a confirmation email with the details of your
        sponsorship.
      </p>

      <h2>Public Wish Lists</h2>
      <p>
        Families that have completed our review process appear on our public family pages so donors can meet them and choose who to sponsor.
        To protect family privacy, each family appears under an anonymous code (for example, “1-2”) rather than its real name.
      </p>
      <p>
        What is public: the family introduction, the family wish, each member’s first name, family role, age, and short note, the wish
        details, the family size and age range, and whether the family has a sponsor (on the browse page, already-sponsored families are
        hidden, except a donor’s own family; administrators can reveal all of them). What is never public: the family name, contact name,
        address, or phone number; the identity or contact information of donor sponsors; and internal program notes.
      </p>

      <h2>How We Use and Share Information</h2>
      <p>
        We use the information we collect to run the holiday program: matching donors with families, coordinating shopping, wrapping, and
        delivery, sending transactional emails, and meeting our obligations as a tax-exempt organization.
      </p>
      <p>We never sell, rent, or trade personal information. Sharing is limited to the following:</p>
      <ul>
        <li>
          <strong>Coordinating the sponsorship.</strong> Your display name is accessible only to the program staff and volunteers who need
          it to coordinate the sponsorship. It is never shown publicly on the website.
        </li>
        <li>
          <strong>Within the program.</strong> Family information is shared with the referrer who referred the family and with the staff and
          volunteers who coordinate shopping, wrapping, and pickup for that family.
        </li>
        <li>
          <strong>Service providers.</strong> The vendors who host our website, send our emails, and process donations (Zeffy) may access
          only the data they need to perform their contracted services, and they must keep it confidential.
        </li>
        <li>
          <strong>When required by law.</strong> We may disclose information to comply with subpoenas, court orders, and other legal
          process.
        </li>
      </ul>
      <p>
        Because we do not disclose personal information to third parties for their direct marketing, California’s “Shine the Light” law
        (Civil Code § 1798.83) does not apply to us.
      </p>

      <h2>Your Choices</h2>
      <ul>
        <li>
          <strong>Access, correction, and deletion.</strong> Email us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> to request
          a copy of, correction to, or deletion of the personal information we hold about you, and we will review and respond to reasonable
          requests.
        </li>
        <li>
          <strong>Unsubscribe.</strong> Every program email we send includes an unsubscribe option — except for a few security emails, such
          as password resets. We keep a record of your choice so you won’t receive further program emails from us.
        </li>
        <li>
          <strong>California privacy rights.</strong> California 501(c)(3) nonprofit organizations are exempt from the California Consumer
          Privacy Act (CCPA) as amended by the CPRA, but we voluntarily honor reasonable requests to access, correct, or delete personal
          information.
        </li>
      </ul>

      <h2>Cookies and Online Tracking</h2>
      <p>
        We use only first-party, functional cookies (to keep you logged in). We do not use third-party advertising cookies, social-media
        pixels, or analytics tools that track visitors across other websites. Because we do not track across sites, browser signals such as
        “Do Not Track” or Global Privacy Control have nothing for us to act on — we honor them by simply not tracking at all.
      </p>

      <h2>Security</h2>
      <p>
        We protect personal information with industry-standard safeguards: all traffic is encrypted in transit (HTTPS), passwords are stored
        only as one-way hashes, access to program data is limited to the people who need it for the program, and we maintain regular
        backups. However, no method of internet transmission or electronic storage is 100% secure, and we cannot guarantee absolute
        security. If we ever suffer a data breach affecting California residents, we will notify affected individuals as required by
        California law (Civil Code § 1798.82).
      </p>

      <h2>Data Retention</h2>
      <p>
        We keep account and program information for as long as it is needed to run the program and for a reasonable period afterward, then
        delete or anonymize it so it can no longer be linked to you. Financial and donation-related records are kept for seven years to
        satisfy IRS documentation requirements.
      </p>

      <h2>Children’s Privacy</h2>
      <p>
        Our website is not directed to children under 13, and we do not knowingly collect personal information directly from children.
        Because our program serves families with children, the limited information we hold about children (first name, family role, age, and
        wish details) is provided by a parent or guardian, or by the program partner who referred the family. Parents and guardians may
        contact us at any time to review or request deletion of information provided about their children.
      </p>

      <h2>Changes to This Policy</h2>
      <p>
        We will post any material changes to this policy on this page and update the “Last updated” date at the top. Continued use of the
        site after a change indicates acceptance of the revised policy.
      </p>

      <h2>External Links</h2>
      <p>
        Our website and emails may link to sites we do not operate, such as our social media profiles and Zeffy’s donation page. We are not
        responsible for the privacy practices of those external sites, and we encourage you to read their privacy policies.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy, or requests about your personal information? Contact us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </StaticPage>
  );
}

import { Link } from "react-router-dom";
import referrerDashboard from "../assets/help/referrer-dashboard.png";
import referrerFamilies from "../assets/help/referrer-families.png";
import referrerFamilyDetail from "../assets/help/referrer-family-detail.png";
import referrerFamilyInvites from "../assets/help/referrer-family-invites.png";
import referrerWishReview from "../assets/help/referrer-wish-review.png";
import { HelpImage } from "../components/HelpImage";
import { HelpPage } from "../components/HelpPage";
import { ROLE_HOME, ROUTES } from "../lib/routes";

/**
 * Referrer guide: how referrers bring families in and shepherd them through
 * the wish list process. Section ids match the screenshot slugs.
 */
export default function HelpReferrer() {
  return (
    <HelpPage
      backTo={ROLE_HOME.referrer}
      title="Referrer Guide"
      intro={
        <p>
          You are the bridge between families and the program. You invite families in, keep their profiles complete, check their wishes, and
          send them to the admin for approval. Here is the tour.
        </p>
      }
      sections={[
        {
          id: "dashboard",
          title: "Your dashboard",
          body: (
            <>
              <p>
                Your dashboard shows your name, the referrer profile card, any work that is waiting on you, and the cards for the pages you
                will use most.
              </p>
              <HelpImage
                src={referrerDashboard}
                alt="The referrer dashboard with a welcome card, queue alerts, and navigation cards"
                caption="Alert banners appear at the top when a queue is waiting."
              />
              <h3>The referrer profile card</h3>
              <p>
                The welcome card at the top shows your Referrer ID. Below it, the Referrer Profile card holds your name, phone number, and
                pickup window — use the Edit button to update your name or phone. The pickup window (when to pick up your families' gifts)
                is set by the program and shown here for reference. The card also shows your family invite code with a copy button, and your
                family limit, shown as used over the cap (for example 8 / 10).
              </p>
              <h3>Queue alerts</h3>
              <p>
                A banner appears when a family is waiting for your verification, and another appears when submitted wishes are waiting for
                your review. Each banner links to its queue, and both disappear when the queue is empty.
              </p>
              <h3>The cards</h3>
              <ul>
                <li>
                  <strong>My Families</strong>: your verified families and their profiles.
                </li>
                <li>
                  <strong>Family Invites</strong>: your invite code and the families waiting for verification.
                </li>
                <li>
                  <strong>Wish Review</strong>: the families that submitted their wish lists.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "family-invites",
          title: "Invite a family",
          body: (
            <>
              <p>
                Families join through you. You share your family invite code, and the family registers with it. Then you confirm the family
                is the right one.
              </p>
              <HelpImage
                src={referrerFamilyInvites}
                alt="The family invites page with the invite code card and a Families to Verify table"
                caption="Your invite code up top. Families waiting for your confirmation below."
              />
              <h3>Your code</h3>
              <p>
                The code card at the top holds your invite code, which looks like KFI-XXXXXX. Share it however you like, in person, by text,
                or by email. The <strong>Send invite</strong> button emails your invite code with a link to register. The counter under the
                code shows how many invite emails you have sent, out of your cap.
              </p>
              <h3>Families to verify</h3>
              <p>
                When a family registers with your code, it lands in the <strong>Families to Verify</strong> table. Check that the family is
                who you referred, then:
              </p>
              <ul>
                <li>
                  <strong>Confirm</strong> adds the family to your list and lets the family start its wish list.
                </li>
                <li>
                  <strong>Reject</strong> declines it, and the family never appears under your name.
                </li>
              </ul>
              <p>
                The page also keeps a history of the invites you sent, with their delivery status, so you can answer a family that says it
                never got the email.
              </p>
            </>
          ),
        },
        {
          id: "families",
          title: "Your families",
          body: (
            <>
              <p>This is your roster: every family you have confirmed, with its family wish, contact, and headcount.</p>
              <HelpImage
                src={referrerFamilies}
                alt="The My Families page with a table of families and Manage, Submit, Edit, and Delete buttons"
                caption="The counter next to the Verified Families heading shows how many of your family slots are used."
              />
              <h3>What the columns mean</h3>
              <ul>
                <li>
                  <strong>FAMILY WISH</strong>: the one whole-household wish the family asked for.
                </li>
                <li>
                  <strong>CONTACT</strong>: the person the family chose to reach.
                </li>
                <li>
                  <strong>PEOPLE</strong>: how many members the family has added so far.
                </li>
              </ul>
              <h3>The action buttons</h3>
              <ul>
                <li>
                  <strong>Manage</strong> opens the family's profile and people.
                </li>
                <li>
                  <strong>Submit</strong> sends the family's list for admin review while the list is still open for editing. It disappears
                  while the list is in review, and comes back as <strong>Re-submit</strong> if the admin sends it back.
                </li>
                <li>
                  <strong>Edit</strong> updates the family profile.
                </li>
                <li>
                  <strong>Delete</strong> removes the family from your list.
                </li>
              </ul>
              <p>A banner at the top links to the Family Invites page while any family waits for your verification.</p>
            </>
          ),
        },
        {
          id: "add-family",
          title: "Add a family manually",
          body: (
            <>
              <p>
                The <strong>+ Add family</strong> button sits at the top of My Families, next to the Verified Families counter. You can use
                it to add a family manually if you already know everyone's wishes.
              </p>
              <p>
                The button shows while you are under your family limit. Click it to open a form right on the page with the family name, the
                contact, the family wish, the address, and the phone number. Fill it in and click <strong>Create</strong>.
              </p>
              <h3>What happens next</h3>
              <ul>
                <li>
                  The family joins your Verified Families table at once, with zero people, and counts toward your family limit like any
                  other family.
                </li>
                <li>
                  Open it with <strong>Manage</strong> and add each person and their wishes (the next section walks through that page).
                </li>
                <li>
                  When the list is complete, <strong>Submit for admin review</strong> in the top right sends it down the same review path as
                  an invited family.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "family-detail",
          title: "A family's profile and people",
          body: (
            <>
              <p>
                Open a family from My Families to see its full profile and the people it has added. This is where you make sure the list is
                complete and accurate before it moves on.
              </p>
              <HelpImage
                src={referrerFamilyDetail}
                alt="A family detail page with the family profile, internal notes, and the people table"
                caption="The profile on top, the people and wishes below."
              />
              <h3>The profile</h3>
              <p>
                The top card shows the family name, contact, family wish, bio, address, and phone, plus an <strong>Internal Notes</strong>{" "}
                section that only you and admins can see. Use it for context the program should know but the public should not.
              </p>
              <h3>The people table</h3>
              <p>
                Each row is one person with their wishes — a child's practical wish and fun wish side by side, or an adult's single wish.
                Check that everyone in the home is listed, that ages look right, and that wishes are specific and affordable (the program's{" "}
                <Link to={ROUTES.WISH_LIST_GUIDE} className="underline">
                  wish rules
                </Link>{" "}
                cap individual wishes at $50).
              </p>
              <h3>Sending it forward</h3>
              <p>
                When the list is complete, click <strong>Submit for admin review</strong> in the top right. The list goes straight to the
                admin queue, since you are reviewing it right here. Lists the family itself submits with DONE first stop in your Wish Review
                queue.
              </p>
            </>
          ),
        },
        {
          id: "wish-review",
          title: "Wish review",
          body: (
            <>
              <p>
                When a family clicks DONE, its wish list lands in your review queue. You are the first pair of eyes on what donors will see.
              </p>
              <HelpImage
                src={referrerWishReview}
                alt="The wish review queue with one family row and View, Approve, and Reject buttons"
                caption="One row per family, with its people count and the time it was requested."
              />
              <h3>Approve or reject</h3>
              <ul>
                <li>
                  <strong>View</strong> opens the family's people and wishes.
                </li>
                <li>
                  <strong>Approve</strong> submits the wishes for admin review. An admin gives them a final look, and then the family
                  appears on the public family list.
                </li>
                <li>
                  <strong>Reject</strong> sends the wishes back to the family with a reason, so they can adjust the list and try again.
                </li>
              </ul>
              <p>
                When you approve, a toast confirms that the wishes were submitted for admin review. When you reject, the family sees your
                reason on its dashboard.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}

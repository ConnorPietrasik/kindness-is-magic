import { Link } from "react-router-dom";
import donorBrowse from "../assets/help/donor-browse.png";
import donorCart from "../assets/help/donor-cart.png";
import donorClaimDetail from "../assets/help/donor-claim-detail.png";
import donorClaims from "../assets/help/donor-claims.png";
import donorRegister from "../assets/help/donor-register.png";
import { HelpImage } from "../components/HelpImage";
import { HelpPage } from "../components/HelpPage";
import { CASH_CLAIM_AMOUNT_USD, CASH_CLAIM_GROCERIES_AMOUNT_USD } from "../lib/constants";
import { DONATE_URL } from "../lib/links";
import { ROUTES } from "../lib/routes";

/**
 * Public donor (sponsor) guide. Rendered outside ProtectedRoute, so it
 * carries its own SiteFooter and links back to the brochure.
 * Section ids match the screenshot slugs.
 */
export default function HelpDonor() {
  return (
    <HelpPage
      renderFooter
      backTo={ROUTES.HOME}
      backLabel="Home"
      title="Sponsor Guide"
      intro={
        <p>
          Sponsoring a family means covering one family's holiday wish list, either with gifts you buy yourself or with $
          {CASH_CLAIM_AMOUNT_USD} that our volunteers use to buy the family's gifts. This guide walks through the whole journey, from
          finding a family to watching the wishes get fulfilled.
        </p>
      }
      sections={[
        {
          id: "how-it-works",
          title: "How sponsoring works",
          body: (
            <>
              <p>
                Each family in the program has a wish list: one wish for the whole household, one for each adult, and two for each child. A
                sponsorship covers that list.
              </p>
              <ul>
                <li>
                  <strong>Gift sponsorship.</strong> You sponsor the family's wish list, buy the gifts, and bring them to us by the drop-off
                  deadline. We check that every wish is covered, wrap what's still unwrapped, and get them to the family in time for a
                  magical Christmas.
                </li>
                <li>
                  <strong>Cash sponsorship, ${CASH_CLAIM_AMOUNT_USD}.</strong> Your ${CASH_CLAIM_AMOUNT_USD} covers the family's wish list,
                  and our volunteers take care of the rest.
                </li>
                <li>
                  <strong>General donation.</strong> A direct gift to the program, and 100% of it goes to gifts.
                </li>
              </ul>
              <p>
                Families show a short story, how many people they have, and the age range, so you can pick the family that speaks to you.
              </p>
            </>
          ),
        },
        {
          id: "find-a-family",
          title: "Find a family",
          body: (
            <>
              <p>
                The family list is public. Open it from the <strong>Browse families</strong> link on the sign in page, or the{" "}
                <strong>Choose a family to sponsor</strong> button on the home page.
              </p>
              <HelpImage
                src={donorBrowse}
                alt="The public family list with a Three ways to help banner, filters, and family cards"
                caption="Each card shows a family's ID, its story, its size, and the ages of its members."
              />
              <h3>Filtering</h3>
              <p>
                Use the <strong>Min</strong> and <strong>Max Family Members</strong> boxes to narrow by household size, and the{" "}
                <strong>Sort</strong> button to reorder (it cycles through family size and youngest age). Open a card to read the family's
                wish list and start the sponsorship.
              </p>
              <p>
                Once you have an account and sponsor a family, the page grows a <strong>Sponsored by me</strong> section at the top, so your
                families stay one click away.
              </p>
            </>
          ),
        },
        {
          id: "sponsor-a-family",
          title: "Sponsor a family",
          body: (
            <>
              <p>
                Open a family's page and click <strong>Sponsor this family</strong>. A small form asks how you want to sponsor:
              </p>
              <ul>
                <li>
                  <strong>Gifts.</strong> Click <strong>Sponsor family</strong> and the sponsorship is committed right away, with a
                  confirmation email carrying the family's full wish list.
                </li>
                <li>
                  <strong>Cash.</strong> Click <strong>Add to cart</strong> and the family joins your cart, where the $
                  {CASH_CLAIM_AMOUNT_USD} sponsorship is created at checkout.
                </li>
              </ul>
              <p>If a family is marked (already shopping), shopping for that family has started, and it accepts cash sponsorships only.</p>
              <p>
                Sponsoring more than one family? Sponsor each one. Cash sponsorships go into the cart, where you pay for the whole group at
                once. Gift sponsorships are capped at five families; cash has no cap.
              </p>
            </>
          ),
        },
        {
          id: "paying",
          title: "Paying with Zeffy",
          body: (
            <>
              <p>Your cart is where the payment happens.</p>
              <HelpImage
                src={donorCart}
                alt="The sponsorship cart with family line items, a total, and the Pay with Zeffy button"
                caption={`Each line is one family at $${CASH_CLAIM_AMOUNT_USD}, with an optional $${CASH_CLAIM_GROCERIES_AMOUNT_USD} groceries add on.`}
              />
              <h3>What the cart shows</h3>
              <ul>
                <li>
                  One line per family at ${CASH_CLAIM_AMOUNT_USD}, with an optional <strong>groceries</strong> add on for $
                  {CASH_CLAIM_GROCERIES_AMOUNT_USD} more per family.
                </li>
                <li>A total for everything in the cart.</li>
                <li>A payment window with a deadline. Complete the payment by that time to keep the sponsorship.</li>
              </ul>
              <h3>Step by step</h3>
              <ol>
                <li>
                  Click <strong>Pay with Zeffy</strong>. The Zeffy form opens in a new tab.
                </li>
                <li>
                  Enter your cart total exactly, and set the optional 11% tip to $0 by choosing Other and entering 0 (the page shows a
                  screenshot). The tip goes to Zeffy, so setting it to $0 keeps every penny of your donation for the family.
                </li>
                <li>
                  Complete the payment, then return to the cart. The page checks for your payment automatically and confirms it when the
                  payment lands. If the cart doesn't automatically confirm, an admin will match it manually.
                </li>
              </ol>
              <h3>If something doesn't line up</h3>
              <ul>
                <li>
                  <strong>Different amount.</strong> If the payment does not match your cart total, the cart says so, and an admin matches
                  it manually. Your money still reaches the family.
                </li>
                <li>
                  <strong>Window closed.</strong> If the payment window closes before you pay, the sponsorship is released and the family
                  goes back on the browse list. If you did pay, an admin can still match your payment manually.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "my-sponsorships",
          title: "Track your sponsorships",
          body: (
            <>
              <p>
                <strong>My Sponsorships</strong> is your overview: every family you sponsor, its status, and what it covers.
              </p>
              <HelpImage
                src={donorClaims}
                alt="The My Sponsorships page with a table of family, status, commitment, and actions"
                caption="Awaiting payment rows carry a Go to checkout button until the payment lands."
              />
              <ul>
                <li>
                  <strong>Awaiting payment</strong>: the sponsorship is committed, with a pay by date under the status. Once the date
                  passes, it shows that the window closed. Click <strong>Go to checkout</strong> to finish.
                </li>
                <li>
                  <strong>Active</strong>: the sponsorship is in motion.
                </li>
                <li>
                  <strong>Fulfilled</strong>: your part is done; thank you for your kindness!
                </li>
              </ul>
              <p>
                Open a sponsorship with <strong>View</strong> to see the full picture:
              </p>
              <HelpImage
                src={donorClaimDetail}
                alt="A sponsorship detail page with status, the family wish, and the family members and wishes table"
                caption="The family's full wish list, right where you can check it against your commitment."
              />
              <p>
                The detail page shows the status, the commitment (gifts or cash), when the sponsorship was created, the family wish, and
                every person's wishes. The menu in the top right holds <strong>Edit details</strong> (your notes, and the sponsorship type
                while it is still unpaid) and <strong>Cancel sponsorship</strong>, which is available while the sponsorship is unpaid.
              </p>
            </>
          ),
        },
        {
          id: "after-payment",
          title: "What happens next",
          body: (
            <>
              <p>Here is what happens after you sponsor, and how you can follow along.</p>
              <ul>
                <li>
                  <strong>Gift sponsorship.</strong> Your confirmation email has the full wish list, and the family's page has wish cards
                  you can print for your shopping trip. Buy the gifts, attach the wish cards to them, and drop them off by the gift drop-off
                  deadline, wrapped or unwrapped. We check that every wish is covered, wrap what's still unwrapped, and get them to the
                  family in time for a magical Christmas.
                </li>
                <li>
                  <strong>Cash sponsorship.</strong> Our volunteers use your ${CASH_CLAIM_AMOUNT_USD} to buy the family's wishes and the
                  family receives everything in time for a magical Christmas. Zeffy emails your receipt separately.
                </li>
              </ul>
              <p>
                Your sponsorship shows as <strong>Active</strong> until the program marks it fulfilled. Keep an eye on My Sponsorships as
                statuses move, and check the detail page to see the list you backed.
              </p>
            </>
          ),
        },
        {
          id: "get-started",
          title: "Get started",
          body: (
            <>
              <p>
                To sponsor a family, create a free account. On the{" "}
                <Link to={ROUTES.LOGIN} className="underline">
                  sign in page
                </Link>
                , choose <strong>Register to sponsor a family</strong>:
              </p>
              <HelpImage
                src={donorRegister}
                alt="The donor registration form with display name, email, password, and confirm password fields"
                caption="A display name, an email, and a password is all it takes."
              />
              <ul>
                <li>Enter a display name, an email, and a password of at least 8 characters, then confirm it.</li>
                <li>
                  Click <strong>Create account</strong>, and you land on your dashboard.
                </li>
                <li>
                  From there, open <strong>Browse Families</strong> and pick your family.
                </li>
              </ul>
              <p>
                Prefer a one time gift without an account? Use the{" "}
                <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" className="underline">
                  Donate
                </a>{" "}
                link in the site footer, and 100% of it goes to gifts.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}

import { Link } from "react-router-dom";
import adminAssignedGifts from "../assets/help/admin-assigned-gifts.png";
import adminCsvUpload from "../assets/help/admin-csv-upload.png";
import adminDashboard from "../assets/help/admin-dashboard.png";
import adminDeadlines from "../assets/help/admin-deadlines.png";
import adminDeliverySlips from "../assets/help/admin-delivery-slips.png";
import adminEmailUnsubscribes from "../assets/help/admin-email-unsubscribes.png";
import adminEmails from "../assets/help/admin-emails.png";
import adminFamilies from "../assets/help/admin-families.png";
import adminInviteCodes from "../assets/help/admin-invite-codes.png";
import adminPackingSlips from "../assets/help/admin-packing-slips.png";
import adminPeople from "../assets/help/admin-people.png";
import adminReferrers from "../assets/help/admin-referrers.png";
import adminSponsorships from "../assets/help/admin-sponsorships.png";
import adminUsers from "../assets/help/admin-users.png";
import adminWishCards from "../assets/help/admin-wish-cards.png";
import adminWishReview from "../assets/help/admin-wish-review.png";
import adminWishes from "../assets/help/admin-wishes.png";
import adminZeffyPayments from "../assets/help/admin-zeffy-payments.png";
import { HelpImage } from "../components/HelpImage";
import { HelpPage } from "../components/HelpPage";
import { ROLE_HOME, ROUTES } from "../lib/routes";

/**
 * Admin guide: page-by-page walkthrough of the admin area.
 * Each section id matches its screenshot slug in src/assets/help/.
 */
export default function HelpAdmin() {
  return (
    <HelpPage
      backTo={ROLE_HOME.admin}
      title="Admin Guide"
      intro={
        <p>
          You run the whole event from this area: referrers and their families, the wish review queue, gift assignments, sponsorships,
          deadlines, payments, and the people who use the app. This guide walks through every page. Use the links on the left to jump
          around.
        </p>
      }
      sections={[
        {
          id: "dashboard",
          title: "Your dashboard",
          body: (
            <>
              <p>
                The dashboard greets you by name and does two things: it surfaces work that is waiting on you, and it gives you one-click
                access to the pages you use most.
              </p>
              <HelpImage
                src={adminDashboard}
                alt="The admin dashboard with a queue alert and a grid of tiles"
                caption="Queue alerts appear at the top. Your tiles sit below."
              />
              <h3>Queue alerts</h3>
              <p>
                A banner appears when families are awaiting your wish approval, and it links straight to the queue. When the queue is empty,
                the banner is gone.
              </p>
              <h3>Dashboard tiles</h3>
              <p>
                The tile grid is your personal workspace. Drag a tile and the grid makes room as you go — the tile moves to its new spot
                while you drag and the others slide out of the way, so you can see exactly where it will land. Release to drop it, or focus
                a tile and use the left and right arrow keys to nudge it one step at a time. Click the small gear button above the tiles to
                open the tile menu, check or uncheck tiles to show or hide them, and use Reset to bring back the default tiles and order.
                Your choices are saved on this device, so each admin builds their own layout on their own computer.
              </p>
              <p>
                On any page that loads data, a small refresh button sits in the top right. Click it to reload that page's data without
                reloading the page.
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
                Every family that wants donors to see its wish list passes through you here. A family appears in the queue after its
                referrer approves the wishes, so what you are reviewing is the final version the family and its referrer agree on.
              </p>
              <HelpImage
                src={adminWishReview}
                alt="The wish review queue with one family row and View, Approve, and Reject buttons"
                caption="Each row is one family waiting for you. View, Approve, and Reject live in the Actions column."
              />
              <h3>Working the queue</h3>
              <ul>
                <li>
                  <strong>View</strong> opens the family's people and wishes so you can check sizes, ages, and descriptions.
                </li>
                <li>
                  <strong>Approve</strong> publishes the family to the public family list, where donors can find it and sponsor it.
                </li>
                <li>
                  <strong>Reject</strong> sends the wishes back to the referrer with a reason they can see, so they can fix the list with
                  the family and resubmit.
                </li>
              </ul>
              <p>
                Approval also unlocks the family's packing slip, so approved families are ready for shopping and delivery from that moment.
              </p>
            </>
          ),
        },
        {
          id: "referrers",
          title: "Referrers",
          body: (
            <>
              <p>
                Referrers are the people who bring families into the program: pastors, social workers, teachers, neighbors. This page is
                where you create them and watch their progress.
              </p>
              <HelpImage
                src={adminReferrers}
                alt="The manage referrers page with an Active and Deleted tab, a table of referrers, and Add referrer button"
                caption="Each referrer shows how many of their family slots they have used."
              />
              <h3>Adding a referrer</h3>
              <ul>
                <li>
                  <strong>Invite referrers</strong> generates a one-time invite code the new referrer enters to create their login, and can
                  email it to them right away. Referrers who register with a code that is not locked to their email show up here with
                  Approve and Reject buttons until you confirm them. <strong>Inviting via email is the recommended path</strong>
                </li>
                <li>
                  <strong>+ Add referrer</strong> creates the referrer profile right away, approved, with its family invite code generated.
                  It does not create a login.
                </li>
                <li>
                  To give a referrer a login directly, use <strong>+ Add user</strong> on the Manage Users page and link the login to the
                  referrer.
                </li>
              </ul>
              <h3>The table</h3>
              <p>
                The Family limit column shows each referrer's used families over their cap (for example 8/10). <strong>Manage</strong> opens
                that referrer's families, <strong>Edit</strong> changes their details and limit, and the overflow menu (three dots) holds
                send email, reset sent emails, and delete. The Deleted tab lists removed referrers, and a Restore button on each row brings
                one back.
              </p>
            </>
          ),
        },
        {
          id: "families",
          title: "Families",
          body: (
            <>
              <p>
                Every family in the program, from every referrer, in one searchable table. This is the page to open when you need to find a
                family fast or check how far along it is.
              </p>
              <HelpImage
                src={adminFamilies}
                alt="The manage families page with search and filter controls and a table of families"
                caption="Each row shows the family's display ID, wish, contact, and referrer."
              />
              <h3>Finding a family</h3>
              <p>
                Search across all fields, or narrow the table with the filters: status, lock level, and a minimum or maximum number of
                people. The family name, family wish, contact, and phone columns each have their own filter box too. Row colors track wish
                review: a green row is fully approved and visible to donors, and a yellow row cleared its referrer and is waiting on you.
              </p>
              <h3>Working with a family</h3>
              <ul>
                <li>
                  <strong>Manage</strong> opens the family's people and wishes.
                </li>
                <li>
                  <strong>Edit</strong> updates the family profile (name, contact, address, phone, bio, family wish).
                </li>
                <li>
                  The overflow menu (three dots) holds send email, view the packing and delivery slips, reset the wish lock, fully approve,
                  and delete. The Deleted tab lists removed families, and a Restore button on each row brings one back.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "people",
          title: "People",
          body: (
            <>
              <p>
                People are the individual members of every family, each with their own wishes. This page lists everyone in the program so
                you can spot problems across families, such as a missing age or a wish that is too expensive.
              </p>
              <HelpImage
                src={adminPeople}
                alt="The manage people page with a table of people, their wishes, and their family"
                caption="The Wishes column shows practical and fun wishes together."
              />
              <p>
                Filter by family, name, wish text, or an age range. <strong>+ Add person</strong> adds a member to a family, and{" "}
                <strong>Edit</strong> opens a person's details and wishes. The Deleted tab shows removed people you can restore.
              </p>
            </>
          ),
        },
        {
          id: "wishes",
          title: "Wishes",
          body: (
            <>
              <p>
                Wishes is the full list of every request in the program, one row per wish, across all families. It is the best place to see
                the shopping workload at a glance.
              </p>
              <HelpImage
                src={adminWishes}
                alt="The manage wishes page with type badges, size and color columns, and a batch assign button"
                caption="Type badges mark each wish as family, adult, practical, or fun."
              />
              <h3>Reading a row</h3>
              <p>
                The type badge tells you who the wish is for: a whole-family wish, an adult's wish, or a child's practical or fun wish. The
                Size and Color columns carry the details a shopper needs. The Purchased column fills in as purchasers buy gifts, and
                Assigned to shows which purchaser owns the wish.
              </p>
              <h3>Batch assign</h3>
              <p>
                Check the boxes next to several wishes, then click <strong>Batch assign</strong> to give them all to one purchaser in a
                single step. Use it when you are assigning a whole family's list to one person.
              </p>
            </>
          ),
        },
        {
          id: "wish-cards",
          title: "Blank wish cards",
          body: (
            <>
              <p>Some wishes arrive without their cards, or the cards get damaged. The blank wish card page exists for those moments.</p>
              <HelpImage
                src={adminWishCards}
                alt="The blank wish cards page showing printable person cards and a family wish card with a Print button"
                caption="Set how many person and family cards you need, then print."
              />
              <p>
                Choose how many person cards and family cards to print. Each person card has lines for name, age, wish type, wish, size, and
                color; the family card holds the whole-household wish. Fill the cards in by hand and attach each card to its gift.
              </p>
            </>
          ),
        },
        {
          id: "assignments",
          title: "Assigning gifts, packing, and delivery",
          body: (
            <>
              <p>Once a family is approved, its wishes need shoppers and a delivery person. Three pages cover that chain.</p>
              <h3>Assigned gifts</h3>
              <HelpImage
                src={adminAssignedGifts}
                alt="The assigned gifts page with a table of wishes and a Mark purchased button"
                caption="The wishes assigned to you, with each gift's purchased status."
              />
              <p>
                This page lists the wishes assigned to you personally: for when you shop for a family yourself. Mark a gift purchased from
                its row, or select several rows and use the <strong>Mark purchased</strong> button at the top. To hand wishes to a purchaser
                instead, use the Manage Wishes page: assign one wish from its row, or check several and use <strong>Batch assign</strong> at
                the top. As gifts get bought, the Purchased column fills in with the date; the where-it-was-bought detail lives in the
                Purchased Where column, which is hidden by default.
              </p>
              <h3>Packing slips</h3>
              <HelpImage
                src={adminPackingSlips}
                alt="Printable packing slips, one table per family with each person's wishes"
                caption="Each slip lists the family's display ID and each person's name, age, and wishes."
              />
              <p>
                Packing slips are print-ready sheets with one table per approved family: the family's display ID, its family wish, and a row
                per person with their ID, name, age, and wishes. The family's name and address stay off the paper. Use the Print button in
                the top right; the print fits as many families as fit on each landscape page and never splits a family's slip across pages.
              </p>
              <h3>Delivery slips</h3>
              <HelpImage
                src={adminDeliverySlips}
                alt="Printable delivery slips with a family's display ID, address, contact, and phone"
                caption="Delivery slips give the driver everything needed to reach the family."
              />
              <p>
                Delivery slips are print-ready cards with each family's display ID, family name, address, contact, and phone. The scope bar
                at the top picks who the slips are for: everyone, all assigned families, one specific delivery person, or the unassigned
                families.
              </p>
            </>
          ),
        },
        {
          id: "sponsorships",
          title: "Sponsorships",
          body: (
            <>
              <p>
                This page lists every sponsorship in the program: who sponsored which family, what they committed to, and where the payment
                stands.
              </p>
              <HelpImage
                src={adminSponsorships}
                alt="The sponsorships page with a table of donor, family, commitment, status, and actions"
                caption="Status shows the payment state: awaiting payment, active, fulfilled, or cancelled with its date."
              />
              <h3>What the statuses mean</h3>
              <ul>
                <li>
                  <strong>Awaiting payment</strong>: a cash sponsorship with an open payment window.
                </li>
                <li>
                  <strong>Active</strong>: the sponsorship is committed and in motion.
                </li>
                <li>
                  <strong>Fulfilled</strong>: the gifts / money have been delivered and the sponsorship is complete.
                </li>
                <li>
                  <strong>Cancelled</strong>: the sponsorship was cancelled, with the date. Restoring an unpaid cash sponsorship reopens it
                  with a fresh payment window.
                </li>
              </ul>
              <p>A paid sponsorship is final: once the payment lands, it stays attached to the family.</p>
              <h3>Finding a sponsorship</h3>
              <p>Search by donor email or family name, and use the status filter to narrow the list to active or cancelled sponsorships.</p>
            </>
          ),
        },
        {
          id: "deadlines",
          title: "Event deadlines",
          body: (
            <>
              <p>
                Deadlines keep the event on its clock. They show up as banners across the app, and in enforced mode they move work forward
                automatically.
              </p>
              <HelpImage
                src={adminDeadlines}
                alt="The event deadlines page with an add deadline form and a table of scheduled deadlines"
                caption="Add a deadline with a type, label, due date, and mode."
              />
              <h3>The three types</h3>
              <ul>
                <li>
                  <strong>Family information</strong>: the date families should finish their profiles. Enforced mode auto-submits
                  unsubmitted families to their referrer's queue.
                </li>
                <li>
                  <strong>Referrer review</strong>: the date referrers should finish reviewing wishes. Enforced mode auto-promotes submitted
                  families to admin review.
                </li>
                <li>
                  <strong>Gift drop-off</strong>: the date donors stop being able to start gift sponsorships. Enforced mode blocks new gift
                  claims.
                </li>
              </ul>
              <h3>Display, reminders, enforced</h3>
              <p>
                <strong>Display only</strong> and <strong>Enforced</strong> show a banner with your label across the app.
                <strong>Reminders</strong> is reserved for reminder emails that are planned but not built yet — a reminders row never shows
                a banner. An enforced deadline's automatic action kicks in at 1:00 AM Pacific on the day after its due date; the banner's
                deadline day itself stays in effect through the end of that day. A deadline with no due date is inert.
              </p>
            </>
          ),
        },
        {
          id: "users",
          title: "Users and invite codes",
          body: (
            <>
              <p>
                Two pages manage who can sign in: Manage Users handles every login, and Invite Codes holds the one-time codes you email to
                new referrers.
              </p>
              <h3>Manage Users</h3>
              <HelpImage
                src={adminUsers}
                alt="The manage users page with a table of email, display name, role, and actions"
                caption="Create and edit any user, in any role."
              />
              <p>
                Use <strong>+ Add user</strong> to create a login for any role: admin, referrer, family, purchaser, or delivery. The table
                shows each user's role badge and what they are linked to (a family or a referrer). Filter by role, search by email or name,
                and use the Active and Deleted tabs to hide or recover users.
              </p>
              <h3>Invite codes</h3>
              <HelpImage
                src={adminInviteCodes}
                alt="The invite codes page with a table of codes, family limits, locked emails, and redemption status"
                caption="Email-locked codes auto-approve the new referrer. Unlocked codes wait for your approval."
              />
              <p>
                These are the one-time codes behind <strong>Invite referrers</strong>: each invite email carries a code the new referrer
                enters to create their account. Families use different codes: each referrer shares their own family invite code, which you
                can see in the Referrers table. Each code carries the new referrer's family limit. A code locked to a specific email can
                only be redeemed by that email, and the referrer is auto-approved when the code is redeemed. An unlocked code lands the
                referrer in your Referrers list with Approve and Reject buttons, waiting for your confirmation.
              </p>
              <p>
                Use the checkboxes to see redeemed, unredeemed, or expired codes. <strong>Extend</strong> re-arms a lapsed or revoked code
                with the same code text, and <strong>Revoke</strong> expires a code immediately.
              </p>
            </>
          ),
        },
        {
          id: "emails",
          title: "Email log and unsubscribes",
          body: (
            <>
              <p>
                The app sends its own emails: invite links, verification notices, payment requests, and confirmations. This log shows every
                send attempt, so you can answer questions like did the invite actually go out.
              </p>
              <HelpImage
                src={adminEmails}
                alt="The sent emails page with a table of recipient, kind, status, sender, and sent time"
                caption="Every email the app has sent, newest first."
              />
              <p>
                Search by recipient email, filter by kind or status, and use <strong>+ Compose</strong> to send a one-off email from inside
                the app. Rows marked Reset were cleared by an admin and no longer count toward invite limits.
              </p>
              <h3>Unsubscribed emails</h3>
              <HelpImage
                src={adminEmailUnsubscribes}
                alt="The unsubscribed emails page listing addresses that opted out"
                caption="These addresses are excluded from future app emails."
              />
              <p>When someone clicks unsubscribe in an app email, their address lands here and the app stops emailing them.</p>
            </>
          ),
        },
        {
          id: "zeffy-payments",
          title: "Zeffy payments",
          body: (
            <>
              <p>
                Donors pay through Zeffy, a card processor. Payments for sponsorships come back here, and the app matches each one to the
                donor's sponsorship automatically, by buyer email.
              </p>
              <HelpImage
                src={adminZeffyPayments}
                alt="The Zeffy payments page with a table of payments and a Match manually button"
                caption="Unmatched payments need a manual match. The Show matched checkbox reveals the rest."
              />
              <p>
                If a payment could not be matched (the donor used a different email, for example), it shows as Unmatched. Use{" "}
                <strong>Match manually</strong> to attach it to the right sponsorship. Donors who pay an amount that differs from their cart
                see a notice that an admin will review it, and you can find that payment here.
              </p>
              <p>
                The table shows unmatched payments first. Tick <strong>Show matched</strong> to see the full history of processed payments.
              </p>
            </>
          ),
        },
        {
          id: "csv-import",
          title: "CSV import",
          body: (
            <>
              <p>
                Setting up an event usually starts with a spreadsheet. The CSV import brings referrers, families, people, and users in from
                a single file.
              </p>
              <HelpImage
                src={adminCsvUpload}
                alt="The CSV import page with a drag and drop area and a Show template button"
                caption="Show template gives you the file layout to fill in."
              />
              <p>
                Click <strong>Show template</strong> to see the exact file layout, fill it in, then drag the file into the box (or browse
                for it) and click <strong>Import CSV</strong>. The import creates whatever sections are present in the file, so you can
                import just referrers, just families, or everything at once.
              </p>
            </>
          ),
        },
        {
          id: "role-guides",
          title: "Guides for other roles",
          body: (
            <>
              <p>
                You can open every guide on this site, so you can see each page exactly as that user sees it. When someone asks for help,
                open their guide, send them the link, or take a screenshot of the guide and point at the part you mean.
              </p>
              <ul>
                <li>
                  <Link to={ROUTES.HELP_REFERRER} className="underline">
                    Referrer Guide
                  </Link>
                  : invite codes, verifying families, and reviewing wish lists.
                </li>
                <li>
                  <Link to={ROUTES.HELP_FAMILY} className="underline">
                    Family Guide
                  </Link>
                  : adding people, writing wishes, and what happens after DONE.
                </li>
                <li>
                  <Link to={ROUTES.HELP_PURCHASER} className="underline">
                    Purchaser Guide
                  </Link>
                  : the assigned gifts list and marking gifts purchased.
                </li>
                <li>
                  <Link to={ROUTES.HELP_DELIVERY} className="underline">
                    Delivery Guide
                  </Link>
                  : packing slips and delivery slips for assigned families.
                </li>
                <li>
                  <Link to={ROUTES.HELP_DONOR} className="underline">
                    Sponsor Guide
                  </Link>
                  : the public guide donors read before and after sponsoring. Handy to share with people who are still deciding.
                </li>
              </ul>
            </>
          ),
        },
      ]}
    />
  );
}

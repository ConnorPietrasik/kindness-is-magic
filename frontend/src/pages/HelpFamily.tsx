import { Link } from "react-router-dom";
import familyDashboard from "../assets/help/family-dashboard.png";
import familyPeople from "../assets/help/family-people.png";
import { HelpImage } from "../components/HelpImage";
import { HelpPage } from "../components/HelpPage";
import { ROLE_HOME, ROUTES } from "../lib/routes";

/**
 * Family guide: how families build their wish list and what happens after
 * they submit it. Section ids match the screenshot slugs.
 */
export default function HelpFamily() {
  return (
    <HelpPage
      backTo={ROLE_HOME.family}
      title="Family Guide"
      intro={
        <p>
          Your job is simple: tell us who is in your home and what would make this year better. Your referrer and the program take it from
          there.
        </p>
      }
      sections={[
        {
          id: "dashboard",
          title: "Your dashboard",
          body: (
            <>
              <p>Your dashboard has one instruction: add everyone in your family, then click DONE.</p>
              <HelpImage
                src={familyDashboard}
                alt="The family dashboard with the DONE banner, a Manage People card, and the family profile"
                caption="The purple DONE button at the top right of the banner is the one to click when you are finished."
              />
              <h3>The banner</h3>
              <p>
                The banner at the top explains the one rule that matters: click <strong>DONE</strong> when you are finished adding people
                and wishes. That sends your whole list to your referrer, and after your referrer approves it, you will no longer be able to
                make changes.
              </p>
              <h3>The rest of the page</h3>
              <ul>
                <li>
                  <strong>Manage People</strong>: add, edit, and remove the people in your home.
                </li>
                <li>
                  <strong>My Family Profile</strong>: your family's details. Use <strong>Edit</strong> to update the name, contact, family
                  wish, bio, address, or phone.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "people",
          title: "Add your people and wishes",
          body: (
            <>
              <p>
                Every member of your home gets a row with their own wishes. Use <strong>+ Add person</strong> to add someone, then fill in
                their name, age, and wishes.
              </p>
              <HelpImage
                src={familyPeople}
                alt="The Manage People page with the wish writing tips and a table of family members and wishes"
                caption="The tips box at the top explains what to write."
              />
              <h3>What to write</h3>
              <p>
                The tips box at the top of the page covers the essentials. For the full rules and plenty of ideas and examples, read the{" "}
                <Link to={ROUTES.WISH_LIST_GUIDE} className="underline">
                  Wish List Guide
                </Link>
                .
              </p>
              <h3>Editing</h3>
              <p>
                Click <strong>Edit</strong> on any row to change a person or a wish. You can keep adjusting the list until you click DONE.
                Once it is with your referrer, editing is locked — the banner's <strong>Cancel request</strong> button is how you open it up
                again for one more edit.
              </p>
            </>
          ),
        },
        {
          id: "after-done",
          title: "What happens after you click DONE",
          body: (
            <>
              <p>Clicking DONE hands your list to your referrer. Here is the journey from that moment to gift day, in order:</p>
              <ol>
                <li>
                  <strong>Your referrer reviews the list.</strong> They check that everyone is included and the wishes are specific, and
                  they approve it or send it back with a note.
                </li>
                <li>
                  <strong>An admin gives it a final look.</strong> Once the admin approves, your family appears on the public family list,
                  where sponsors can find you.
                </li>
                <li>
                  <strong>Sponsors and volunteers step in.</strong> A sponsor covers your wish list, and volunteers make sure everything is
                  ready.
                </li>
                <li>
                  <strong>Your gifts arrive.</strong>
                </li>
              </ol>
              <p>
                If your list is sent back, you will see the reason on your dashboard. If your referrer sent it back, you can make the
                changes and submit again. If the admin sent it back, your referrer makes the changes and resubmits for you.
              </p>
            </>
          ),
        },
        {
          id: "wish-list",
          title: "Your public wish list",
          body: (
            <>
              <p>
                After the admin approves your list, your family has a public page. Sponsors see your family ID number, your bio, your family
                wish, and each person's wishes. Your family's name and other private details stay off the public page.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}

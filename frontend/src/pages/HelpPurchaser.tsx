import { Link } from "react-router-dom";
import purchaserGifts from "../assets/help/purchaser-gifts.png";
import { HelpImage } from "../components/HelpImage";
import { HelpPage } from "../components/HelpPage";
import { ROLE_HOME, ROUTES } from "../lib/routes";

/**
 * Purchaser guide: buying the gifts assigned to you. Section ids match the
 * screenshot slugs.
 */
export default function HelpPurchaser() {
  return (
    <HelpPage
      backTo={ROLE_HOME.purchaser}
      title="Purchaser Guide"
      intro={
        <p>
          You are the hands behind the magic: you buy the gifts on your list and mark them as bought so the delivery team knows what is
          packed. Here is how your page works.
        </p>
      }
      sections={[
        {
          id: "assigned-gifts",
          title: "Your assigned gifts",
          body: (
            <>
              <p>
                The <strong>Assigned Gifts</strong> card on your dashboard opens your list: every wish an admin assigned to you, one row per
                gift.
              </p>
              <HelpImage
                src={purchaserGifts}
                alt="The assigned gifts page with a table of wishes and Edit and Mark purchased buttons"
                caption="Each row tells you exactly what to buy, for whom, and in what size and color."
              />
              <h3>Reading a row</h3>
              <ul>
                <li>
                  <strong>ID</strong>: the wish's reference — the person's ID from the packing slip, plus a letter for the wish type (A
                  practical, B fun, X adult; family wishes end in -F).
                </li>
                <li>
                  <strong>PERSON</strong>: who the gift is for, or Family for a whole-household wish.
                </li>
                <li>
                  <strong>TYPE</strong>: family, adult, practical, or fun.
                </li>
                <li>
                  <strong>DESCRIPTION, SIZE, COLOR</strong>: exactly what to put in the bag.
                </li>
                <li>
                  <strong>PURCHASED</strong>: fills in once you mark the gift as bought.
                </li>
              </ul>
              <h3>Mark a gift purchased</h3>
              <p>
                Click <strong>Mark purchased</strong> on a row. A small form asks for the date (pre-filled with today), where you bought it,
                an optional note, and an optional received date. Save, and the row shows a green check with your date.
              </p>
              <h3>Bulk actions and edits</h3>
              <p>
                Bought a whole family's list in one trip? Check several rows and click the <strong>Mark purchased</strong> button at the top
                right to mark them together. Use <strong>Edit</strong> on a row to update the received date or your note, and the filters at
                the top (status, type, search, purchased date range) keep the list manageable.
              </p>
            </>
          ),
        },
        {
          id: "browse",
          title: "Browse and sponsor families",
          body: (
            <>
              <p>
                Besides buying what is assigned to you, you can sponsor a family yourself: cover a family's full wish list with a gift
                sponsorship, or support a family with a cash sponsorship.
              </p>
              <p>
                Your dashboard has a <strong>Browse Families</strong> card that opens the public family list. The same list is open to
                everyone at any time, and the{" "}
                <Link to={ROUTES.HELP_DONOR} className="underline">
                  Sponsor Guide
                </Link>{" "}
                walks through picking a family, the cart, and paying.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}

import deliveryDashboard from "../assets/help/delivery-dashboard.png";
import deliveryPackingSlips from "../assets/help/delivery-packing-slips.png";
import deliverySlips from "../assets/help/delivery-slips.png";
import { HelpImage } from "../components/HelpImage";
import { HelpPage } from "../components/HelpPage";
import { ROLE_HOME } from "../lib/routes";

/**
 * Delivery guide: packing and delivering for your assigned families.
 * Section ids match the screenshot slugs.
 */
export default function HelpDelivery() {
  return (
    <HelpPage
      backTo={ROLE_HOME.delivery}
      title="Delivery Guide"
      intro={
        <p>
          You get the gifts from the shopping table to the family's hands. The program hands you everything you need: your families, their
          addresses, and print-ready slips for both packing and driving.
        </p>
      }
      sections={[
        {
          id: "dashboard",
          title: "Your dashboard",
          body: (
            <>
              <p>Your dashboard lists the families assigned to you, with everything you need to reach them.</p>
              <HelpImage
                src={deliveryDashboard}
                alt="The delivery dashboard with two assigned family cards showing address, contact, and phone"
                caption="Each card carries the address, contact, and phone for one family."
              />
              <h3>The family cards</h3>
              <p>
                Each card shows the family's display ID, address, contact name, phone, and how many people are in the home. The display ID
                (like 1-1) is how you match a packed bag to a family.
              </p>
              <h3>The two action buttons</h3>
              <ul>
                <li>
                  <strong>View packing slips</strong>: the shopping list for each family's bag.
                </li>
                <li>
                  <strong>View delivery slips</strong>: the address cards for your route.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "packing-slips",
          title: "Packing slips",
          body: (
            <>
              <p>
                Packing slips are the reference sheets to see what each person gets. One slip per family, with every person's wishes listed
                out.
              </p>
              <HelpImage
                src={deliveryPackingSlips}
                alt="Printable packing slips for your assigned families, one table per family"
                caption="Each slip lists the family's display ID and each person's name, age, and wishes."
              />
              <p>
                Each slip has the family's display ID, the family wish, and a row per person with their name, age, and practical and fun
                wishes. The family's name and address stay off the slip.
              </p>
            </>
          ),
        },
        {
          id: "delivery-slips",
          title: "Delivery slips",
          body: (
            <>
              <p>Delivery slips are the address cards for your route. One card per family, with everything you need to find the door.</p>
              <HelpImage
                src={deliverySlips}
                alt="Printable delivery slips with each family's display ID, address, contact, and phone"
                caption="Print them and clip them to your bag."
              />
              <p>
                Each card carries the family's display ID, family name, address, contact, and phone. Print them from the{" "}
                <strong>Print</strong> button in the top right, and keep them with the bags: the display ID on a card matches the slip in
                the bag, so a bag always goes to the right address.
              </p>
              <h3>Day of delivery</h3>
              <ul>
                <li>Match each bag's slip to its delivery card by display ID before you leave.</li>
                <li>Call the contact on the card to agree on a time, and check the address against the card before you knock.</li>
              </ul>
            </>
          ),
        },
      ]}
    />
  );
}

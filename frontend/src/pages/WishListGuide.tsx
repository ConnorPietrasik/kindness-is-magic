/**
 * Wish List Guide — static public page.
 *
 * The standalone guide that family invite emails link to (and that the
 * registration, dashboard, and people pages point at). It explains the wish
 * model — what each family member gets and the $50 per-item limit — carries
 * the founder's Operation Nice List tips, and publishes the full fun and
 * practical example lists (deduped: the three movie-ticket lines are one
 * entry; the portable charger genuinely appears in both lists).
 */

import { StaticPage } from "../components/StaticPage";

/** Example "fun" wishes (Operation Nice List, deduped). */
const FUN_WISH_EXAMPLES = [
  "Toys",
  "Jewelry & watches",
  "Purse or wallet",
  "Stuffed animals",
  "Comic books",
  "Movie tickets — tell us AMC or Century",
  "Crafts kit (knitting, crochet, scrapbooking, painting, cardmaking, diamond painting…)",
  "Jewelry making kit",
  "Coloring book kits",
  "Remote control vehicle",
  "Dinosaurs",
  "Tea set",
  "Play Doh set",
  "Board games",
  "Box of chocolates (ask milk or dark)",
  "Perfume/cologne",
  "Nail polish kit",
  "Wireless headset or earbuds",
  "Makeup set",
  "Basketball/football/soccer ball",
  "Construction set",
  "Bluetooth speaker",
  "Tumbler",
  "Portable charger w/ built-in cables",
] as const;

/** Example "practical" wishes (Operation Nice List, deduped). */
const PRACTICAL_WISH_EXAMPLES = [
  "Backpack",
  "Sweats",
  "Tennis shoes",
  "Bathrobe",
  "Pajamas",
  "Jacket",
  "Socks and underwear (counts as one item as we can get both for under $50)",
  "Pillows",
  "Bath towels",
  "Sheets",
  "Comforter",
  "Bed-in-a-bag",
  "Books",
  "Blender",
  "Electric shaving kit",
  "Toaster",
  "Pots & pans",
  "Coffee maker",
  "Step-on garbage can",
  "Stationary set with stamps and envelopes",
  "Bathroom rugs",
  "Pet supplies",
  "Reading light",
  "Home tool kit",
  "Hair dryer",
  "Curling iron",
  "Standing fan",
  "Portable charger w/ built-in cables",
  "Sleeping bag",
  "Smoke detectors",
  "Diapers",
] as const;

export default function WishListGuide() {
  return (
    <StaticPage title="Writing Your Wish List">
      <p>
        When you add your family members, each one gets to tell us what they'd love to receive. Here's how the wish list works, with tips
        and plenty of examples to get you started.
      </p>

      <h2>What you can wish for</h2>
      <ul>
        <li>Every member of the household gets a gift.</li>
        <li>
          Children (under 18) get two wishes: one <strong>practical</strong> (clothes, bedding, household items) and one{" "}
          <strong>fun</strong> (toys, games, treats).
        </li>
        <li>Adults (18 and over) get one wish.</li>
        <li>Plus one wish for the whole family.</li>
        <li>
          Every item has a <strong>$50 price limit</strong>.
        </li>
      </ul>

      <h2>How to fill it in</h2>
      <ul>
        <li>Enter first names only.</li>
        <li>Pick the family role that's closest (grandmother, father, son…).</li>
        <li>If it's clothing (or anything with a size), include the size.</li>
        <li>
          Be as specific as you can — e.g. "purple size XL sweatshirt with a giraffe on it". We'll do our best to find the exact item,
          though sometimes we can only match part of the request.
        </li>
        <li>Wishes must be real, purchasable items — we can't ask donors for gift cards.</li>
      </ul>

      <h2>Great wish examples</h2>
      <h3>Fun wishes</h3>
      <ul>
        {FUN_WISH_EXAMPLES.map((wish) => (
          <li key={wish}>{wish}</li>
        ))}
      </ul>
      <h3>Practical wishes</h3>
      <ul>
        {PRACTICAL_WISH_EXAMPLES.map((wish) => (
          <li key={wish}>{wish}</li>
        ))}
      </ul>
    </StaticPage>
  );
}

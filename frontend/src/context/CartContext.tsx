/**
 * CartContext — the donor's uncommitted (frontend-local) sponsorship cart.
 *
 * Items are `{family_id, includes_groceries}` pairs persisted to localStorage
 * **keyed by the donor's user id** (accounts on a shared device don't bleed).
 * While an item merely sits here the family is *not* reserved — the backend
 * creates the pending cash claim at checkout, which is the commit point.
 *
 * This is deliberately not React Query: the uncommitted cart is user draft
 * data (persisted locally), not server state. The committed half of the cart
 * (pending cash claims) comes from `GET /api/donor/cart` via React Query.
 */

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

/** One uncommitted cart item. */
export interface LocalCartItem {
  family_id: number;
  includes_groceries: boolean;
}

interface CartContextValue {
  /** The current user's uncommitted cart items (empty when logged out). */
  items: LocalCartItem[];
  /** Add a family to the cart (idempotent per family). */
  addToCart: (familyId: number) => void;
  /** Remove a family from the cart (no-op if absent). */
  removeFromCart: (familyId: number) => void;
  /** Remove several families at once (used after checkout commits them). */
  removeMany: (familyIds: number[]) => void;
  /** Set the groceries add-on on a cart item. */
  setGroceries: (familyId: number, includesGroceries: boolean) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_PREFIX = "kim:cart:";

function isLocalCartItem(value: unknown): value is LocalCartItem {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.family_id === "number" && typeof obj.includes_groceries === "boolean";
}

/** Read + validate one user's cart from localStorage (dedupes per family). */
function readCart(userId: number): LocalCartItem[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
  } catch {
    return [];
  }
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<number>();
  const items: LocalCartItem[] = [];
  for (const entry of parsed) {
    if (!isLocalCartItem(entry) || seen.has(entry.family_id)) continue;
    seen.add(entry.family_id);
    items.push(entry);
  }
  return items;
}

interface CartState {
  /** The user id the loaded items belong to (null = logged out). */
  userId: number | null;
  items: LocalCartItem[];
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // Load on mount and whenever the signed-in user changes, so each account
  // only ever sees its own cart.
  const [cart, setCart] = useState<CartState>(() => {
    const uid = user?.id ?? null;
    return { userId: uid, items: uid != null ? readCart(uid) : [] };
  });

  useEffect(() => {
    setCart({ userId, items: userId != null ? readCart(userId) : [] });
  }, [userId]);

  // Persist whenever the loaded cart changes (always under the user id the
  // items were loaded for, so a user switch can never cross-write).
  useEffect(() => {
    if (cart.userId == null) return;
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${cart.userId}`, JSON.stringify(cart.items));
    } catch {
      // Storage full/unavailable — the cart simply won't persist this session
    }
  }, [cart]);

  const addToCart = (familyId: number): void => {
    setCart((prev) =>
      prev.items.some((i) => i.family_id === familyId)
        ? prev
        : { ...prev, items: [...prev.items, { family_id: familyId, includes_groceries: false }] }
    );
  };

  const removeFromCart = (familyId: number): void => {
    setCart((prev) => ({ ...prev, items: prev.items.filter((i) => i.family_id !== familyId) }));
  };

  const removeMany = (familyIds: number[]): void => {
    const ids = new Set(familyIds);
    setCart((prev) => ({ ...prev, items: prev.items.filter((i) => !ids.has(i.family_id)) }));
  };

  const setGroceries = (familyId: number, includesGroceries: boolean): void => {
    setCart((prev) => ({
      ...prev,
      items: prev.items.map((i) => (i.family_id === familyId ? { ...i, includes_groceries: includesGroceries } : i)),
    }));
  };

  return (
    <CartContext.Provider value={{ items: cart.items, addToCart, removeFromCart, removeMany, setGroceries }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return ctx;
}

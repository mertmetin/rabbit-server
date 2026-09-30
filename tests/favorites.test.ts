import { describe, expect, it } from "vitest";
import { GET as list, POST as add } from "@/app/api/users/[id]/favorites/route";
import { DELETE as remove } from "@/app/api/users/[id]/favorites/[productId]/route";
import { deleteAccount } from "@/lib/account";
import { db } from "@/lib/db";
import { call } from "./helpers";
import { makeCatalog, makeUser } from "./factories";

describe("favourites", () => {
  it("saves favourites, lists them newest first with the store's stock, and removes them", async () => {
    const { centre, apples, baguette } = await makeCatalog();
    const { user, token } = await makeUser();

    expect((await call(add, { token, params: { id: user.id }, body: { product_id: apples.id } })).status).toBe(204);
    await call(add, { token, params: { id: user.id }, body: { product_id: baguette.id } });
    await call(add, { token, params: { id: user.id }, body: { product_id: apples.id } }); // again: no duplicate

    const { body } = await call(list, { method: "GET", token, params: { id: user.id }, query: { store_id: centre.id } });
    expect(body.map((p: { id: number; quantity: number }) => [p.id, p.quantity])).toEqual([
      [baguette.id, 0], // out of stock at Centre
      [apples.id, 20],
    ]);

    await call(remove, { method: "DELETE", token, params: { id: user.id, productId: apples.id } });
    const after = await call(list, { method: "GET", token, params: { id: user.id } });
    expect(after.body).toEqual([expect.objectContaining({ id: baguette.id })]);
    expect(after.body[0]).not.toHaveProperty("quantity");
  });

  it("keeps each customer's favourites to themselves", async () => {
    const { apples } = await makeCatalog();
    const { user } = await makeUser();
    const other = await makeUser();
    expect((await call(add, { token: other.token, params: { id: user.id }, body: { product_id: apples.id } })).status).toBe(403);
    expect((await call(list, { method: "GET", token: other.token, params: { id: user.id } })).status).toBe(403);
  });

  it("404s for a product that doesn't exist", async () => {
    const { user, token } = await makeUser();
    expect((await call(add, { token, params: { id: user.id }, body: { product_id: 999999 } })).status).toBe(404);
  });

  it("clears favourites when an account is deleted", async () => {
    const { apples } = await makeCatalog();
    const { user, token } = await makeUser();
    await call(add, { token, params: { id: user.id }, body: { product_id: apples.id } });
    await deleteAccount(user.id);
    expect(await db.favorite.count({ where: { userId: user.id } })).toBe(0);
  });
});

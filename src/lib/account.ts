import { db } from "./db";

// Deletes a customer's account. Orders are kept for accounting, so a customer
// with order history is anonymised instead: personal details, addresses and
// codes and favourites are removed and the phone number is freed for a future sign-up.
// (Saved cards live on the Stripe customer, which is unlinked here.)
export async function deleteAccount(userId: number) {
  const orders = await db.order.count({ where: { userId } });
  if (orders === 0) {
    await db.user.delete({ where: { id: userId } });
    return;
  }
  await db.$transaction([
    db.userAddress.deleteMany({ where: { userId } }),
    db.verificationCode.deleteMany({ where: { userId } }),
    db.favorite.deleteMany({ where: { userId } }),
    db.paymentMethod.deleteMany({ where: { userId } }),
    db.user.update({
      where: { id: userId },
      data: {
        name: "Deleted customer",
        email: null,
        phone: `deleted-${userId}`,
        passwordHash: null,
        phoneVerifiedAt: null,
        stripeCustomerId: null,
        googleSub: null,
      },
    }),
  ]);
}

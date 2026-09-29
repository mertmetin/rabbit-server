export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const when = (date: Date | null) =>
  date
    ? date.toLocaleString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

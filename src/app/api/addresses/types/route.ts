export function GET() {
  return Response.json([
    { id: 1, type: "home" },
    { id: 2, type: "work" },
    { id: 3, type: "other" },
  ]);
}

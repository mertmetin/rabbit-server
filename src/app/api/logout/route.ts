// Tokens are stateless; the app signs out by deleting its stored token.
export async function POST() {
  return new Response(null, { status: 204 });
}

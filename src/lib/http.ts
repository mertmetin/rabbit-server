import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

// Errors thrown from route handlers become `{ message }` JSON responses,
// which is the shape the app reads (error.response.data.message).
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new ApiError(400, message);
export const unauthorized = (message = "Please sign in.") => new ApiError(401, message);
export const forbidden = () => new ApiError(403, "You don't have access to this.");
export const notFound = (message = "Not found.") => new ApiError(404, message);

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

export function route<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ message: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    const issue = err.issues[0];
    const field = issue.path.join(".");
    return Response.json(
      { message: field ? `${field}: ${issue.message}` : issue.message, issues: err.issues },
      { status: 422 },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const field = JSON.stringify(err.meta ?? {});
    const message = field.includes("email") ? "That email is already used by another account." : "This account is already registered.";
    return Response.json({ message }, { status: 409 });
  }
  console.error(err);
  return Response.json({ message: "Something went wrong." }, { status: 500 });
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be JSON.");
  }
  return schema.parse(body);
}

export async function idParam(ctx: { params: Promise<Record<string, string>> }, name = "id") {
  const value = Number((await ctx.params)[name]);
  if (!Number.isInteger(value) || value <= 0) throw notFound();
  return value;
}

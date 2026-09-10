import { ZodError } from "zod";

/** Thrown anywhere inside a handler; `route()` turns it into a JSON response. */
export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export const unauthorized = (m = "Sign in to continue") => new ApiError(m, 401);
export const forbidden = (m = "You do not have access to this") => new ApiError(m, 403);
export const notFound = (m = "Not found") => new ApiError(m, 404);
export const conflict = (m: string) => new ApiError(m, 409);

/**
 * Two different CORS policies live here.
 *
 * "admin" is the panel: a known origin, allowlisted, and it sends the session
 * cookie, so the allowed origin has to be echoed back exactly — a wildcard is
 * illegal alongside credentials.
 *
 * "quiz" is the member quiz running inside Circle. It carries no cookie, only a
 * uid in the request, and Circle can serve it from more than one surface, so it
 * defaults to a wildcard.
 */
export type CorsMode = "admin" | "quiz";

function allowedOrigins(mode: CorsMode): string[] {
  const raw =
    mode === "quiz"
      ? process.env.QUIZ_ALLOWED_ORIGINS || "*"
      : process.env.ALLOWED_ORIGINS || "*";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(req: Request, mode: CorsMode = "admin"): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = allowedOrigins(mode);
  const wildcard = allowed.includes("*");
  const match = wildcard ? origin || "*" : allowed.includes(origin) ? origin : "";

  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods":
      mode === "quiz" ? "GET,POST,OPTIONS" : "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (match) {
    headers["Access-Control-Allow-Origin"] = match;
    // Credentials cannot be combined with a literal "*".
    if (mode === "admin" && match !== "*") {
      headers["Access-Control-Allow-Credentials"] = "true";
    }
  }
  return headers;
}

type JsonOptions = { headers?: Record<string, string>; cors?: CorsMode };

export function json(req: Request, data: unknown, status = 200, opts: JsonOptions = {}) {
  return Response.json(data, {
    status,
    headers: { ...corsHeaders(req, opts.cors ?? "admin"), ...opts.headers },
  });
}

export function preflight(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req, "admin") });
}

export function quizPreflight(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req, "quiz") });
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/**
 * Wraps a route handler so every failure comes back as JSON with CORS headers
 * instead of an HTML error page.
 */
export function route(handler: Handler, cors: CorsMode = "admin"): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ZodError) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          const key = issue.path.join(".") || "_";
          if (!fieldErrors[key]) fieldErrors[key] = issue.message;
        }
        return json(
          req,
          { error: "Please check the highlighted fields", fieldErrors },
          422,
          { cors },
        );
      }
      if (err instanceof ApiError) {
        return json(req, { error: err.message, details: err.details ?? undefined }, err.status, {
          cors,
        });
      }
      console.error("[api] unhandled", err);
      const message = err instanceof Error ? err.message : "Something went wrong";
      return json(req, { error: message }, 500, { cors });
    }
  };
}

/** Route wrapper for the member quiz endpoints. */
export function quizRoute(handler: Handler): Handler {
  return route(handler, "quiz");
}

/** JSON reply from a member quiz endpoint. */
export function quizJson(req: Request, data: unknown, status = 200) {
  return json(req, data, status, { cors: "quiz" });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError("Expected a JSON body");
  }
}

import { sessionCookie, signSession, verifyPassword } from "@/lib/auth";
import {
  ApiError,
  json,
  preflight,
  readJson,
  route,
  unauthorized,
} from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/schemas";

export const OPTIONS = preflight;

export const POST = route(async (req) => {
  const { email, password } = loginSchema.parse(await readJson(req));

  const user = await prisma.adminUser.findUnique({ where: { email } });

  // Same message either way, so this cannot be used to discover which
  // addresses have accounts.
  const invalid = unauthorized("Email or password is incorrect");
  if (!user || !user.passwordHash) throw invalid;
  if (user.status === "DISABLED")
    throw new ApiError("This account has been disabled", 403);
  if (!(await verifyPassword(password, user.passwordHash))) throw invalid;

  await prisma.adminUser.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      status: user.status === "INVITED" ? "ACTIVE" : user.status,
    },
  });

  const token = await signSession({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  return json(
    req,
    {
      // The token is returned as well so non-browser clients can use a bearer
      // header instead of the cookie.
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
    200,
    { headers: { "Set-Cookie": sessionCookie(req, token) } },
  );
});

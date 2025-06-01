import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

// Add paths that should be accessible without authentication
const publicPaths = ["/login", "/register", "/api/auth", "/api/register"];

const authRedirectPaths = ["/login", "/register"];

const isPublicPath = (path: string) => {
  return publicPaths.some(
    (publicPath) =>
      path === publicPath ||
      path.startsWith(`${publicPath}/`) ||
      path === "/" ||
      path.startsWith("/_next") ||
      path.startsWith("/fonts") ||
      path.startsWith("/favicon") ||
      path.includes(".")
  );
};

export default async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthenticated = !!token;

  if (
    isAuthenticated &&
    authRedirectPaths.some((p) => path === p || path.startsWith(`${p}/`))
  ) {
    return NextResponse.redirect(new URL("/chat", req.url));
  }

  if (isPublicPath(path)) {
    return NextResponse.next();
  }

  // If user is not authenticated and tries to access a protected route
  if (!isAuthenticated) {
    const loginUrl = new URL("/login", req.url);
    // Save the original URL to redirect after login
    loginUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

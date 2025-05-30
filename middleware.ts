import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

// Add paths that should be accessible without authentication
const publicPaths = ["/login", "/register", "/api/auth", "/api/register"];

// Add paths that should be redirected if the user is already authenticated
const authRedirectPaths = ["/login", "/register"];

// Check if a path should be publicly accessible
const isPublicPath = (path: string) => {
  return publicPaths.some(
    (publicPath) =>
      path === publicPath ||
      path.startsWith(`${publicPath}/`) ||
      path === "/" || // Homepage
      path.startsWith("/_next") || // Next.js resources
      path.startsWith("/fonts") || // Fonts
      path.startsWith("/favicon") || // Favicon
      path.includes(".") // Static files like images, CSS, etc.
  );
};

export default async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Get session token
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthenticated = !!token;

  // If the user is logged in and tries to access login/register, redirect to dashboard
  if (
    isAuthenticated &&
    authRedirectPaths.some((p) => path === p || path.startsWith(`${p}/`))
  ) {
    return NextResponse.redirect(new URL("/chat", req.url));
  }

  // If the path is public, allow access
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

  // Proceed for authenticated users
  return NextResponse.next();
}

// Configure matcher for which routes this middleware applies to
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

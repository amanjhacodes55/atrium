import { NextResponse, type NextRequest } from "next/server";
import { COOKIE } from "@/lib/auth-cookie";

// An optimistic check only: app pages redirect to sign-in when there is no session cookie. Every
// API route checks the session itself.
export function proxy(request: NextRequest) {
  if (request.cookies.get(COOKIE)?.value) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/home", "/drive", "/account", "/docs/:path*", "/sheets/:path*", "/slides/:path*", "/notebook/:path*", "/pdf", "/pdf/:path*"],
};

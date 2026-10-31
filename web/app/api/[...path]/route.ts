import { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ path: string[] }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, { params }: RouteContext): Promise<Response> {
  const backendUrl = process.env.BACKEND_URL
    ?? (process.env.NODE_ENV === "development" ? "http://localhost:8010" : undefined);
  if (!backendUrl) {
    return Response.json({ error: "The backend service binding is not configured." }, { status: 503 });
  }

  const { path } = await params;
  const baseUrl = backendUrl.endsWith("/") ? backendUrl : `${backendUrl}/`;
  const target = new URL(path.map(encodeURIComponent).join("/"), baseUrl);
  target.search = request.nextUrl.search;

  const contentType = request.headers.get("content-type");
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.arrayBuffer();
  const upstream = await fetch(target, {
    method: request.method,
    headers: contentType ? { "content-type": contentType } : undefined,
    body,
    cache: "no-store",
  });
  const responseHeaders = new Headers();
  const responseContentType = upstream.headers.get("content-type");
  if (responseContentType) responseHeaders.set("content-type", responseContentType);
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;

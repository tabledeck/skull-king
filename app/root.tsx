import {
  isRouteErrorResponse,
  Links,
  Meta,
  type MiddlewareFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";
import { useEffect } from "react";
import { getToast } from "remix-toast";
import { toast as notify, ToastContainer } from "react-toastify";
import toastStyles from "react-toastify/ReactToastify.css?url";
import styles from "./app.css?url";
import type { Route } from "./+types/root";
import {
  globalStorageMiddleware,
  userContext,
} from "~/domain/utils/global-context.server";

export const middleware: MiddlewareFunction<Response>[] = [
  globalStorageMiddleware,
];

export const meta: Route.MetaFunction = () => [
  { title: "Skull King" },
  { name: "description", content: "Play Skull King online with friends" },
];

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,500&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;700&family=Caveat:wght@500;600&display=swap",
  },
  { rel: "stylesheet", href: styles },
  { rel: "stylesheet", href: toastStyles },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = context.get(userContext) ?? null;
  const { toast, headers } = await getToast(request);
  return { toast, user } as const;
}

export function ErrorBoundary() {
  const error = useRouteError();

  let title = "Something went wrong";
  let message = "An unexpected error occurred.";
  let statusCode: number | null = null;

  if (isRouteErrorResponse(error)) {
    statusCode = error.status;
    if (error.status === 404) {
      title = "Page Not Found";
      message = "The page you're looking for doesn't exist.";
    } else {
      message = error.statusText || message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <html lang="en" data-theme="skull-king">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Error — Skull King</title>
        <Meta />
        <Links />
      </head>
      <body className="td-table min-h-screen font-sans flex flex-col items-center justify-center p-4">
        {statusCode && (
          <p className="text-gold-hi font-mono text-6xl font-bold mb-2">{statusCode}</p>
        )}
        <h1 className="font-serif text-parchment text-2xl font-semibold mb-3">{title}</h1>
        <p className="text-parchment/60 mb-6 text-center max-w-sm font-sans">{message}</p>
        <a href="/" className="td-btn-primary">
          Go Home
        </a>
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const { toast } = loaderData;

  useEffect(() => {
    if (toast) {
      notify(toast.message, { type: toast.type, theme: "dark" });
    }
  }, [toast]);

  return (
    <html lang="en" data-theme="skull-king">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="td-table min-h-screen font-sans">
        <ToastContainer />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

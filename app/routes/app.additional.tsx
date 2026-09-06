/*
 * Retired scaffold route — no UI. Kept only as a bookmark-safe redirect;
 * physically delete this file to remove the route entirely (fs-routes
 * regenerates automatically):
 *   Remove-Item app\routes\app.additional.tsx
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export const loader = async ({}: LoaderFunctionArgs) => redirect("/app");

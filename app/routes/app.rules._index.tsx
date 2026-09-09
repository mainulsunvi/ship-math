/*
 * /app/rules — bookmark/nav-safe redirect (005 rules-on-routes review
 * REQUIRED finding): the Rules tab targets /app/rules, but rules live on
 * /app/rules/new and /app/rules/:uid/edit — there is no rules index page
 * because the dashboard (/app) IS the rules table. Redirect instead of 404.
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export const loader = async ({}: LoaderFunctionArgs) => redirect("/app");

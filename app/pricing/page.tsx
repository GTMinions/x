/**
 * `/pricing` kept as a redirect.
 *
 * The landing page moved to `/get-started`, which is what the header calls it
 * and what it actually does. This URL stays because it is the obvious guess, it
 * is what anything already pointing here uses, and a 404 on a price page is the
 * worst possible answer to somebody trying to give you money.
 */
import { redirect } from "next/navigation";

export default function Pricing() {
  redirect("/get-started");
}

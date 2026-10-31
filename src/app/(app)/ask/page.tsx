import { redirect } from "next/navigation";

// "Ask AI" is now Ask Ally.
export default async function AskPage({ searchParams }: PageProps<"/ask">) {
  const sp = await searchParams;
  redirect(typeof sp.course === "string" ? `/ally?course=${sp.course}` : "/ally");
}

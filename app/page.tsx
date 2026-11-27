import { redirect } from "next/navigation";
import { currentUser, isSwitchedOff } from "@/lib/auth";

export default async function Home() {
  const u = await currentUser();
  if (!u || isSwitchedOff(u)) redirect("/login");
  redirect(u.role === "admin" ? "/dashboard" : "/expenses");
}

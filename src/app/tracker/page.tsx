import { redirect } from "next/navigation";

export default function TrackerRoutePage() {
  redirect("/?tracker=1");
}

import { notFound } from "next/navigation";
import { CAMPAIGNS, findCampaign } from "@/campaign";
import CampaignView from "./CampaignView";

/** One page per campaign that exists (nothing else is served). */
export function generateStaticParams() {
  return CAMPAIGNS.map((c) => ({ campaign: c.id }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ campaign: string }> }) {
  const c = findCampaign((await params).campaign);
  return { title: c ? `${c.title} – OUTBREAK` : "Campaign – OUTBREAK" };
}

export default async function Page({ params }: { params: Promise<{ campaign: string }> }) {
  const { campaign } = await params;
  if (!findCampaign(campaign)) notFound();
  return <CampaignView id={campaign} />;
}

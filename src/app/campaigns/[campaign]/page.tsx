import { notFound } from "next/navigation";
import { CAMPAIGNS, findCampaign, findStory, STORIES } from "@/campaign";
import CampaignView from "./CampaignView";
import StoryView from "./StoryView";

/** One page per story (its chapters) and one per playable chapter (its missions); nothing else is served. */
export function generateStaticParams() {
  return [...STORIES.map((s) => ({ campaign: s.id })), ...CAMPAIGNS.map((c) => ({ campaign: c.id }))];
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ campaign: string }> }) {
  const id = (await params).campaign;
  const title = findStory(id)?.title ?? findCampaign(id)?.title;
  return { title: title ? `${title} – OUTBREAK` : "Campaign – OUTBREAK" };
}

export default async function Page({ params }: { params: Promise<{ campaign: string }> }) {
  const { campaign } = await params;
  if (findStory(campaign)) return <StoryView id={campaign} />;
  if (!findCampaign(campaign)) notFound();
  return <CampaignView id={campaign} />;
}

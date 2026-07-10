import { getProfileForName, type ResearchProfile } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";

export const profileForHandle = (
  profiles: Record<string, ResearchProfile>,
  handleOrName?: string
) => {
  if (!handleOrName) return null;
  const normalized = cleanHandle(handleOrName);
  return (
    profiles[normalized] ??
    Object.values(profiles).find(
      (person) => person.handle === normalized || person.name === handleOrName
    ) ??
    getProfileForName(handleOrName)
  );
};

export const profileInitials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

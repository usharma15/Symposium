import type { ResearchProfile } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";

export const publicResearchProfile = (person: ResearchProfile): ResearchProfile => {
  const { email: _email, ...publicPerson } = person;
  return publicPerson;
};

export const searchPublicProfileEntries = <Profile extends { name: string }>(
  profiles: Record<string, Profile>,
  query: string,
  limit: number
) => {
  const normalizedQuery = query.toLocaleLowerCase().replace(/^@/, "");
  const score = (handle: string, name: string) => handle === normalizedQuery ? 0
    : name === normalizedQuery ? 1
      : handle.startsWith(normalizedQuery) ? 2
        : name.startsWith(normalizedQuery) ? 3
          : 4;
  return Object.entries(profiles)
    .filter(([handle, person]) => !normalizedQuery
      || cleanHandle(handle).toLocaleLowerCase().includes(normalizedQuery)
      || person.name.toLocaleLowerCase().includes(normalizedQuery))
    .sort(([leftHandle, left], [rightHandle, right]) => {
      if (!normalizedQuery) return 0;
      const leftCleanHandle = cleanHandle(leftHandle).toLocaleLowerCase();
      const rightCleanHandle = cleanHandle(rightHandle).toLocaleLowerCase();
      return score(leftCleanHandle, left.name.toLocaleLowerCase())
        - score(rightCleanHandle, right.name.toLocaleLowerCase())
        || left.name.localeCompare(right.name)
        || leftCleanHandle.localeCompare(rightCleanHandle);
    })
    .slice(0, limit);
};

import type { ResearchProfile } from "@/lib/mockData";

export const publicResearchProfile = (person: ResearchProfile): ResearchProfile => {
  const { email: _email, ...publicPerson } = person;
  return publicPerson;
};

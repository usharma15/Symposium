import type { ResearchCommunityContract } from "@/packages/contracts/src";

const community = (value: ResearchCommunityContract): ResearchCommunityContract => value;

export const historicalCommunities: ResearchCommunityContract[] = [
  community({
    id: "quantum-foundations",
    name: "Quantum Foundations",
    field: "Physics",
    summary: "Locality, measurement, observables, paths, experiments, and the parts of quantum theory that predictive success did not make philosophically trivial.",
    visibility: "public",
    online: 5,
    memberHandles: ["@john_bell", "@einstein", "@heisenberg", "@feynman", "@lise_meitner", "@otto_frisch", "@marie_curie", "@newton"],
    keywords: ["quantum mechanics", "locality", "measurement", "experiments", "foundations"],
    seedCounts: { papers: 4, thoughts: 11, opportunities: 1 },
    callStatus: "voice live",
    ownerHandle: "@john_bell",
    moderatorHandles: ["@john_bell", "@lise_meitner"],
    guidelines: "State the assumption before defending the interpretation. Distinguish a theorem, an experimental result, and a metaphysical preference. When a simplification breaks, show exactly where.",
    announcements: [{
      id: "quantum-foundations-bell-reading",
      title: "Bell reading table is open",
      body: "Bring one precise account of locality and one experimental design that could distinguish the alternatives. Interpretive slogans will be returned unopened.",
      authorHandle: "@john_bell",
      createdAt: "2026-07-20T12:15:00.000Z"
    }]
  }),
  community({
    id: "mathematics-logic-games",
    name: "Mathematics, Logic, and Games",
    field: "Mathematics",
    summary: "Formal systems, proof, equilibrium, analysis, notation, and the recurring human temptation to claim more for a theorem than the theorem claimed for itself.",
    visibility: "public",
    online: 4,
    memberHandles: ["@godel", "@john_nash", "@euler", "@newton", "@feynman", "@keynes", "@plato"],
    keywords: ["logic", "proof", "equilibrium", "analysis", "formal systems"],
    seedCounts: { papers: 2, thoughts: 9, opportunities: 1 },
    callStatus: "quiet",
    ownerHandle: "@euler",
    moderatorHandles: ["@euler", "@godel"],
    guidelines: "Do not substitute intimidation for a proof. Give the smallest example that preserves the difficulty. Separate existence, construction, computation, and interpretation."
  }),
  community({
    id: "mind-memory-life",
    name: "Mind, Memory, and Life",
    field: "Biology and philosophy of mind",
    summary: "Memory, sleep, dreams, heredity, biological form, evolution, and the contested journey from structure to explanation.",
    visibility: "public",
    online: 6,
    memberHandles: ["@aristotle", "@darwin", "@rosalind_franklin", "@francis_crick", "@james_watson", "@dostoevsky", "@socrates"],
    keywords: ["memory", "dreams", "DNA", "evolution", "mind"],
    seedCounts: { papers: 5, thoughts: 12, opportunities: 1 },
    callStatus: "video live",
    ownerHandle: "@aristotle",
    moderatorHandles: ["@aristotle", "@rosalind_franklin", "@darwin"],
    guidelines: "Keep levels of explanation visible. A molecular structure is not automatically a theory of memory; an introspective distinction is not automatically a mechanism. Credit the observation before narrating the discovery."
  }),
  community({
    id: "polis-strategy",
    name: "The Polis and Strategy",
    field: "Politics, institutions, and strategy",
    summary: "Political order, leadership, war, civic education, legitimacy, rhetoric, administration, and what survives after a brilliant victory.",
    visibility: "public",
    online: 7,
    memberHandles: ["@plato", "@socrates", "@machiavelli", "@julius_caesar", "@napoleon", "@alcibiades", "@ben_franklin", "@adam_smith", "@keynes"],
    keywords: ["politics", "strategy", "institutions", "leadership", "civic life"],
    seedCounts: { papers: 2, thoughts: 15, opportunities: 0 },
    callStatus: "voice live",
    ownerHandle: "@plato",
    moderatorHandles: ["@plato", "@ben_franklin", "@machiavelli"],
    guidelines: "Name the constituency, the office, the incentive, and the cost. A strategy without logistics is a mood; a constitution without character and enforcement is stationery."
  }),
  community({
    id: "political-economy-industry",
    name: "Political Economy and Industry",
    field: "Economics, institutions, and patronage",
    summary: "Markets, employment, industry, public goods, research finance, labour, philanthropy, and the difference between building capacity and purchasing admiration.",
    visibility: "public",
    online: 5,
    memberHandles: ["@adam_smith", "@keynes", "@andrew_carnegie", "@ben_franklin", "@john_nash", "@machiavelli", "@marie_curie"],
    keywords: ["political economy", "industry", "employment", "patronage", "public goods"],
    seedCounts: { papers: 0, thoughts: 12, opportunities: 1 },
    callStatus: "quiet",
    ownerHandle: "@adam_smith",
    moderatorHandles: ["@adam_smith", "@keynes"],
    guidelines: "Separate price, value, power, and legitimacy. Funding proposals must name control, milestones, failure reporting, and who owns the resulting public good."
  }),
  community({
    id: "poetry-drama-meaning",
    name: "Poetry, Drama, and Meaning",
    field: "Literature, philosophy, and culture",
    summary: "Epic, tragedy, comedy, moral psychology, exile, technology, and the knowledge that only becomes visible when an argument acquires a voice and a consequence.",
    visibility: "public",
    online: 6,
    memberHandles: ["@homer", "@virgil", "@shakespeare", "@dostoevsky", "@nietzsche", "@heidegger", "@plato", "@diogenes", "@alcibiades"],
    keywords: ["poetry", "drama", "tragedy", "meaning", "culture"],
    seedCounts: { papers: 3, thoughts: 14, opportunities: 0 },
    callStatus: "video live",
    ownerHandle: "@shakespeare",
    moderatorHandles: ["@shakespeare", "@virgil"],
    guidelines: "Quote accurately. Do not flatten a character into the position they temporarily speak. Jokes are welcome; applause is not an argument."
  }),
  community({
    id: "science-rebirth-commons",
    name: "Science Rebirth Commons",
    field: "Research institutions and open inquiry",
    summary: "A cross-disciplinary public room for research institutions, open editions, replication, patronage, opportunities, education, and the practical architecture of serious inquiry.",
    visibility: "public",
    online: 8,
    memberHandles: ["@ben_franklin", "@lise_meitner", "@marie_curie", "@einstein", "@feynman", "@rosalind_franklin", "@andrew_carnegie", "@adam_smith", "@keynes", "@plato", "@aristotle", "@darwin", "@euler"],
    keywords: ["metascience", "research institutions", "education", "open knowledge", "patronage"],
    seedCounts: { papers: 0, thoughts: 10, opportunities: 3 },
    callStatus: "voice live",
    ownerHandle: "@ben_franklin",
    moderatorHandles: ["@ben_franklin", "@lise_meitner", "@marie_curie"],
    guidelines: "Attach criticism to an artifact. Preserve failed routes. Make budgets and authority legible. A proposal should say what changes if it succeeds and what remains public if it fails."
  })
];

import {
  Amphora,
  Archive,
  BookOpen,
  BrainCircuit,
  Columns3,
  LibraryBig,
  MessagesSquare,
  ScrollText,
  Sparkles
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type RoomId =
  | "hall"
  | "office"
  | "symposium"
  | "library"
  | "amphitheater"
  | "funding"
  | "communities"
  | "opportunities";
export type FeedScope = "suggested" | "following" | "rooms";
export type ContentKind = "paper" | "thought" | "draft" | "note" | "code";

export type InquiryComment = {
  id?: string;
  parentId?: string | null;
  author: string;
  authorHandle?: string;
  body: string;
  stance: string;
  createdAt?: string;
  replies?: InquiryComment[];
};

export type InquiryMetrics = {
  signal: string;
  critiques: string;
  forks: string;
  saves: string;
  reads: string;
};

export type InquiryItem = {
  id: string;
  kind: ContentKind;
  room: Exclude<RoomId, "hall">;
  title: string;
  author: string;
  authorHandle?: string;
  affiliation: string;
  date: string;
  createdAt?: string;
  status: string;
  metrics: InquiryMetrics;
  gatheringReason: string;
  excerpt: string;
  body: string;
  tags: string[];
  signals: {
    label: string;
    value: string;
  }[];
  claims: string[];
  objections: string[];
  evidence: string[];
  tests: string[];
  forks: string[];
  comments: InquiryComment[];
  saved?: boolean;
  savedBy?: string[];
  signaledBy?: string[];
  forkedBy?: string[];
};

export type Room = {
  id: RoomId;
  name: string;
  shortName: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  feedLabel: string;
  location: string;
  ambient: string;
  includes: ContentKind[];
};

export type ResearchProfile = {
  name: string;
  handle: string;
  email?: string;
  avatarUrl?: string;
  likesPublic?: boolean;
  resharesPublic?: boolean;
  role: string;
  location: string;
  bio: string;
  fields: string[];
};

export type ResearchCommunity = {
  id: string;
  name: string;
  field: string;
  summary: string;
  visibility: "public" | "private";
  online: number;
  memberHandles: string[];
  keywords: string[];
  seedCounts: {
    papers: number;
    thoughts: number;
    opportunities: number;
  };
  callStatus: "quiet" | "voice live" | "video live";
};

export const rooms: Room[] = [
  {
    id: "hall",
    name: "Main Hall",
    shortName: "Hall",
    icon: Columns3,
    eyebrow: "Interior threshold",
    title: "The hall before the rooms.",
    description:
      "A navigable interior: office to the left, amphitheater farther down, library up the short stair, and the public Symposium room on the right.",
    feedLabel: "Wayfinding",
    location: "Main hall",
    ambient: "Footsteps, marble, low voices, sea light through the doors",
    includes: ["paper", "thought"]
  },
  {
    id: "office",
    name: "Office",
    shortName: "Office",
    icon: Archive,
    eyebrow: "Independent review room",
    title: "Saved work, drafts, notebooks, code.",
    description:
      "Your private desk: saved papers, half-built arguments, technical fragments, and things worth returning to.",
    feedLabel: "Saved for later",
    location: "Left of the main hall",
    ambient: "Low desk light over marble and paper",
    includes: ["paper", "thought", "draft", "note", "code"]
  },
  {
    id: "symposium",
    name: "Symposium",
    shortName: "Hall",
    icon: MessagesSquare,
    eyebrow: "Joint inquiry hall",
    title: "Papers and thoughts in the same room.",
    description:
      "The public hall where claims gather objections, papers gather forks, and rooms form around live questions.",
    feedLabel: "Mixed feed",
    location: "Right side of the hall",
    ambient: "Voices, tablets, chalk, arguments",
    includes: ["paper", "thought"]
  },
  {
    id: "library",
    name: "Library",
    shortName: "Library",
    icon: LibraryBig,
    eyebrow: "Focused research",
    title: "Papers only. Reading tables. Slow attention.",
    description:
      "A cleaner feed for research artifacts: papers, methods, replications, negative results, and field maps.",
    feedLabel: "Paper shelves",
    location: "Upper floor",
    ambient: "Quiet light, stacked shelves, private tables",
    includes: ["paper"]
  },
  {
    id: "amphitheater",
    name: "Amphitheater",
    shortName: "Thoughts",
    icon: Amphora,
    eyebrow: "Thoughts only",
    title: "Raw claims, objections, quote-posted papers.",
    description:
      "The rougher public ring for thoughts: strong claims, smell tests, analogies, objections, and questions.",
    feedLabel: "Thought ring",
    location: "Under the library stair",
    ambient: "Stone benches, live argument, quick notes",
    includes: ["thought", "note"]
  },
  {
    id: "funding",
    name: "Patronage",
    shortName: "Patronage",
    icon: Sparkles,
    eyebrow: "Civic and private backing",
    title: "Support serious work before it looks obvious.",
    description:
      "Civic backing, bounties, donations, grants, investors, family offices, and patronage routes for live research work.",
    feedLabel: "Patronage desk",
    location: "Left under the library stair",
    ambient: "Quiet negotiations, budgets, small tables, practical pressure",
    includes: ["paper", "thought", "draft", "note"]
  },
  {
    id: "communities",
    name: "Communities",
    shortName: "Communities",
    icon: MessagesSquare,
    eyebrow: "Campus threshold",
    title: "Find the groups around shared work.",
    description:
      "A gateway to communities, calls, events, reading rooms, and live clusters without turning every group into a physical room.",
    feedLabel: "Community paths",
    location: "Right under the library stair",
    ambient: "Garden path, moving groups, live invitations",
    includes: ["paper", "thought", "draft", "note"]
  },
  {
    id: "opportunities",
    name: "Opportunities",
    shortName: "Calls",
    icon: ScrollText,
    eyebrow: "Open calls and roles",
    title: "Places to join, build, fund, or test.",
    description:
      "Calls for collaborators, fellowships, events, open problems, internships, grants, and practical next steps.",
    feedLabel: "Opportunity board",
    location: "Right wall notice board",
    ambient: "Pinned notices, deadline cards, public invitations",
    includes: ["paper", "thought", "draft", "note"]
  }
];

export const feedScopes: { id: FeedScope; label: string }[] = [
  { id: "suggested", label: "For you" },
  { id: "following", label: "Following" },
  { id: "rooms", label: "Rooms" }
];

export const roomChips = [
  "Frontier Physics",
  "AI Metascience",
  "Rogue Youth Labs",
  "History Of Discovery",
  "Tools And Instruments",
  "Patronage",
  "Communities",
  "Opportunities"
];

export const libraryFolders = [
  { label: "All saved", count: 18, icon: BookOpen },
  { label: "Needs experiment", count: 6, icon: BrainCircuit },
  { label: "Lineage maps", count: 4, icon: ScrollText },
  { label: "Draft fuel", count: 7, icon: Sparkles }
];

export const profile = {
  name: "Udayan Sharma",
  handle: "@udayan",
  role: "Independent researcher",
  location: "Science Rebirth",
  bio:
    "Building Science Rebirth and Symposium as a living public structure for serious inquiry, objections, forks, and proof-of-work.",
  fields: ["Metascience", "Physics", "AI for science", "Institution design"]
} satisfies ResearchProfile;

const generatedNames = [
  "Anika Rao",
  "Jonas Vale",
  "Priya Menon",
  "Theo Marwick",
  "Lina Ortega",
  "Samir Haddad",
  "Maeve Chen",
  "Tomasz Zielinski",
  "Aya Nakamura",
  "Iris Okafor",
  "Felix Moreau",
  "Noor Al-Khatib",
  "Helena Park",
  "Cassian Reed",
  "Mina Farouk",
  "Dario Silva",
  "Keiko Tan",
  "Ruth Bell",
  "Owen Markham",
  "Salma Idris",
  "Vikram Bedi",
  "Sofia Klein",
  "Eli Navarro",
  "Nadia Petrov",
  "Yara Mensah",
  "Arun Sen",
  "Clara Weiss",
  "Mateo Ibarra",
  "Talia Finch",
  "Reza Mahdavi",
  "June Park",
  "Omar Nasser",
  "Greta Holm",
  "Niko Varga",
  "Imani Brooks",
  "Petra Novak",
  "Soren Li",
  "Asha Verma",
  "Milo Hart",
  "Farah Qureshi",
  "Leona Brandt",
  "Kenji Mori",
  "Mara Ellis",
  "Basil Khan",
  "Tessa Laurent",
  "Hugo Stein",
  "Rina Campos",
  "Idris Bellamy",
  "Vera Novak",
  "Kian Shah",
  "Ada Sterling",
  "Bram Okoye",
  "Cleo Varma",
  "Dima Rosen",
  "Etta Malik",
  "Finn Calder",
  "Gia Moretti",
  "Hari Collins",
  "Ines Duarte",
  "Jalen Brooks",
  "Kaia Stern",
  "Luca Fontaine",
  "Maya Solberg",
  "Noemi Hart",
  "Orion Patel",
  "Pia Anders",
  "Quinn Reyes",
  "Rafi Delacroix",
  "Sana Morel",
  "Tobin Yates",
  "Una Farrow",
  "Valen Cho",
  "Willa Greaves",
  "Xavi Laurent",
  "Yuki Adler",
  "Zara Bell",
  "Ari Kwon",
  "Bianca Neri",
  "Cato Ivers",
  "Dalia Faris",
  "Emre Novak",
  "Freya Stone",
  "Galen Moss",
  "Hana Pierce",
  "Ilya Ford",
  "Juno West",
  "Kira Sol",
  "Leif Moreno",
  "Mira Elian",
  "Nolan Reyes",
  "Oona Keller",
  "Pavel Idris",
  "Rhea Sands",
  "Silas Vale",
  "Tara Quinn",
  "Uri Campos",
  "Veda Lin",
  "Wren Hollis",
  "Yasmin Reed",
  "Zev Marin"
];

const generatedRoles = [
  "Replication organizer",
  "Independent physics reader",
  "Metascience analyst",
  "Instrument builder",
  "History of discovery researcher",
  "AI evaluation designer",
  "Field-note editor",
  "Methods critic",
  "Simulation engineer",
  "Youth-lab mentor"
];

const generatedLocations = [
  "Library table",
  "Amphitheater bench",
  "Symposium floor",
  "Independent review desk",
  "Rogue youth lab notes",
  "Field methods room",
  "Patronage hall",
  "Community path",
  "Opportunity board"
];

const generatedFieldSets = [
  ["Replication", "Methods", "Negative results"],
  ["Frontier physics", "Toy worlds", "Instrumentation"],
  ["AI metascience", "Benchmarks", "Critique"],
  ["History of discovery", "Anomalies", "Institutions"],
  ["Youth labs", "Proof-of-work", "Mentorship"],
  ["Product systems", "Dialogue", "Research UX"],
  ["Patronage", "Budgets", "Backers"],
  ["Communities", "Events", "Calls"],
  ["Opportunities", "Open problems", "Roles"]
];

const handleFor = (name: string) =>
  `@${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

const generatedPublicProfiles: ResearchProfile[] = generatedNames.map((name, index) => ({
  name,
  handle: handleFor(name),
  likesPublic: index % 5 !== 0,
  resharesPublic: index % 4 !== 0,
  role: generatedRoles[index % generatedRoles.length],
  location: generatedLocations[index % generatedLocations.length],
  bio:
    "A public seed profile used to make Symposium feel live: reading, saving, critiquing, and forking work across the early rooms.",
  fields: generatedFieldSets[index % generatedFieldSets.length]
}));

const generatedProfilesByName = Object.fromEntries(
  generatedPublicProfiles.map((person) => [person.name, person])
) as Record<string, ResearchProfile>;

export const profilesByName: Record<string, ResearchProfile> = {
  [profile.name]: profile,
  "Mira Sato": {
    name: "Mira Sato",
    handle: "@mira_sato",
    role: "Benchmark designer",
    location: "Metascience Working Notes",
    bio:
      "Designs blind rediscovery tasks and critique protocols for AI-assisted scientific exploration.",
    fields: ["AI agents", "Metascience", "Benchmarks", "Epistemology"]
  },
  "Elena Voss": {
    name: "Elena Voss",
    handle: "@e_voss",
    role: "Historian of discovery",
    location: "History of Discovery",
    bio:
      "Studies anomaly survival, prepared minds, and the institutional conditions that let strange results stay alive.",
    fields: ["History of science", "Institutions", "Anomalies", "Discovery"]
  },
  "Leah K.": {
    name: "Leah K.",
    handle: "@leahk",
    role: "Critic-engine researcher",
    location: "Independent review room",
    bio: "Works on critique architectures, failure modes, and review systems for live inquiry.",
    fields: ["Critique", "Evaluation", "AI systems", "Review"]
  },
  "N. Arvind": {
    name: "N. Arvind",
    handle: "@narvind",
    role: "Methods skeptic",
    location: "Library upper floor",
    bio: "Focuses on leakage, denominator problems, and whether beautiful protocols survive contact with reality.",
    fields: ["Methods", "Statistics", "Replication", "Benchmarks"]
  },
  Amara: {
    name: "Amara",
    handle: "@amara",
    role: "Product theorist",
    location: "Symposium room",
    bio: "Explores how public interfaces can show the motion of an idea without flattening it into popularity.",
    fields: ["Product", "Dialogue", "Lineage", "Status"]
  },
  Jules: {
    name: "Jules",
    handle: "@jules",
    role: "Interaction designer",
    location: "Main hall",
    bio: "Designs serious tools that keep structure without becoming dead administrative software.",
    fields: ["Interaction design", "Tools", "Research UX", "Worldbuilding"]
  },
  "Rahul M.": {
    name: "Rahul M.",
    handle: "@rahulm",
    role: "Historical methods critic",
    location: "Library tables",
    bio: "Keeps discovery stories honest by asking where the failures, denominators, and counterexamples went.",
    fields: ["History", "Methods", "Failure archives", "Institutions"]
  },
  "Celia Noor": {
    name: "Celia Noor",
    handle: "@celianoor",
    role: "Research systems analyst",
    location: "Amphitheater",
    bio: "Studies apparatus, specialization, and why some kinds of ambition are expensive before they are unfashionable.",
    fields: ["Research systems", "Specialization", "Infrastructure", "Ambition"]
  },
  "M. Iqbal": {
    name: "M. Iqbal",
    handle: "@miqbal",
    role: "Institution builder",
    location: "Rogue youth labs",
    bio: "Works on practical conditions where talented young researchers can build artifacts instead of waiting for permission.",
    fields: ["Youth labs", "Institution design", "Proof-of-work", "Mentorship"]
  },
  "AI tablet": {
    name: "AI tablet",
    handle: "@symposium_tablet",
    role: "Site assistant",
    location: "Every room",
    bio:
      "A contextual assistant that helps readers find objections, next tests, forks, and saved work inside the current room.",
    fields: ["Assistance", "Search", "Critique", "Synthesis"]
  },
  Self: profile,
  ...generatedProfilesByName
};

export const getProfileForName = (name: string): ResearchProfile =>
  profilesByName[name] ?? {
    name,
    handle: `@${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    role: "Symposium participant",
    location: "Public rooms",
    bio: "A participant in the current inquiry thread.",
    fields: ["Inquiry", "Critique", "Discussion"]
  };

const coreInquiryItems: InquiryItem[] = [
  {
    id: "cheap-exploration",
    kind: "paper",
    room: "library",
    title: "Cheap exploration, expensive truth",
    author: "Mira Sato",
    affiliation: "Metascience Working Notes",
    date: "Today",
    status: "Needs Experiment",
    metrics: { signal: "412", critiques: "4", forks: "58", saves: "129", reads: "18.4k" },
    gatheringReason:
      "People are here because the claim is useful but dangerous: AI can search broadly, but truth still has to be paid for.",
    excerpt:
      "A benchmark proposal for turning AI-assisted exploration into test-bearing inquiry instead of research-shaped noise.",
    body:
      "The paper argues that AI lowers the cost of search, synthesis, coding, and hypothesis generation, but it does not lower the cost of reality-contact. The proposed system compares process designs: broad exploration alone, broad exploration with independent critique, narrow search with frequent feedback, and source-packet-only reasoning. The point is not to crown a winner. The point is to measure which process actually recovers hidden laws under blind tests.",
    tags: ["AI agents", "metascience", "rediscovery", "truth cost"],
    signals: [
      { label: "Open objections", value: "3" },
      { label: "Test designs", value: "2 pending" },
      { label: "Forks", value: "5" },
      { label: "Evidence state", value: "Protocol stage" }
    ],
    claims: [
      "Broad exploration improves rediscovery only when paired with independent critique.",
      "Output volume is a bad proxy for discovery quality.",
      "Held-out predictive accuracy should matter more than plausible prose."
    ],
    objections: [
      "The benchmark may reward puzzle-solving instead of real scientific taste.",
      "If the hidden law is designed by humans, agents may learn benchmark texture rather than inquiry.",
      "Critique architecture could become another metric target."
    ],
    evidence: [
      "Toy-world rediscovery tasks with hidden nonlinear terms.",
      "Prior failures of unconstrained agent brainstorming.",
      "Historical cases where broad search mattered only after anomalies survived criticism."
    ],
    tests: [
      "Run search breadth x critique architecture on the same hidden-law worlds.",
      "Score law recovery, held-out prediction, experiment efficiency, and leakage.",
      "Add adversarial source packets to test whether agents invent unsupported mechanisms."
    ],
    forks: [
      "Synthetic physical worlds",
      "Critic-agent panel design",
      "Human vs AI taste comparison"
    ],
    comments: [
      {
        author: "Leah K.",
        stance: "Endorsement with reason",
        body:
          "This is the first version that makes the cheap-exploration point measurable instead of rhetorical.",
        replies: [
          {
            author: "Mira Sato",
            stance: "Author reply",
            body:
              "Yes. I want the benchmark to punish impressive search that never earns contact with held-out reality."
          }
        ]
      },
      {
        author: "N. Arvind",
        stance: "Strong objection",
        body:
          "The benchmark needs a leakage penalty from the start or every result will look cleaner than it is.",
        replies: [
          {
            author: "Leah K.",
            stance: "Follow-up",
            body:
              "Agreed. I would add an adversarial source packet and score unsupported mechanism invention separately."
          }
        ]
      }
    ],
    saved: true
  },
  {
    id: "dialogue-object",
    kind: "thought",
    room: "symposium",
    title: "A Dialogue is not a post with comments",
    author: "Udayan Sharma",
    affiliation: "Symposium product notebook",
    date: "Yesterday",
    status: "Core Shape",
    metrics: { signal: "771", critiques: "3", forks: "146", saves: "244", reads: "31.9k" },
    gatheringReason:
      "People are here because a normal feed will collapse Symposium into another academic social network.",
    excerpt:
      "A real Dialogue needs claims, objections, evidence, tests, forks, unresolved status, and visible lineage.",
    body:
      "A post collects attention. A Dialogue should show whether an idea is moving. It should expose what is claimed, what has been challenged, what would change minds, what has been tested, and what new work has forked out of it. The UI should make a reader feel that inquiry is a living structure, not a comment section wearing robes.",
    tags: ["dialogue", "lineage", "product", "anti-metric"],
    signals: [
      { label: "Open objections", value: "2" },
      { label: "Forks", value: "4" },
      { label: "Status changes", value: "New -> Contested" },
      { label: "Next action", value: "Detail prototype" }
    ],
    claims: [
      "Comments are too flat for serious inquiry.",
      "Status labels are better than popularity scores.",
      "A Dialogue should preserve failed attempts as part of its memory."
    ],
    objections: [
      "Too much structure may make casual participation feel heavy.",
      "A Dialogue object could become bureaucratic if every claim needs a form."
    ],
    evidence: [
      "ResearchGate, Reddit, and X all privilege attention over lineage.",
      "Scientific work often depends on tacit objection history that is hard to reconstruct."
    ],
    tests: [
      "Prototype a detail page with claims, objections, tests, and forks visible at once.",
      "Watch whether users can tell why people are gathered without reading every comment."
    ],
    forks: [
      "Objection-first detail page",
      "Fork map view",
      "Reasoned endorsement component"
    ],
    comments: [
      {
        author: "Amara",
        stance: "Product note",
        body:
          "The status panel should explain why the label changed, not just show the label.",
        replies: [
          {
            author: "Udayan Sharma",
            stance: "Author reply",
            body:
              "Yes. Status without memory becomes a badge. The point is to show what moved the idea."
          }
        ]
      },
      {
        author: "Jules",
        stance: "Design warning",
        body:
          "Do not make this feel like Jira for science. It needs structure without deadness."
      }
    ],
    saved: true
  },
  {
    id: "prepared-minds",
    kind: "paper",
    room: "library",
    title: "Prepared minds and loose rooms",
    author: "Elena Voss",
    affiliation: "History of Discovery",
    date: "Jun 10",
    status: "Contested",
    metrics: { signal: "236", critiques: "2", forks: "42", saves: "88", reads: "9.6k" },
    gatheringReason:
      "People are here because accident examples are powerful but easy to romanticize.",
    excerpt:
      "Graphene, X-rays, radioactivity, CMB, and other cases as evidence that discovery needs looseness plus seriousness.",
    body:
      "The note collects discovery cases where an anomaly became important because someone had enough preparation to notice it and enough freedom to follow it. The mature lesson is not that accidents are magic. It is that institutions decide whether early weirdness gets killed, ignored, archived, or tested.",
    tags: ["play", "accident", "history", "institution design"],
    signals: [
      { label: "Open objections", value: "4" },
      { label: "Evidence state", value: "Historical examples" },
      { label: "Forks", value: "2" },
      { label: "Replication", value: "Not applicable" }
    ],
    claims: [
      "Playful room structure changes whether anomalies survive.",
      "Prepared minds matter more than raw looseness.",
      "A useful archive should store abandoned anomalies with reasons."
    ],
    objections: [
      "Survivorship bias is severe in discovery anecdotes.",
      "Accident examples can be used to excuse weak standards.",
      "Historical cases do not directly imply what modern labs should do."
    ],
    evidence: [
      "Graphene tape method story.",
      "CMB discovery history.",
      "X-ray and radioactivity anomaly narratives."
    ],
    tests: [
      "Build a counterexample table of failed anomaly chases.",
      "Compare lab environments that archived failures vs labs that did not."
    ],
    forks: ["Failed-accident archive", "Loose-room design variables"],
    comments: [
      {
        author: "Rahul M.",
        stance: "Strong objection",
        body:
          "The piece needs failure-rate context. Otherwise it becomes a beautiful story with no denominator.",
        replies: [
          {
            author: "Elena Voss",
            stance: "Author reply",
            body:
              "That is the right pressure. I am separating survival stories from the archive of anomalies that went nowhere."
          }
        ]
      }
    ],
    saved: true
  },
  {
    id: "scientific-will",
    kind: "thought",
    room: "amphitheater",
    title: "Great work is not achieved because it is simply not tried anymore",
    author: "Udayan Sharma",
    affiliation: "Amphitheater note",
    date: "Jun 9",
    status: "Hot Objection",
    metrics: { signal: "1.8k", critiques: "5", forks: "391", saves: "522", reads: "74.2k" },
    gatheringReason:
      "People are here because the line is morally sharp and probably incomplete, which makes it worth fighting with.",
    excerpt:
      "Bad systems make smallness rational. Smallness then reproduces the system.",
    body:
      "The claim is not that modern scientists are unintelligent. The claim is that too many structures train people out of large-aim inquiry, and then the trained smallness is defended as realism. A real reform has to deal with incentives and the inner will to attempt difficult, world-opening work.",
    tags: ["scientific will", "ambition", "institutions", "play"],
    signals: [
      { label: "Agreement", value: "Reasoned, split" },
      { label: "Open objections", value: "7" },
      { label: "Forks", value: "6" },
      { label: "Needs", value: "Sharper definitions" }
    ],
    claims: [
      "Incentives do not just block greatness; they shape what people dare to attempt.",
      "Explanations for decline can become excuses for not acting.",
      "Protected conditions should cultivate will, not just remove friction."
    ],
    objections: [
      "The line may understate material constraints in modern research.",
      "It risks sounding like blame toward individual scientists trapped in bad systems.",
      "Great work may be less visible now because fields are more specialized."
    ],
    evidence: [
      "Anecdotal research disillusionment across university labs.",
      "Selection pressure toward incremental, grant-legible work.",
      "Career incentives pushing technical talent away from frontier science."
    ],
    tests: [
      "Survey early researchers on projects they would pursue if reputation cost were lower.",
      "Compare autonomous youth-lab outputs against professor-assigned project outputs."
    ],
    forks: [
      "Will vs incentive distinction",
      "Youth lab selection criteria",
      "Proof-of-work against system-as-excuse"
    ],
    comments: [
      {
        author: "Celia Noor",
        stance: "Objection",
        body:
          "The phrasing is powerful, but it needs the role of expensive apparatus and specialization.",
        replies: [
          {
            author: "Udayan Sharma",
            stance: "Author reply",
            body:
              "Yes. The claim should attack learned smallness without pretending equipment and specialization are fake constraints."
          }
        ]
      },
      {
        author: "M. Iqbal",
        stance: "Endorsement with reason",
        body:
          "The useful part is not blame. It is the refusal to let structure become metaphysical fate."
      }
    ]
  },
  {
    id: "hidden-law-runner",
    kind: "code",
    room: "office",
    title: "Hidden-law toy world runner",
    author: "Udayan Sharma",
    affiliation: "Office code notebook",
    date: "Jun 8",
    status: "Prototype",
    metrics: { signal: "94", critiques: "1", forks: "12", saves: "41", reads: "2.1k" },
    gatheringReason:
      "This is saved because it could become the first proof-of-work artifact behind the AI/metascience idea.",
    excerpt:
      "A small environment where agents infer modified physical laws from generated observations and held-out tests.",
    body:
      "The runner should generate observations from a small physical system with one hidden modification. The agent can request experiments, propose mechanisms, and revise after feedback. The important part is blind scoring: law recovery, prediction, dimensional consistency, and experiment efficiency.",
    tags: ["simulation", "agents", "benchmarks", "code"],
    signals: [
      { label: "Files", value: "Sketch only" },
      { label: "Next action", value: "Implement oscillator task" },
      { label: "Risk", value: "Benchmark leakage" },
      { label: "Saved", value: "Office" }
    ],
    claims: [
      "Synthetic physical worlds can make metascience experiments faster.",
      "Agents should be judged by held-out prediction, not fluent explanations."
    ],
    objections: [
      "Toy worlds might miss the messiness that makes science hard.",
      "Agents may exploit benchmark regularities."
    ],
    evidence: [
      "Hidden nonlinear oscillator example.",
      "Proposed law-recovery scoring rubric."
    ],
    tests: [
      "Implement one noisy oscillator with hidden drag term.",
      "Run one broad-search agent and one narrow-search agent."
    ],
    forks: ["Oscillator task", "Anomalous diffusion task", "Panel critic agent"],
    comments: [
      {
        author: "AI tablet",
        stance: "Contextual note",
        body:
          "Add held-out data before showing agents any scoring rubric."
      }
    ],
    saved: true
  },
  {
    id: "youth-labs",
    kind: "draft",
    room: "office",
    title: "Rogue youth labs pilot",
    author: "Udayan Sharma",
    affiliation: "Office draft stack",
    date: "Jun 7",
    status: "Draft",
    metrics: { signal: "63", critiques: "1", forks: "9", saves: "57", reads: "1.4k" },
    gatheringReason:
      "This is a private working draft for turning the Science Rebirth diagnosis into an institutional pilot.",
    excerpt:
      "Small autonomous cells, proof-of-work, older critics as advisors, accountability to output instead of permission.",
    body:
      "The pilot should select for agency, taste, originality, proof-of-work, and strange serious fixations rather than GPA polish alone. It should protect early illegibility while demanding artifacts: technical notes, simulations, failed attempts, datasets, prototype instruments, and clear logs.",
    tags: ["youth labs", "institution design", "proof-of-work"],
    signals: [
      { label: "Draft stage", value: "Raw" },
      { label: "Needs", value: "Pilot budget" },
      { label: "Open objection", value: "Selection quality" },
      { label: "Saved", value: "Office" }
    ],
    claims: [
      "Young researchers should sometimes originate rather than only implement.",
      "Older researchers are most valuable as critics, memory, and protectors in the pilot."
    ],
    objections: [
      "Youth autonomy can become wandering without strong artifact pressure.",
      "Selection may confuse confidence with agency."
    ],
    evidence: [
      "University research disillusionment.",
      "Historical role of young researchers in foundational work.",
      "Known failures of over-managed student research."
    ],
    tests: [
      "Run a 10-person summer cell with public output requirements.",
      "Compare outputs against conventional undergraduate research assignments."
    ],
    forks: ["Selection rubric", "Advisor protocol", "Failed-attempt archive"],
    comments: [
      {
        author: "Self",
        stance: "Voice note",
        body:
          "Do not sand this into committee-safe prose. The lack of vitality is the point."
      }
    ],
    saved: true
  }
];

const generatedBlueprints: Array<{
  room: Exclude<RoomId, "hall">;
  kind: ContentKind;
  status: string;
  title: string;
  excerpt: string;
  body: string;
  tags: string[];
}> = [
  {
    room: "library",
    kind: "paper",
    status: "Live reading",
    title: "A denominator for heroic discovery stories",
    excerpt: "A field map of anomalies that died, survived, or became useful only after criticism.",
    body:
      "This paper sketch asks for a denominator behind famous discovery stories. The claim is simple: the archive of failed anomaly chases is part of the truth, not an embarrassment to hide after the one story succeeds.",
    tags: ["history", "anomaly", "methods", "archive"]
  },
  {
    room: "symposium",
    kind: "thought",
    status: "Open thread",
    title: "A good objection should leave a handle",
    excerpt: "Objections should be reusable objects, not vapor in a comment thread.",
    body:
      "If a critique matters, it should become something other people can cite, improve, answer, or test. Otherwise the same objection returns every week in a new costume.",
    tags: ["critique", "dialogue", "product"]
  },
  {
    room: "amphitheater",
    kind: "thought",
    status: "Live argument",
    title: "Taste is a research instrument",
    excerpt: "Not a substitute for evidence, but one of the things that decides where evidence is sought.",
    body:
      "Taste is dangerous when it becomes authority. But pretending it is absent only hides it. The better move is to train taste in public against failed predictions and hard objections.",
    tags: ["taste", "training", "research culture"]
  },
  {
    room: "library",
    kind: "paper",
    status: "Replication packet",
    title: "Negative-result tables for toy-world agents",
    excerpt: "A proposal for storing failed law-recovery attempts as useful data rather than noise.",
    body:
      "The packet format records the hidden law, allowed experiments, failed mechanisms, critic notes, and held-out prediction errors. The goal is to make agent failure inspectable rather than merely disappointing.",
    tags: ["AI metascience", "negative results", "toy worlds"]
  },
  {
    room: "symposium",
    kind: "paper",
    status: "Needs readers",
    title: "Source packets before synthesis",
    excerpt: "A protocol for forcing AI-assisted summaries to carry their evidential spine.",
    body:
      "The paper proposes source packets that travel with every synthesis: claims, quotes, missing sources, uncertainty, and what would make the summary wrong. The aim is to stop polished synthesis from outrunning evidence.",
    tags: ["AI agents", "sources", "protocols"]
  },
  {
    room: "office",
    kind: "draft",
    status: "Saved draft",
    title: "Youth-lab selection notes after the first screen",
    excerpt: "Agency, taste, weird seriousness, and proof-of-work should be visible before credentials.",
    body:
      "The draft separates selection into artifacts, interviews, criticism response, and self-directed repair. The goal is to avoid confusing polish with the capacity to originate.",
    tags: ["youth labs", "selection", "proof-of-work"]
  },
  {
    room: "library",
    kind: "paper",
    status: "Method note",
    title: "Blind rediscovery as a weekly practice",
    excerpt: "A small routine for testing whether a person or agent can recover structure without leakage.",
    body:
      "The note lays out a weekly blind rediscovery practice: source constraints, hidden target, critic review, and a log of what changed between guesses. It is designed to be small enough to run repeatedly.",
    tags: ["rediscovery", "benchmarks", "practice"]
  },
  {
    room: "amphitheater",
    kind: "note",
    status: "Sharp question",
    title: "What is the smallest room where real ambition survives?",
    excerpt: "The question is not only funding. It is permission, taste, criticism, and time.",
    body:
      "A protected room can still become fake if the work inside is not forced into contact with reality. A strict room can still be alive if it protects illegible beginnings. The design problem is the mixture.",
    tags: ["ambition", "institutions", "youth labs"]
  },
  {
    room: "symposium",
    kind: "thought",
    status: "Forked",
    title: "Do not reward volume when the scarce thing is judgment",
    excerpt: "A feed can accidentally train people to manufacture visible motion.",
    body:
      "If Symposium rewards volume, it will become another machine for producing research-looking movement. The scarce thing is not speech. It is judgment under pressure.",
    tags: ["metrics", "judgment", "feed design"]
  },
  {
    room: "office",
    kind: "code",
    status: "Prototype note",
    title: "Oscillator task scoring stub",
    excerpt: "Held-out prediction, mechanism fit, experiment count, and unsupported invention.",
    body:
      "The scoring stub separates prediction from mechanism story. An agent can sound elegant and still fail held-out data. It can also predict while inventing a mechanism not supported by the source packet.",
    tags: ["simulation", "code", "hidden laws"]
  },
  {
    room: "library",
    kind: "paper",
    status: "Reading group",
    title: "Prepared minds without mythology",
    excerpt: "A critique of discovery stories that skip training, apparatus, and the boring archive.",
    body:
      "The paper argues for a middle position: prepared minds matter, but not as a magic trait. They are trained by contact with material, failed examples, instruments, and local cultures that let oddness stay visible.",
    tags: ["history", "discovery", "apparatus"]
  },
  {
    room: "amphitheater",
    kind: "thought",
    status: "Contested",
    title: "The phrase 'not realistic' needs an audit trail",
    excerpt: "Sometimes it means physics. Sometimes it means fear wearing institutional clothes.",
    body:
      "A serious system should ask what kind of impossibility is being invoked: material impossibility, time cost, reputation cost, credential politics, or genuine incoherence.",
    tags: ["institutions", "ambition", "critique"]
  },
  {
    room: "funding",
    kind: "draft",
    status: "Civic patronage",
    title: "Microgrant packet for blind rediscovery weekends",
    excerpt: "A compact budget for running small rediscovery sessions with public logs and critic review.",
    body:
      "The civic patronage note asks for small, fast support: facilitator time, participant stipends, hosting, and review honoraria. The output would be public packets, failed attempts, and a repeatable format for other communities.",
    tags: ["patronage", "civic", "microgrants", "rediscovery", "review"]
  },
  {
    room: "funding",
    kind: "thought",
    status: "Private patronage",
    title: "What evidence should unlock the second tranche?",
    excerpt: "Patronage should reward reality contact, not the ability to write heroic updates.",
    body:
      "A staged grant can be honest if the unlock condition is visible work: logs, critique response, replication attempts, or a working artifact. The hard part is choosing evidence that does not become theater.",
    tags: ["patronage", "private", "grants", "milestones", "evidence"]
  },
  {
    room: "communities",
    kind: "thought",
    status: "Discoverable",
    title: "A community should orbit work, not vibes",
    excerpt: "The useful unit is a group with artifacts, calls, and a memory of what it tried.",
    body:
      "Communities should not become private clubs with nice language. Each one needs a reason to exist: a method, a field map, a reading room, a live event, a dataset, or a recurring challenge.",
    tags: ["communities", "groups", "events", "calls"]
  },
  {
    room: "communities",
    kind: "note",
    status: "Campus path",
    title: "Discover view should start with live rooms and recent calls",
    excerpt: "Your communities, discover, calls, and events can be normal interface inside an in-world threshold.",
    body:
      "The community doorway can open into a cleaner directory: your groups first, live calls second, then discovery by field and recent activity. The in-world move is the entrance, not every group becoming a miniature building.",
    tags: ["communities", "discovery", "interface", "events"]
  },
  {
    room: "library",
    kind: "paper",
    status: "Community paper",
    title: "Frontier Physics Bench field map",
    excerpt: "A shared map of hidden-law tasks, apparatus constraints, and unresolved anomaly work.",
    body:
      "The Frontier Physics Bench is collecting papers that separate romance from reality contact: what apparatus is required, what predictions would matter, and what would count as a failed path.",
    tags: ["frontier physics", "hidden law", "apparatus", "community"]
  },
  {
    room: "library",
    kind: "paper",
    status: "Source packet",
    title: "Source Packet Workshop review scaffold",
    excerpt: "A private workshop format for evidence packets that can still publish useful paper artifacts.",
    body:
      "The scaffold asks every synthesis to carry claims, missing sources, uncertainty, quotes, and explicit failure cases. The workshop can be private, but the paper artifact remains discoverable in the library.",
    tags: ["source packet", "synthesis", "review", "evidence spine", "community"]
  },
  {
    room: "amphitheater",
    kind: "thought",
    status: "Public community thought",
    title: "Replication Commons needs a failure etiquette",
    excerpt: "A negative result should feel like a contribution, not a confession.",
    body:
      "Public communities around replication need manners that make failed attempts inspectable without making people perform humiliation. The work is the packet, the critique, and the repair.",
    tags: ["replication", "negative results", "failure", "community"]
  },
  {
    room: "opportunities",
    kind: "note",
    status: "Open community call",
    title: "Rogue Youth Labs seeks summer cell advisors",
    excerpt: "Need older critics who can protect weird work while demanding visible artifacts.",
    body:
      "The call is for advisors who can help a youth-lab cell produce public artifacts, failed-attempt logs, and sharp critique responses over a short summer cycle.",
    tags: ["rogue youth labs", "opportunities", "advisor", "residency", "community"]
  },
  {
    room: "opportunities",
    kind: "draft",
    status: "Bounty sketch",
    title: "Open Problems Garden bounty board",
    excerpt: "Small bounties for converting vague research wishes into concrete challenge packets.",
    body:
      "The board rewards useful problem framing: constraints, source packets, evaluation criteria, and a first failed attempt. It is meant to feed opportunities without turning everything into credential theater.",
    tags: ["open problems", "opportunities", "bounty", "challenge", "community"]
  },
  {
    room: "communities",
    kind: "note",
    status: "Private room note",
    title: "Patronage Design Desk call memo",
    excerpt: "A private community note on what evidence should unlock the next tranche.",
    body:
      "Private communities can hold calls and internal notes without making every thought public. Papers still travel to the library; private thoughts stay in the community context.",
    tags: ["patronage", "private", "grant", "community", "call"]
  },
  {
    room: "opportunities",
    kind: "note",
    status: "Open call",
    title: "Call for reviewers: source-packet synthesis tests",
    excerpt: "Need careful readers to judge whether summaries carry enough evidence to be trusted.",
    body:
      "The call asks for reviewers who can inspect source packets, mark missing evidence, and score whether a synthesis outruns what its sources can support. Useful for AI-assisted research workflows.",
    tags: ["opportunities", "review", "AI metascience", "call"]
  },
  {
    room: "opportunities",
    kind: "draft",
    status: "Fellowship sketch",
    title: "Three-month rogue youth lab residency",
    excerpt: "A small residency for young builders producing artifacts rather than credential theater.",
    body:
      "The opportunity sketch proposes a short residency with public artifacts, weekly critique, and a final packet. Selection would favor prior work, taste, resilience under criticism, and self-directed repair.",
    tags: ["opportunities", "youth labs", "fellowship", "residency"]
  }
];

const participantHandles = [profile.handle, ...generatedPublicProfiles.map((person) => person.handle)];

export const researchCommunities: ResearchCommunity[] = [
  {
    id: "frontier-physics-bench",
    name: "Frontier Physics Bench",
    field: "Hidden laws, instruments, anomaly work",
    summary: "Readers and builders testing weird physical claims against apparatus, toy worlds, and hard prediction.",
    visibility: "public",
    online: 38,
    memberHandles: [profile.handle, "@jonas_vale", "@anika_rao", "@niko_varga", "@orion_patel", "@ruth_bell"],
    keywords: ["frontier physics", "physics", "hidden law", "oscillator", "apparatus", "toy worlds"],
    seedCounts: { papers: 22, thoughts: 31, opportunities: 6 },
    callStatus: "voice live"
  },
  {
    id: "ai-metascience-lab",
    name: "AI Metascience Lab",
    field: "Agent benchmarks, source packets, evaluation",
    summary: "A public workroom for cheap exploration, expensive truth, critique engines, and benchmark design.",
    visibility: "public",
    online: 52,
    memberHandles: [profile.handle, "@mira_sato", "@leahk", "@priya_menon", "@maeve_chen", "@dario_silva"],
    keywords: ["AI metascience", "AI agents", "benchmark", "source packet", "rediscovery", "critique"],
    seedCounts: { papers: 34, thoughts: 45, opportunities: 9 },
    callStatus: "video live"
  },
  {
    id: "replication-commons",
    name: "Replication Commons",
    field: "Negative results, methods, repair logs",
    summary: "People turning failed attempts into visible packets instead of letting them disappear.",
    visibility: "public",
    online: 27,
    memberHandles: [profile.handle, "@narvind", "@ruth_bell", "@owen_markham", "@greta_holm"],
    keywords: ["replication", "negative results", "methods", "failure", "denominator"],
    seedCounts: { papers: 28, thoughts: 21, opportunities: 7 },
    callStatus: "quiet"
  },
  {
    id: "rogue-youth-labs",
    name: "Rogue Youth Labs",
    field: "Selection, mentorship, proof-of-work",
    summary: "A practical group for young builders, strange serious projects, advisors, and public artifacts.",
    visibility: "public",
    online: 44,
    memberHandles: [profile.handle, "@miqbal", "@salma_idris", "@vikram_bedi", "@talia_finch", "@jalen_brooks"],
    keywords: ["rogue youth labs", "youth labs", "proof-of-work", "selection", "residency"],
    seedCounts: { papers: 19, thoughts: 39, opportunities: 14 },
    callStatus: "voice live"
  },
  {
    id: "history-of-discovery-circle",
    name: "History of Discovery Circle",
    field: "Archives, anomalies, prepared minds",
    summary: "Historical readers looking for the real machinery behind discovery stories and dead anomaly trails.",
    visibility: "public",
    online: 21,
    memberHandles: [profile.handle, "@e_voss", "@rahulm", "@helena_park", "@felix_moreau"],
    keywords: ["history of discovery", "history", "discovery", "anomaly", "archive", "prepared minds"],
    seedCounts: { papers: 25, thoughts: 18, opportunities: 5 },
    callStatus: "quiet"
  },
  {
    id: "tools-instruments-guild",
    name: "Tools and Instruments Guild",
    field: "Interfaces, notebooks, code, apparatus",
    summary: "Builders making the instruments that let research work travel, repeat, and get inspected.",
    visibility: "public",
    online: 33,
    memberHandles: [profile.handle, "@jules", "@lina_ortega", "@soren_li", "@milo_hart"],
    keywords: ["tools", "instruments", "code", "notebook", "runner", "apparatus"],
    seedCounts: { papers: 18, thoughts: 24, opportunities: 8 },
    callStatus: "video live"
  },
  {
    id: "patronage-design-desk",
    name: "Patronage Design Desk",
    field: "Civic backing, grants, serious incentives",
    summary: "A mixed group shaping bounties, grants, donations, and second-tranche evidence for live work.",
    visibility: "private",
    online: 16,
    memberHandles: [profile.handle, "@jonas_vale", "@sana_morel", "@idris_bellamy"],
    keywords: ["patronage", "funding", "grant", "civic", "private", "bounty", "investor"],
    seedCounts: { papers: 13, thoughts: 10, opportunities: 18 },
    callStatus: "quiet"
  },
  {
    id: "open-problems-garden",
    name: "Open Problems Garden",
    field: "Problems, calls, challenge design",
    summary: "A discovery surface for problems worth joining before they become formal programs.",
    visibility: "public",
    online: 29,
    memberHandles: ["@sofia_klein", "@eli_navarro", "@clara_weiss", "@quinn_reyes", "@rhea_sands"],
    keywords: ["open problems", "opportunities", "call", "challenge", "roles", "fellowship"],
    seedCounts: { papers: 11, thoughts: 16, opportunities: 23 },
    callStatus: "voice live"
  },
  {
    id: "field-methods-exchange",
    name: "Field Methods Exchange",
    field: "Observation, interviews, data contact",
    summary: "A public exchange for getting claims out of the room and into better evidence contact.",
    visibility: "public",
    online: 18,
    memberHandles: ["@clara_weiss", "@mateo_ibarra", "@noor_al_khatib", "@ines_duarte"],
    keywords: ["field methods", "interviews", "observation", "data", "evidence"],
    seedCounts: { papers: 15, thoughts: 14, opportunities: 4 },
    callStatus: "quiet"
  },
  {
    id: "source-packet-workshop",
    name: "Source Packet Workshop",
    field: "Evidence packets, synthesis, review",
    summary: "A private workshop for source-packet review, missing evidence, and summaries that carry their spine.",
    visibility: "private",
    online: 12,
    memberHandles: ["@mira_sato", "@leahk", "@narvind", "@priya_menon"],
    keywords: ["source packets", "source packet", "synthesis", "review", "evidence spine"],
    seedCounts: { papers: 17, thoughts: 8, opportunities: 5 },
    callStatus: "video live"
  },
  {
    id: "toy-world-agents",
    name: "Toy World Agents",
    field: "Simulation, scoring, hidden worlds",
    summary: "Benchmark hackers building toy worlds where claims must survive held-out prediction.",
    visibility: "public",
    online: 31,
    memberHandles: ["@niko_varga", "@maeve_chen", "@dario_silva", "@tomasz_zielinski"],
    keywords: ["toy worlds", "simulation", "hidden laws", "oscillator", "agents", "scoring"],
    seedCounts: { papers: 26, thoughts: 22, opportunities: 6 },
    callStatus: "voice live"
  },
  {
    id: "campus-events-board",
    name: "Campus Events Board",
    field: "Calls, seminars, live sessions",
    summary: "The shared board for live calls, conferences, office hours, and near-term gathering points.",
    visibility: "public",
    online: 47,
    memberHandles: ["@yara_mensah", "@arun_sen", "@june_park", "@pavel_idris"],
    keywords: ["events", "calls", "conference", "seminar", "live session"],
    seedCounts: { papers: 7, thoughts: 19, opportunities: 21 },
    callStatus: "video live"
  },
  {
    id: "anomaly-archive-room",
    name: "Anomaly Archive Room",
    field: "Dead leads, weird records, prepared minds",
    summary: "A reading group for anomalies that deserve better storage than folklore and better tests than vibes.",
    visibility: "public",
    online: 24,
    memberHandles: ["@e_voss", "@helena_park", "@felix_moreau", "@sofia_klein", "@greta_holm"],
    keywords: ["anomaly", "archive", "history", "prepared minds", "discovery"],
    seedCounts: { papers: 21, thoughts: 17, opportunities: 4 },
    callStatus: "quiet"
  },
  {
    id: "mentor-critique-table",
    name: "Mentor Critique Table",
    field: "Advising, hard feedback, project shape",
    summary: "Mentors and builders trading sharp feedback before projects calcify around the wrong premise.",
    visibility: "private",
    online: 19,
    memberHandles: [profile.handle, "@salma_idris", "@miqbal", "@talia_finch", "@jalen_brooks"],
    keywords: ["mentor", "critique", "youth labs", "project", "proof-of-work"],
    seedCounts: { papers: 8, thoughts: 26, opportunities: 11 },
    callStatus: "voice live"
  },
  {
    id: "civic-bounty-commons",
    name: "Civic Bounty Commons",
    field: "Bounties, donations, public goods",
    summary: "Small public bounties for tests, datasets, replications, and civic scientific work.",
    visibility: "public",
    online: 35,
    memberHandles: ["@sana_morel", "@idris_bellamy", "@arun_sen", "@yara_mensah", "@clara_weiss"],
    keywords: ["civic", "bounty", "donation", "crowdfunding", "patronage", "public"],
    seedCounts: { papers: 9, thoughts: 14, opportunities: 31 },
    callStatus: "voice live"
  },
  {
    id: "private-grant-circle",
    name: "Private Grant Circle",
    field: "Grants, funds, family offices",
    summary: "Private backers and researchers discussing evidence thresholds before serious capital moves.",
    visibility: "private",
    online: 14,
    memberHandles: ["@jonas_vale", "@sana_morel", "@idris_bellamy", "@pavel_idris"],
    keywords: ["private", "grant", "fund", "family office", "investor", "patronage"],
    seedCounts: { papers: 12, thoughts: 7, opportunities: 19 },
    callStatus: "quiet"
  },
  {
    id: "open-instrument-forge",
    name: "Open Instrument Forge",
    field: "Bench tools, apparatus, interfaces",
    summary: "A builder cluster for low-cost instruments, scoring harnesses, and inspectable research tools.",
    visibility: "public",
    online: 41,
    memberHandles: ["@jules", "@lina_ortega", "@soren_li", "@milo_hart", "@orion_patel"],
    keywords: ["instrument", "tools", "apparatus", "code", "benchmark", "runner"],
    seedCounts: { papers: 23, thoughts: 20, opportunities: 10 },
    callStatus: "video live"
  },
  {
    id: "data-commons-atelier",
    name: "Data Commons Atelier",
    field: "Datasets, provenance, shared evidence",
    summary: "People making evidence portable: datasets, provenance notes, missing-denominator logs, and repair trails.",
    visibility: "public",
    online: 28,
    memberHandles: ["@narvind", "@ruth_bell", "@owen_markham", "@mateo_ibarra", "@noor_al_khatib"],
    keywords: ["data", "dataset", "provenance", "evidence", "replication", "methods"],
    seedCounts: { papers: 29, thoughts: 13, opportunities: 8 },
    callStatus: "quiet"
  },
  {
    id: "paper-reading-agora",
    name: "Paper Reading Agora",
    field: "Reading rooms, annotations, paper trails",
    summary: "Slow reading circles where papers become annotated trails instead of disappearing into saved folders.",
    visibility: "public",
    online: 37,
    memberHandles: ["@mira_sato", "@leahk", "@rahulm", "@ines_duarte", "@june_park"],
    keywords: ["paper", "reading", "annotation", "library", "source packet"],
    seedCounts: { papers: 42, thoughts: 12, opportunities: 6 },
    callStatus: "video live"
  },
  {
    id: "negative-results-clinic",
    name: "Negative Results Clinic",
    field: "Failed attempts, repair, replication",
    summary: "A clinic for failed runs, negative results, and the stubborn work of making non-success legible.",
    visibility: "public",
    online: 23,
    memberHandles: ["@ruth_bell", "@narvind", "@greta_holm", "@owen_markham", "@dario_silva"],
    keywords: ["negative results", "failure", "replication", "repair", "methods"],
    seedCounts: { papers: 31, thoughts: 16, opportunities: 7 },
    callStatus: "quiet"
  },
  {
    id: "young-builders-courtyard",
    name: "Young Builders Courtyard",
    field: "Proof-of-work, labs, apprenticeships",
    summary: "A public courtyard for young builders looking for mentors, weird projects, and honest standards.",
    visibility: "public",
    online: 49,
    memberHandles: [profile.handle, "@salma_idris", "@vikram_bedi", "@jalen_brooks", "@talia_finch"],
    keywords: ["young builders", "youth labs", "proof-of-work", "apprenticeship", "mentorship"],
    seedCounts: { papers: 14, thoughts: 33, opportunities: 24 },
    callStatus: "voice live"
  },
  {
    id: "method-translation-studio",
    name: "Method Translation Studio",
    field: "Field methods, interfaces, translation",
    summary: "Translating methods between labs, youth projects, fieldwork, and AI-assisted exploration.",
    visibility: "public",
    online: 20,
    memberHandles: ["@clara_weiss", "@mateo_ibarra", "@ines_duarte", "@priya_menon", "@maeve_chen"],
    keywords: ["method", "translation", "field methods", "interfaces", "AI metascience"],
    seedCounts: { papers: 16, thoughts: 18, opportunities: 9 },
    callStatus: "quiet"
  },
  {
    id: "institution-design-forum",
    name: "Institution Design Forum",
    field: "New institutions, incentives, governance",
    summary: "A forum for the shape of serious new institutions: selection, incentives, norms, and useful constraints.",
    visibility: "public",
    online: 26,
    memberHandles: ["@rahulm", "@helena_park", "@sana_morel", "@arun_sen", "@sofia_klein"],
    keywords: ["institution", "governance", "selection", "incentives", "science rebirth"],
    seedCounts: { papers: 18, thoughts: 28, opportunities: 12 },
    callStatus: "voice live"
  },
  {
    id: "conference-signals-forum",
    name: "Conference Signals Forum",
    field: "Events, calls, salons, conferences",
    summary: "A live board for calls, salons, conferences, and gatherings that should become more than calendar spam.",
    visibility: "public",
    online: 32,
    memberHandles: ["@yara_mensah", "@june_park", "@pavel_idris", "@eli_navarro", "@quinn_reyes"],
    keywords: ["conference", "events", "calls", "salon", "live session", "opportunities"],
    seedCounts: { papers: 6, thoughts: 15, opportunities: 35 },
    callStatus: "video live"
  }
];

const pickHandles = (seed: number, count: number) =>
  Array.from({ length: Math.min(count, participantHandles.length) }, (_, offset) => {
    const index = (seed * 7 + offset * 11) % participantHandles.length;
    return participantHandles[index];
  }).filter((handle, index, all) => all.indexOf(handle) === index);

const countGeneratedComments = (comments: InquiryComment[]): number =>
  comments.reduce((total, comment) => total + 1 + countGeneratedComments(comment.replies ?? []), 0);

const generatedComments = (itemIndex: number, author: ResearchProfile): InquiryComment[] => {
  const first = generatedPublicProfiles[(itemIndex + 9) % generatedPublicProfiles.length];
  const second = generatedPublicProfiles[(itemIndex + 21) % generatedPublicProfiles.length];
  const reply = generatedPublicProfiles[(itemIndex + 33) % generatedPublicProfiles.length];

  return [
    {
      id: `live-${itemIndex}-comment-1`,
      author: first.name,
      authorHandle: first.handle,
      stance: "Comment",
      createdAt: itemIndex % 3 === 0 ? "Just now" : `${(itemIndex % 20) + 2}m ago`,
      body:
        "This is useful, but the next version should name the failure case more sharply.",
      replies: [
        {
          id: `live-${itemIndex}-comment-1-reply`,
          author: author.name,
          authorHandle: author.handle,
          stance: "Comment",
          createdAt: `${(itemIndex % 14) + 1}m ago`,
          body:
            "Agreed. I am trying to separate the claim from the mood around the claim."
        }
      ]
    },
    {
      id: `live-${itemIndex}-comment-2`,
      author: second.name,
      authorHandle: second.handle,
      stance: "Comment",
      createdAt: `${(itemIndex % 26) + 4}m ago`,
      body:
        "I would save this, but only if the test section becomes concrete enough for someone else to run."
    },
    ...(itemIndex % 4 === 0
      ? [
          {
            id: `live-${itemIndex}-comment-3`,
            author: reply.name,
            authorHandle: reply.handle,
            stance: "Comment",
            createdAt: `${(itemIndex % 34) + 7}m ago`,
            body:
              "The strongest part is the constraint. The weakest part is still the measurement story."
          }
        ]
      : [])
  ];
};

const generatedInquiryItems: InquiryItem[] = Array.from({ length: 132 }, (_, index) => {
  const blueprint = generatedBlueprints[index % generatedBlueprints.length];
  const author = generatedPublicProfiles[index % generatedPublicProfiles.length];
  const signaledBy = pickHandles(index + 1, 9 + (index % 19));
  const forkedBy = pickHandles(index + 3, 2 + (index % 8));
  const savedBy = pickHandles(index + 5, 4 + (index % 15));
  if (index % 6 === 0 && !savedBy.includes(profile.handle)) savedBy.push(profile.handle);
  const comments = generatedComments(index, author);
  const critiqueCount = countGeneratedComments(comments);

  return {
    id: `live-${index + 1}-${blueprint.room}-${blueprint.kind}`,
    kind: blueprint.kind,
    room: blueprint.room,
    title: `${blueprint.title}${index >= generatedBlueprints.length ? ` ${Math.floor(index / generatedBlueprints.length) + 1}` : ""}`,
    author: author.name,
    authorHandle: author.handle,
    affiliation: author.location,
    date: index < 10 ? "Live now" : `${(index % 48) + 1}m ago`,
    status: blueprint.status,
    metrics: {
      signal: String(signaledBy.length),
      critiques: String(critiqueCount),
      forks: String(forkedBy.length),
      saves: String(savedBy.length),
      reads: String(340 + index * 37)
    },
    gatheringReason:
      "This live seed thread is here to make the room feel inhabited while the backend matures.",
    excerpt: blueprint.excerpt,
    body: blueprint.body,
    tags: blueprint.tags,
    signals: [
      { label: "Signals", value: String(signaledBy.length) },
      { label: "Critiques", value: String(critiqueCount) },
      { label: "Forks", value: String(forkedBy.length) },
      { label: "Room", value: blueprint.room }
    ],
    claims: [blueprint.excerpt],
    objections: ["The strongest objection is not settled yet."],
    evidence: ["Seeded discussion, mock reading activity, and live v0 interaction state."],
    tests: ["Turn this thread into a concrete artifact, replication, or falsifiable test."],
    forks: ["Public critique", "Replication note", "Notebook extraction"],
    comments,
    saved: savedBy.includes(profile.handle),
    savedBy,
    signaledBy,
    forkedBy
  };
});

const seedIsoDate = (index: number, offsetMinutes = 0) =>
  new Date(Date.now() - (index + 12 + offsetMinutes) * 60 * 1000).toISOString();

const stampSeedComments = (
  comments: InquiryComment[],
  itemIndex: number,
  parentOffset = 0
): InquiryComment[] =>
  comments.map((comment, commentIndex) => ({
    ...comment,
    createdAt: comment.createdAt?.includes("T")
      ? comment.createdAt
      : seedIsoDate(itemIndex, parentOffset + commentIndex + 1),
    replies: stampSeedComments(comment.replies ?? [], itemIndex, parentOffset + commentIndex + 6)
  }));

export const inquiryItems: InquiryItem[] = [...coreInquiryItems, ...generatedInquiryItems].map((item, index) => ({
  ...item,
  createdAt: item.createdAt ?? seedIsoDate(index),
  comments: stampSeedComments(item.comments, index)
}));

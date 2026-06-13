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

export type RoomId = "hall" | "office" | "symposium" | "library" | "amphitheater";
export type FeedScope = "suggested" | "following" | "rooms";
export type ContentKind = "paper" | "thought" | "draft" | "note" | "code";

export type InquiryComment = {
  author: string;
  body: string;
  stance: string;
  replies?: InquiryComment[];
};

export type InquiryMetrics = {
  endorsements: string;
  reshares: string;
  saves: string;
  views: string;
};

export type InquiryItem = {
  id: string;
  kind: ContentKind;
  room: Exclude<RoomId, "hall">;
  title: string;
  author: string;
  affiliation: string;
  date: string;
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
  role: string;
  location: string;
  bio: string;
  proof: string[];
  fields: string[];
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
  "Tools And Instruments"
];

export const libraryFolders = [
  { label: "All saved", count: 18, icon: BookOpen },
  { label: "Needs experiment", count: 6, icon: BrainCircuit },
  { label: "Lineage maps", count: 4, icon: ScrollText },
  { label: "Draft fuel", count: 7, icon: Sparkles }
];

export const profile = {
  name: "Udayan Sharma",
  handle: "@usharma",
  role: "Independent researcher",
  location: "Science Rebirth",
  bio:
    "Building Science Rebirth and Symposium as a living public structure for serious inquiry, objections, forks, and proof-of-work.",
  proof: ["Dialogues started: 8", "Objections logged: 27", "Saved artifacts: 18"],
  fields: ["Metascience", "Physics", "AI for science", "Institution design"]
} satisfies ResearchProfile;

export const profilesByName: Record<string, ResearchProfile> = {
  [profile.name]: profile,
  "Mira Sato": {
    name: "Mira Sato",
    handle: "@mira_sato",
    role: "Benchmark designer",
    location: "Metascience Working Notes",
    bio:
      "Designs blind rediscovery tasks and critique protocols for AI-assisted scientific exploration.",
    proof: ["Protocols drafted: 5", "Open objections answered: 18", "Forks adopted: 3"],
    fields: ["AI agents", "Metascience", "Benchmarks", "Epistemology"]
  },
  "Elena Voss": {
    name: "Elena Voss",
    handle: "@e_voss",
    role: "Historian of discovery",
    location: "History of Discovery",
    bio:
      "Studies anomaly survival, prepared minds, and the institutional conditions that let strange results stay alive.",
    proof: ["Case maps: 14", "Counterexamples logged: 31", "Archived failures: 22"],
    fields: ["History of science", "Institutions", "Anomalies", "Discovery"]
  },
  "Leah K.": {
    name: "Leah K.",
    handle: "@leahk",
    role: "Critic-engine researcher",
    location: "Independent review room",
    bio: "Works on critique architectures, failure modes, and review systems for live inquiry.",
    proof: ["Critiques posted: 42", "Test designs: 6", "Useful objections: 17"],
    fields: ["Critique", "Evaluation", "AI systems", "Review"]
  },
  "N. Arvind": {
    name: "N. Arvind",
    handle: "@narvind",
    role: "Methods skeptic",
    location: "Library upper floor",
    bio: "Focuses on leakage, denominator problems, and whether beautiful protocols survive contact with reality.",
    proof: ["Leakage audits: 9", "Replications checked: 12", "Methods notes: 21"],
    fields: ["Methods", "Statistics", "Replication", "Benchmarks"]
  },
  Amara: {
    name: "Amara",
    handle: "@amara",
    role: "Product theorist",
    location: "Symposium room",
    bio: "Explores how public interfaces can show the motion of an idea without flattening it into popularity.",
    proof: ["Design notes: 26", "Lineage maps: 8", "Dialogue reviews: 11"],
    fields: ["Product", "Dialogue", "Lineage", "Status"]
  },
  Jules: {
    name: "Jules",
    handle: "@jules",
    role: "Interaction designer",
    location: "Main hall",
    bio: "Designs serious tools that keep structure without becoming dead administrative software.",
    proof: ["Prototype passes: 13", "UX warnings: 19", "Room studies: 4"],
    fields: ["Interaction design", "Tools", "Research UX", "Worldbuilding"]
  },
  "Rahul M.": {
    name: "Rahul M.",
    handle: "@rahulm",
    role: "Historical methods critic",
    location: "Library tables",
    bio: "Keeps discovery stories honest by asking where the failures, denominators, and counterexamples went.",
    proof: ["Counterexample lists: 7", "Historical audits: 15", "Saved threads: 24"],
    fields: ["History", "Methods", "Failure archives", "Institutions"]
  },
  "Celia Noor": {
    name: "Celia Noor",
    handle: "@celianoor",
    role: "Research systems analyst",
    location: "Amphitheater",
    bio: "Studies apparatus, specialization, and why some kinds of ambition are expensive before they are unfashionable.",
    proof: ["System notes: 18", "Objections sharpened: 29", "Field maps: 6"],
    fields: ["Research systems", "Specialization", "Infrastructure", "Ambition"]
  },
  "M. Iqbal": {
    name: "M. Iqbal",
    handle: "@miqbal",
    role: "Institution builder",
    location: "Rogue youth labs",
    bio: "Works on practical conditions where talented young researchers can build artifacts instead of waiting for permission.",
    proof: ["Pilot proposals: 3", "Advisor protocols: 5", "Proof logs: 16"],
    fields: ["Youth labs", "Institution design", "Proof-of-work", "Mentorship"]
  },
  "AI tablet": {
    name: "AI tablet",
    handle: "@symposium_tablet",
    role: "Site assistant",
    location: "Every room",
    bio:
      "A contextual assistant that helps readers find objections, next tests, forks, and saved work inside the current room.",
    proof: ["Context lenses: 5", "Prompt stacks: 14", "Notebook assists: 9"],
    fields: ["Assistance", "Search", "Critique", "Synthesis"]
  },
  Self: profile
};

export const getProfileForName = (name: string): ResearchProfile =>
  profilesByName[name] ?? {
    name,
    handle: `@${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    role: "Symposium participant",
    location: "Public rooms",
    bio: "A participant in the current inquiry thread.",
    proof: ["Comments: visible", "Room presence: active", "Profile: mock"],
    fields: ["Inquiry", "Critique", "Discussion"]
  };

export const inquiryItems: InquiryItem[] = [
  {
    id: "cheap-exploration",
    kind: "paper",
    room: "library",
    title: "Cheap exploration, expensive truth",
    author: "Mira Sato",
    affiliation: "Metascience Working Notes",
    date: "Today",
    status: "Needs Experiment",
    metrics: { endorsements: "412", reshares: "58", saves: "129", views: "18.4k" },
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
    metrics: { endorsements: "771", reshares: "146", saves: "244", views: "31.9k" },
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
    metrics: { endorsements: "236", reshares: "42", saves: "88", views: "9.6k" },
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
    metrics: { endorsements: "1.8k", reshares: "391", saves: "522", views: "74.2k" },
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
    metrics: { endorsements: "94", reshares: "12", saves: "41", views: "2.1k" },
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
    metrics: { endorsements: "63", reshares: "9", saves: "57", views: "1.4k" },
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

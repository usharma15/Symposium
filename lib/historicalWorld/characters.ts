import type { ResearchProfileContract } from "@/packages/contracts/src";

const disclosure = (name: string) =>
  `Source-informed historical simulation. Posts and comments are newly authored for the Symposium demonstration; they are not authentic quotations from ${name}.`;

const portrait = (url: string) => url;

const profile = (
  person: Omit<ResearchProfileContract, "actorKind" | "disclosure" | "likesPublic" | "resharesPublic">
): ResearchProfileContract => ({
  ...person,
  actorKind: "historical_simulation",
  disclosure: disclosure(person.name),
  likesPublic: true,
  resharesPublic: true
});

export const historicalProfiles: ResearchProfileContract[] = [
  profile({
    name: "Plato", handle: "@plato", role: "Philosopher of dialogue, knowledge, and political order", location: "The Academy · Athens",
    lifeDates: "c. 428/427–348/347 BCE", era: "Classical Greece",
    bio: "Writes through scenes rather than manifestos: a question is tested by speakers whose vanity, courage, appetite, and intelligence matter as much as the propositions. Here he watches modern institutions for the distance between the good they praise and the incentives they build.",
    fields: ["Ethics", "Political philosophy", "Epistemology", "Dialogue", "Education"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Plato_Silanion_Musei_Capitolini_MC1377.png/330px-Plato_Silanion_Musei_Capitolini_MC1377.png"),
    sourceUrl: "https://plato.stanford.edu/entries/plato/"
  }),
  profile({
    name: "Aristotle", handle: "@aristotle", role: "Natural philosopher and classifier of causes", location: "The Lyceum · Athens",
    lifeDates: "384–322 BCE", era: "Classical Greece",
    bio: "Begins from distinctions, specimens, and the stubborn variety of things. His posts separate capacities from activities, causes from correlations, and the rhetoric of explanation from explanation itself—then ask what observation would force the taxonomy to change.",
    fields: ["Logic", "Biology", "Memory", "Ethics", "Natural philosophy"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Aristotle_Altemps_Inv8575.jpg/330px-Aristotle_Altemps_Inv8575.jpg"),
    sourceUrl: "https://plato.stanford.edu/entries/aristotle/"
  }),
  profile({
    name: "Albert Einstein", handle: "@einstein", role: "Theoretical physicist", location: "Institute for Advanced Study · Princeton",
    lifeDates: "1879–1955", era: "Modern physics",
    bio: "Looks for principles strong enough to make apparently unrelated observations inevitable. He is impatient with fashionable obscurity, suspicious of completeness claims, and unusually willing to turn an objection into a decades-long research programme.",
    fields: ["Relativity", "Statistical physics", "Quantum foundations", "Scientific institutions"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Albert_Einstein_Head_cleaned.jpg/330px-Albert_Einstein_Head_cleaned.jpg"),
    sourceUrl: "https://einsteinpapers.press.princeton.edu/"
  }),
  profile({
    name: "Werner Heisenberg", handle: "@heisenberg", role: "Theoretical physicist of observables", location: "Quantum Foundations",
    lifeDates: "1901–1976", era: "Modern physics",
    bio: "Treats the measurable relation as the proper starting point and asks which familiar pictures survive after unobservable machinery is removed. Precise in technical disputes, dryly amused when metaphors are mistaken for calculations.",
    fields: ["Quantum mechanics", "Matrix mechanics", "Measurement", "Nuclear physics"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Werner_Heisenberg_Portrait_%283x4_cropped%29.jpg/330px-Werner_Heisenberg_Portrait_%283x4_cropped%29.jpg"),
    sourceUrl: "https://www.nobelprize.org/prizes/physics/1932/heisenberg/biographical/"
  }),
  profile({
    name: "John Stewart Bell", handle: "@john_bell", role: "Physicist of locality and quantum foundations", location: "CERN Theory Division",
    lifeDates: "1928–1990", era: "Modern physics",
    bio: "Prefers a clean theorem to a fog of interpretive loyalties. He reads every claim for the assumption doing the hidden work and has little patience for the idea that foundational questions become unserious merely because the predictions succeed.",
    fields: ["Quantum foundations", "Locality", "Hidden variables", "Quantum field theory"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/John_bell_2_%28cropped%29.png/330px-John_bell_2_%28cropped%29.png"),
    sourceUrl: "https://sis.web.cern.ch/archives/CERN_archive/guide/theory/isabell"
  }),
  profile({
    name: "Richard Feynman", handle: "@feynman", role: "Theoretical physicist and relentless explainer", location: "Caltech · Blackboard corridor",
    lifeDates: "1918–1988", era: "Modern physics",
    bio: "Tests understanding by rebuilding the idea in plain language, pictures, and calculations that can fail. Playful in the Amphitheatre, exacting in technical threads, and openly hostile to explanations that survive only because nobody asks what they predict.",
    fields: ["Quantum mechanics", "Path integrals", "Electrodynamics", "Computation", "Teaching"],
    avatarUrl: portrait("https://commons.wikimedia.org/wiki/Special:Redirect/file/Richard_Feynman.png?width=330"),
    sourceUrl: "https://www.nobelprize.org/prizes/physics/1965/feynman/biographical/"
  }),
  profile({
    name: "Kurt Gödel", handle: "@godel", role: "Logician of formal systems", location: "Institute for Advanced Study · Logic table",
    lifeDates: "1906–1978", era: "Mathematical logic",
    bio: "Writes infrequently and with unnerving precision. He distinguishes truth from derivability, system from interpretation, and a limit proved inside mathematics from the sweeping cultural metaphors people attach to it afterward.",
    fields: ["Mathematical logic", "Incompleteness", "Foundations", "Philosophy of mathematics"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/4/42/Kurt_g%C3%B6del.jpg"),
    sourceUrl: "https://plato.stanford.edu/entries/goedel/"
  }),
  profile({
    name: "John Nash", handle: "@john_nash", role: "Mathematician of strategy and equilibrium", location: "Princeton · Games table",
    lifeDates: "1928–2015", era: "Modern mathematics",
    bio: "Reduces strategic noise to the smallest structure that still constrains every participant. His comments are spare, often arriving after everyone else has confused equilibrium with goodness, stability, cooperation, or prediction.",
    fields: ["Game theory", "Equilibrium", "Geometry", "Partial differential equations"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/John_Forbes_Nash%2C_Jr._by_Peter_Badge.jpg/330px-John_Forbes_Nash%2C_Jr._by_Peter_Badge.jpg"),
    sourceUrl: "https://www.nobelprize.org/prizes/economic-sciences/1994/nash/facts/"
  }),
  profile({
    name: "Lise Meitner", handle: "@lise_meitner", role: "Physicist of radioactivity and nuclear transformation", location: "Experimental Physics · Stockholm correspondence desk",
    lifeDates: "1878–1968", era: "Modern physics",
    bio: "Moves between experimental detail and theoretical interpretation without confusing either for the whole discovery. She is attentive to evidence, collaboration, credit, exile, and the moral burden created when a physical explanation becomes a weapon.",
    fields: ["Nuclear physics", "Radioactivity", "Fission", "Scientific credit", "Research ethics"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Lise_Meitner_NatGeo.jpg/330px-Lise_Meitner_NatGeo.jpg"),
    sourceUrl: "https://www.atomicheritage.org/profile/lise-meitner"
  }),
  profile({
    name: "Otto Robert Frisch", handle: "@otto_frisch", role: "Experimental physicist and interpreter of fission", location: "Nuclear Physics · Instrument bench",
    lifeDates: "1904–1979", era: "Modern physics",
    bio: "Likes decisive experiments, compact names, and calculations that tell an experimentalist what signal to seek. In joint threads with Meitner he is a collaborator with his own judgment, not a decorative second author.",
    fields: ["Nuclear physics", "Fission", "Experimental design", "Particle physics"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Otto_Frisch_Los_Alamos_ID_badge_photo.jpg/330px-Otto_Frisch_Los_Alamos_ID_badge_photo.jpg"),
    sourceUrl: "https://www.atomicarchive.com/resources/biographies/frisch.html"
  }),
  profile({
    name: "James Watson", handle: "@james_watson", role: "Molecular biologist", location: "Molecular Structure table",
    lifeDates: "1928–2025", era: "Molecular biology",
    bio: "Represented here for the 1953 model of DNA and the competitive culture around it. The profile also records, rather than hides, the racist claims that led scientific institutions to condemn and strip later honours; historical importance is not moral immunity.",
    fields: ["Molecular biology", "Genetics", "DNA structure", "Scientific institutions"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/James_D._Watson_LCCN2007680359.jpg/330px-James_D._Watson_LCCN2007680359.jpg"),
    sourceUrl: "https://www.nobelprize.org/prizes/medicine/1962/watson/facts/"
  }),
  profile({
    name: "Francis Crick", handle: "@francis_crick", role: "Molecular biologist and theorist", location: "Molecular Structure table",
    lifeDates: "1916–2004", era: "Molecular biology",
    bio: "Builds bold structural models, then asks what molecular mechanism they imply. More expansive than Watson in discussion and particularly interested in the bridge from a physical arrangement to information, replication, and biological function.",
    fields: ["Molecular biology", "DNA", "Genetic code", "Neuroscience"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Francis_Crick_crop.jpg/330px-Francis_Crick_crop.jpg"),
    sourceUrl: "https://www.nobelprize.org/prizes/medicine/1962/crick/biographical/"
  }),
  profile({
    name: "Rosalind Franklin", handle: "@rosalind_franklin", role: "Chemist and X-ray crystallographer", location: "Molecular Structure · Diffraction room",
    lifeDates: "1920–1958", era: "Molecular biology",
    bio: "Treats molecular structure as something earned from difficult experimental evidence. Her activity centres diffraction, measurement, the A and B forms of DNA, and the institutional conditions under which data, interpretation, and credit moved between laboratories.",
    fields: ["X-ray crystallography", "DNA", "Viruses", "Physical chemistry", "Scientific credit"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Rosalind_Franklin_%281920-1958%29.jpg/330px-Rosalind_Franklin_%281920-1958%29.jpg"),
    sourceUrl: "https://profiles.nlm.nih.gov/spotlight/kr"
  }),
  profile({
    name: "Niccolò Machiavelli", handle: "@machiavelli", role: "Analyst of power, institutions, and political necessity", location: "The Polis · Florence desk",
    lifeDates: "1469–1527", era: "Italian Renaissance",
    bio: "Reads public virtue alongside the incentives and coercive capacities that sustain it. He is less interested in announcing cynicism than in showing founders where excellent intentions become helpless without offices, loyalties, timing, and force.",
    fields: ["Political power", "Institutions", "Republics", "Leadership", "War"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Portrait_of_Niccol%C3%B2_Machiavelli_by_Santi_di_Tito.jpg/330px-Portrait_of_Niccol%C3%B2_Machiavelli_by_Santi_di_Tito.jpg"),
    sourceUrl: "https://plato.stanford.edu/entries/machiavelli/"
  }),
  profile({
    name: "Benjamin Franklin", handle: "@ben_franklin", role: "Printer, experimenter, diplomat, and civic mechanic", location: "Civic Workshop · Philadelphia",
    lifeDates: "1706–1790", era: "Enlightenment",
    bio: "Collects practical observations, small experiments, useful institutions, weather notes, jokes, and schemes for mutual improvement. He posts often, writes clearly, and regards a good civic idea as unfinished until ordinary people can operate it.",
    fields: ["Electricity", "Civic institutions", "Printing", "Diplomacy", "Weather"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Joseph_Siffrein_Duplessis_-_Benjamin_Franklin_-_Google_Art_Project.jpg/330px-Joseph_Siffrein_Duplessis_-_Benjamin_Franklin_-_Google_Art_Project.jpg"),
    sourceUrl: "https://www.loc.gov/collections/benjamin-franklin-papers/about-this-collection/"
  }),
  profile({
    name: "Adam Smith", handle: "@adam_smith", role: "Moral philosopher of commercial society", location: "Political Economy · Glasgow table",
    lifeDates: "1723–1790", era: "Scottish Enlightenment",
    bio: "Studies markets inside a larger moral psychology of sympathy, status, persuasion, prudence, and institutional rules. He regularly objects when admirers reduce his work to greed with good public relations.",
    fields: ["Political economy", "Moral philosophy", "Institutions", "Division of labour"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Adam_Smith_The_Muir_portrait.jpg/330px-Adam_Smith_The_Muir_portrait.jpg"),
    sourceUrl: "https://plato.stanford.edu/entries/smith-moral-political/"
  }),
  profile({
    name: "Andrew Carnegie", handle: "@andrew_carnegie", role: "Industrialist and builder of public institutions", location: "Industry and Patronage desk",
    lifeDates: "1835–1919", era: "Industrial age",
    bio: "Argues from scale, management, libraries, and the obligations attached to concentrated wealth. Other characters press him on labour, inequality, and whether philanthropy repairs or merely decorates the power that produced the fortune.",
    fields: ["Industry", "Philanthropy", "Libraries", "Management", "Patronage"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Andrew_Carnegie%2C_by_Theodore_Marceau_%28cropped%29_%282%29.jpg/330px-Andrew_Carnegie%2C_by_Theodore_Marceau_%28cropped%29_%282%29.jpg"),
    sourceUrl: "https://www.loc.gov/pictures/item/2004672084/"
  }),
  profile({
    name: "Napoleon Bonaparte", handle: "@napoleon", role: "Commander, administrator, and imperial strategist", location: "Strategy Gallery",
    lifeDates: "1769–1821", era: "Revolutionary and Napoleonic Europe",
    bio: "Thinks in tempo, logistics, morale, maps, law, and the administrative machinery that lets ambition travel. His certainty creates lively threads; Caesar and Machiavelli are usually nearby to ask what happens after the victory bulletin.",
    fields: ["Strategy", "Logistics", "Administration", "Law", "Leadership"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Jacques-Louis_David_-_The_Emperor_Napoleon_in_His_Study_at_the_Tuileries_-_Google_Art_Project.jpg/330px-Jacques-Louis_David_-_The_Emperor_Napoleon_in_His_Study_at_the_Tuileries_-_Google_Art_Project.jpg"),
    sourceUrl: "https://www.napoleon.org/en/"
  }),
  profile({
    name: "Julius Caesar", handle: "@julius_caesar", role: "General, politician, and author of campaigns", location: "The Polis · Roman bench",
    lifeDates: "100–44 BCE", era: "Late Roman Republic",
    bio: "Writes with controlled brevity and a commander's eye for sequence, supply, coalition, and public narrative. He notices who receives grammatical agency in every account of a victory—and who has disappeared into the passive voice.",
    fields: ["Military strategy", "Roman politics", "Rhetoric", "Administration"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Retrato_de_Julio_C%C3%A9sar_%2826724093101%29_%28cropped%29.jpg/330px-Retrato_de_Julio_C%C3%A9sar_%2826724093101%29_%28cropped%29.jpg"),
    sourceUrl: "https://penelope.uchicago.edu/Thayer/E/Roman/Texts/Caesar/home.html"
  }),
  profile({
    name: "Diogenes", handle: "@diogenes", role: "Cynic philosopher and public nuisance", location: "Amphitheatre steps",
    lifeDates: "c. 412/404–323 BCE", era: "Classical Greece",
    bio: "Uses jokes, refusals, and public inconvenience to expose the distance between a stated value and a lived appetite. He roasts freely, but the better posts contain a moral test rather than merely an insult.",
    fields: ["Cynicism", "Ethics", "Freedom", "Public performance", "Roast battles"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Diogenes_Mosaic_R%C3%B6misch-Germanisches_Museum.jpg/330px-Diogenes_Mosaic_R%C3%B6misch-Germanisches_Museum.jpg"),
    sourceUrl: "https://plato.stanford.edu/entries/diogenes/"
  }),
  profile({
    name: "Alcibiades", handle: "@alcibiades", role: "Athenian politician, general, and spectacular liability", location: "The Polis · wherever the attention is",
    lifeDates: "c. 450–404 BCE", era: "Classical Greece",
    bio: "Brilliant, charismatic, vain, strategically gifted, and almost constitutionally unable to leave politics unpersonalised. His activity supplies charm, reversals, sports talk, apologies that are not quite apologies, and excellent material for Socrates.",
    fields: ["Politics", "Strategy", "Rhetoric", "Athletics", "Reputation"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Detail_of_Alcibiades_from_Alcibiades_Being_Taught_by_Socrates_%281776%29_by_Fran%C3%A7ois-Andr%C3%A9_Vincent.jpg/330px-Detail_of_Alcibiades_from_Alcibiades_Being_Taught_by_Socrates_%281776%29_by_Fran%C3%A7ois-Andr%C3%A9_Vincent.jpg"),
    sourceUrl: "https://www.britannica.com/biography/Alcibiades-Athenian-politician-and-general"
  }),
  profile({
    name: "Virgil", handle: "@virgil", role: "Poet of exile, empire, labour, and destiny", location: "Poetry and Meaning",
    lifeDates: "70–19 BCE", era: "Augustan Rome",
    bio: "Not merely an imperial laureate: his posts hear loss beneath public triumph, labour beneath landscape, and the private cost inside a civilisational mission. Usually quieter than Homer and more troubled by the ending.",
    fields: ["Epic", "Pastoral", "Empire", "Exile", "Agriculture"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Virgil_mosaic_in_the_Bardo_National_Museum_%28Tunis%29_%2812241228546%29.jpg/330px-Virgil_mosaic_in_the_Bardo_National_Museum_%28Tunis%29_%2812241228546%29.jpg"),
    sourceUrl: "https://www.poetryfoundation.org/poets/virgil"
  }),
  profile({
    name: "Homer", handle: "@homer", role: "Epic poet of wrath, return, honour, and endurance", location: "Poetry and Meaning · fireside",
    lifeDates: "fl. late 8th or early 7th century BCE", era: "Archaic Greece",
    bio: "Turns arguments into scenes of pride, hospitality, violence, weather, hunger, grief, and recognition. His activity is concrete and oral: a memorable image first, the theory arriving later in someone else's comment.",
    fields: ["Epic poetry", "War", "Homecoming", "Oral tradition", "Storytelling"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Homer_At_the_British_Museum_2024_%283x4_cropped%29.jpg/330px-Homer_At_the_British_Museum_2024_%283x4_cropped%29.jpg"),
    sourceUrl: "https://www.britannica.com/biography/Homer-Greek-poet"
  }),
  profile({
    name: "William Shakespeare", handle: "@shakespeare", role: "Playwright, poet, and collector of human self-deception", location: "Poetry and Meaning · tiring-house door",
    lifeDates: "1564–1616", era: "English Renaissance",
    bio: "Moves between high argument and pub-grade mischief without announcing the transition. He posts scenes, voices, jokes, and compact observations about ambition, jealousy, performance, weather, money, and the stories people tell to remain innocent in their own plots.",
    fields: ["Drama", "Poetry", "Character", "Politics", "Comedy"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/William_Shakespeare_by_John_Taylor%2C_edited.jpg/330px-William_Shakespeare_by_John_Taylor%2C_edited.jpg"),
    sourceUrl: "https://www.folger.edu/explore/shakespeares-works/"
  }),
  profile({
    name: "Friedrich Nietzsche", handle: "@nietzsche", role: "Philosopher and genealogist of values", location: "Poetry and Meaning · mountain path",
    lifeDates: "1844–1900", era: "Nineteenth-century philosophy",
    bio: "Diagnoses the needs concealed inside moral and intellectual postures. His better contributions are psychological and genealogical rather than a vending machine for slogans; other characters challenge his theatre, his politics, and his treatment of ordinary dependence.",
    fields: ["Genealogy", "Morality", "Culture", "Tragedy", "Psychology"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Nietzsche187a.jpg/330px-Nietzsche187a.jpg"),
    sourceUrl: "https://plato.stanford.edu/entries/nietzsche/"
  }),
  profile({
    name: "Martin Heidegger", handle: "@heidegger", role: "Philosopher of being, time, and technology", location: "Poetry and Meaning · Black Forest desk",
    lifeDates: "1889–1976", era: "Twentieth-century philosophy",
    bio: "Asks how a world becomes intelligible before it becomes an inventory of objects. His activity also carries an explicit historical burden: the simulation does not evade his membership in the Nazi Party or turn obscurity into absolution.",
    fields: ["Ontology", "Phenomenology", "Technology", "Time", "Poetry"],
    avatarUrl: portrait("https://commons.wikimedia.org/wiki/Special:Redirect/file/1920%E5%B9%B4%E4%BB%A3%E7%9A%84%E6%B5%B7%E5%BE%B7%E6%A0%BC%E5%B0%94.jpg?width=330"),
    sourceUrl: "https://plato.stanford.edu/entries/heidegger/"
  }),
  profile({
    name: "Fyodor Dostoevsky", handle: "@dostoevsky", role: "Novelist of freedom, guilt, faith, and humiliation", location: "Poetry and Meaning · late-night table",
    lifeDates: "1821–1881", era: "Nineteenth-century literature",
    bio: "Places an idea inside a desperate person and waits to see what survives contact with shame, need, love, resentment, and freedom. He writes long comments, then occasionally ends an Amphitheatre thread with one painfully ordinary observation.",
    fields: ["Literature", "Moral psychology", "Freedom", "Faith", "Institutions"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Vasily_Perov_-_%D0%9F%D0%BE%D1%80%D1%82%D1%80%D0%B5%D1%82_%D0%A4.%D0%9C.%D0%94%D0%BE%D1%81%D1%82%D0%BE%D0%B5%D0%B2%D1%81%D0%BA%D0%BE%D0%B3%D0%BE_-_Google_Art_Project.jpg/330px-Vasily_Perov_-_%D0%9F%D0%BE%D1%80%D1%82%D1%80%D0%B5%D1%82_%D0%A4.%D0%9C.%D0%94%D0%BE%D1%81%D1%82%D0%BE%D0%B5%D0%B2%D1%81%D0%BA%D0%BE%D0%B3%D0%BE_-_Google_Art_Project.jpg"),
    sourceUrl: "https://www.britannica.com/biography/Fyodor-Dostoyevsky"
  }),
  profile({
    name: "Isaac Newton", handle: "@newton", role: "Mathematician and natural philosopher", location: "Mathematics and Natural Philosophy",
    lifeDates: "1643–1727", era: "Scientific Revolution",
    bio: "Looks for mathematical law beneath terrestrial and celestial motion, keeps extensive private notes, and does not confuse collaboration with sociability. Franklin teases him; Euler extends him; Einstein asks where the frame entered unnoticed.",
    fields: ["Mechanics", "Gravitation", "Optics", "Calculus", "Alchemy"],
    avatarUrl: portrait("https://commons.wikimedia.org/wiki/Special:Redirect/file/Portrait_of_Sir_Isaac_Newton,_1689.jpg?width=330"),
    sourceUrl: "https://cudl.lib.cam.ac.uk/collections/newton"
  }),
  profile({
    name: "Leonhard Euler", handle: "@euler", role: "Mathematician of analysis, mechanics, and notation", location: "Mathematics, Logic, and Games",
    lifeDates: "1707–1783", era: "Eighteenth-century mathematics",
    bio: "Prolific, constructive, and unusually good at making a new formal language usable by others. He responds to grand foundational disputes with a derivation, a notation improvement, or a problem simple enough to expose the hidden difficulty.",
    fields: ["Analysis", "Number theory", "Mechanics", "Graph theory", "Notation"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Leonhard_Euler_-_Jakob_Emanuel_Handmann_%28Kunstmuseum_Basel%29.jpg/330px-Leonhard_Euler_-_Jakob_Emanuel_Handmann_%28Kunstmuseum_Basel%29.jpg"),
    sourceUrl: "https://mathshistory.st-andrews.ac.uk/Biographies/Euler/"
  }),
  profile({
    name: "Socrates", handle: "@socrates", role: "Public questioner without a publication list", location: "The Agora · wherever certainty gathers",
    lifeDates: "c. 470–399 BCE", era: "Classical Greece",
    bio: "Owns no papers here and claims less knowledge than everyone else, which does not make conversation easier. He asks for definitions, follows consequences, notices evasions, and treats humiliation as a poor substitute for examined disagreement.",
    fields: ["Ethics", "Dialogue", "Definition", "Civic life", "Education"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Socrates_Louvre.jpg/330px-Socrates_Louvre.jpg"),
    sourceUrl: "https://plato.stanford.edu/entries/socrates/"
  }),
  profile({
    name: "Marie Curie", handle: "@marie_curie", role: "Physicist and chemist of radioactivity", location: "Experimental Physics · laboratory bench",
    lifeDates: "1867–1934", era: "Modern physics and chemistry",
    bio: "Brings experimental discipline, endurance, institutional building, and the bodily costs of research into a cast tempted by pure theory. She is particularly good in Patronage threads because apparatus, training, material, and access are never abstractions to her.",
    fields: ["Radioactivity", "Chemistry", "Experimental physics", "Laboratories", "Medical applications"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Marie_Curie_c._1920s.jpg/330px-Marie_Curie_c._1920s.jpg"),
    sourceUrl: "https://www.nobelprize.org/prizes/chemistry/1911/marie-curie/biographical/"
  }),
  profile({
    name: "Charles Darwin", handle: "@darwin", role: "Naturalist of variation, selection, and descent", location: "Mind, Memory, and Life · field notebook",
    lifeDates: "1809–1882", era: "Nineteenth-century natural history",
    bio: "Accumulates observations patiently, worries objections in private, and prefers a mechanism that explains messy variation to a perfect taxonomy imposed from above. Aristotle is both predecessor and favourite source of productive friction.",
    fields: ["Evolution", "Natural history", "Variation", "Selection", "Behaviour"],
    avatarUrl: portrait("https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Charles_Darwin_seated_crop.jpg/330px-Charles_Darwin_seated_crop.jpg"),
    sourceUrl: "https://darwin-online.org.uk/"
  }),
  profile({
    name: "John Maynard Keynes", handle: "@keynes", role: "Economist of uncertainty, demand, and public action", location: "Political Economy · Bloomsbury end",
    lifeDates: "1883–1946", era: "Twentieth-century economics",
    bio: "Treats economies as historical systems inhabited by uncertain people, fragile expectations, and institutions that can fail while everyone waits for adjustment. Smith respects the moral psychology; Carnegie dislikes the fiscal conclusions.",
    fields: ["Macroeconomics", "Uncertainty", "Employment", "Public finance", "Institutions"],
    avatarUrl: portrait("https://commons.wikimedia.org/wiki/Special:Redirect/file/John_Maynard_Keynes.jpg?width=330"),
    sourceUrl: "https://www.kings.cam.ac.uk/archive-centre/introduction-archives/john-maynard-keynes"
  })
];

export const historicalProfilesByName = Object.fromEntries(
  historicalProfiles.map((person) => [person.name, person])
) as Record<string, ResearchProfileContract>;

export const historicalProfilesByHandle = Object.fromEntries(
  historicalProfiles.map((person) => [person.handle, person])
) as Record<string, ResearchProfileContract>;

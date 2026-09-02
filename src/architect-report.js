const FLOOR_LABELS = ["Ground floor", "First floor", "Second floor"];

const AUTHORITY_REFERENCES = Object.freeze({
  Delhi: [
    {
      title: "Unified Building Bye-Laws for Delhi 2016 and notified modifications",
      authority: "Delhi Development Authority / authority having jurisdiction",
      url: "https://dda.gov.in/compendium-unified-building-bye-laws-ubbl-delhi-2016",
      use: "Confirm the current plot-category controls, submission route, setbacks, height, parking, fire/life-safety and completion requirements.",
    },
    {
      title: "Master Plan for Delhi 2021, incorporating published modifications",
      authority: "Delhi Development Authority",
      url: "https://dda.gov.in/master-plan",
      use: "Confirm land use, development controls, special-area conditions and any overlay affecting the site.",
    },
  ],
});

const NATIONAL_REFERENCES = Object.freeze([
  {
    title: "National Building Code of India — current adopted provisions",
    authority: "Bureau of Indian Standards",
    url: "https://www.bis.gov.in/standards/national-building-code/",
    use: "Use only through the editions and provisions adopted by the authority having jurisdiction; coordinate life safety, accessibility and building services.",
  },
  {
    title: "Eco-Niwas Samhita 2024 / current residential energy guidance",
    authority: "Bureau of Energy Efficiency",
    url: "https://beeindia.gov.in/",
    use: "Test envelope, shading, daylight, natural ventilation and thermal-performance decisions for the project climate.",
  },
]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function hasFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function integer(value, fallback, minimum, maximum) {
  if (typeof value === "string" && /^\d+\+$/u.test(value.trim())) {
    return Math.min(maximum, Math.max(minimum, Number.parseInt(value, 10)));
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function floorCountFrom(input, estimate) {
  return { G: 1, "G+1": 2, "G+2": 3 }[text(estimate?.floors || input?.floors)] || 2;
}

function floorLabel(index) {
  return FLOOR_LABELS[index] || `Level ${index + 1}`;
}

function roomDimensions(area, aspect = 1.35) {
  if (area < 35) return "Area pressure — architect to resize";
  const shortSide = Math.max(3, Math.round(Math.sqrt(area / aspect) * 2) / 2);
  const longSide = Math.max(shortSide, Math.round((area / shortSide) * 2) / 2);
  const show = (value) => Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `≈ ${show(shortSide)}′ × ${show(longSide)}′ clear starting point`;
}

function parkingLabel(value) {
  if (value === false || String(value || "").toLowerCase() === "none") return "No on-plot parking requested";
  if (value === true) return "On-plot parking requested; vehicle count not stated";
  return text(value, "Parking requirement not stated");
}

function accessibilityLabel(value) {
  return {
    none: "No special accessibility requirement stated",
    step_free: "Step-free primary route requested",
    wheelchair_ready: "Wheelchair-ready planning requested",
    unknown: "Accessibility requirement not confirmed",
  }[value] || "Accessibility requirement not confirmed";
}

function futureUseLabel(value) {
  return {
    none: "No separate future-use requirement stated",
    rental: "Future rental separation requested",
    home_office: "Home-office adaptability requested",
    vertical_expansion: "Future vertical expansion requested",
    unknown: "Future-use requirement not confirmed",
  }[value] || "Future-use requirement not confirmed";
}

function climateStrategies(city) {
  const common = [
    "Model daylight and glare before fixing window sizes; protect privacy without turning occupied rooms into permanently artificial-lit spaces.",
    "Keep the stair, toilets and service shafts vertically coordinated so structure and drainage do not consume usable rooms later.",
    "Resolve roof drainage, overflow paths, waterproofing upstands and maintenance access before the terrace layout is frozen.",
  ];
  const local = {
    Delhi: [
      "Test deep external shading and restrained west/south-west glazing for severe summer heat; retain winter-sun opportunities where privacy allows.",
      "Use a shaded, cross-ventilated plan with a dust-conscious filtered fresh-air strategy for periods when outdoor air is unsuitable.",
      "Coordinate roof insulation, cool/reflective finishes and shaded outdoor space as one heat-gain strategy.",
    ],
    Jaipur: [
      "Prioritise compact shaded massing, protected openings and thermal buffering on harsh west-facing edges.",
      "Test courtyards or shaded ventilation paths without creating exposed heat traps.",
    ],
    Mumbai: [
      "Prioritise cross-ventilation, driving-rain protection, corrosion-resistant external details and fast-draining thresholds.",
      "Keep service yards and wet façades maintainable in humid monsoon conditions.",
    ],
    Chennai: [
      "Prioritise shade, cross-ventilation, rain protection and low-heat-gain roof and wall assemblies.",
      "Confirm coastal corrosion exposure and flood/drainage levels for the actual site.",
    ],
    Bengaluru: [
      "Balance cross-ventilation and daylight with wind-driven rain protection and shaded afternoon openings.",
      "Use the verified contours and storm-water outfall—not the plot rectangle alone—to set finished floor levels.",
    ],
    Pune: [
      "Use shaded openings and cross-ventilation while protecting monsoon-facing edges and external circulation.",
      "Verify slope, drainage route and summer west-sun exposure before fixing the ground-floor plate.",
    ],
    Hyderabad: [
      "Limit unshaded west glazing, use roof heat-gain control and retain effective cross-ventilation paths.",
      "Coordinate water storage and landscape demand with the verified municipal/borewell supply strategy.",
    ],
  }[city] || [
    "Have the architect classify the actual climate and exposure before fixing envelope, shading, ventilation and waterproofing details.",
    "Use verified contours, rainfall and drainage-outfall information to set the ground floor and site grading.",
  ];
  return [...local, ...common].map((intent, index) => ({ code: `CL-${String(index + 1).padStart(2, "0")}`, intent }));
}

function allocateRooms({ bedrooms, bathrooms, floorCount, targetBuiltUpSqft, accessibility }) {
  const upperPrimaryFloor = floorCount > 1 ? 1 : 0;
  const groundBedroom = floorCount > 1 && bedrooms >= 3;
  const rooms = [
    { name: "Entrance foyer", category: "Arrival", floorIndex: 0, weight: 3, aspect: 1.2, brief: "Create a privacy buffer between the front door and main living space." },
    { name: "Living room", category: "Social", floorIndex: 0, weight: 11, aspect: 1.45, brief: "Seat the family and guests without routing circulation through the furniture zone." },
    { name: "Dining area", category: "Social", floorIndex: 0, weight: 7, aspect: 1.3, brief: "Keep a direct kitchen relationship and a clear route to outdoor spill-out where site conditions support it." },
    { name: "Kitchen", category: "Service", floorIndex: 0, weight: 7, aspect: 1.25, brief: "Test counter runs, refrigerator, tall storage and a safe work triangle before wall positions are fixed." },
    { name: "Utility / wash", category: "Service", floorIndex: 0, weight: 3, aspect: 1.8, brief: "Provide ventilated laundry, sink and appliance points with a maintainable drain route." },
  ];

  for (let index = 0; index < bedrooms; index += 1) {
    let floorIndex = upperPrimaryFloor;
    if (index === bedrooms - 1 && groundBedroom) floorIndex = 0;
    else if (floorCount === 3 && index > 1) floorIndex = 2;
    const primary = index === 0;
    rooms.push({
      name: primary ? "Primary bedroom" : groundBedroom && index === bedrooms - 1 ? "Guest / elder bedroom" : `Bedroom ${index + 1}`,
      category: "Private",
      floorIndex,
      weight: primary ? 9 : 7,
      aspect: 1.25,
      brief: primary
        ? "Allow a full wardrobe wall and a bed circulation zone; coordinate the attached bathroom without exposing it to the sleeping area."
        : floorIndex === 0 && accessibility !== "none"
          ? "Keep this room on the step-free route and test wheelchair turning/transfer clearances if required."
          : "Allow bed, wardrobe and study use without blocking the window or primary circulation.",
    });
  }

  for (let index = 0; index < bathrooms; index += 1) {
    const attachedPrimary = index === 0;
    const floorIndex = floorCount === 1 ? 0 : index === bathrooms - 1 && groundBedroom ? 0 : Math.min(upperPrimaryFloor, floorCount - 1);
    rooms.push({
      name: attachedPrimary ? "Primary bathroom" : `Bathroom ${index + 1}`,
      category: "Wet area",
      floorIndex,
      weight: 2.6,
      aspect: 1.55,
      brief: "Test dry/wet separation, ventilation, waterproofing falls and a direct route to the common plumbing shaft.",
    });
  }

  if (floorCount > 1) {
    rooms.push(
      { name: "Family lounge / upper lobby", category: "Social", floorIndex: 1, weight: 7, aspect: 1.35, brief: "Use as a daylit distribution space; avoid an oversized corridor that adds cost without family use." },
      { name: "Stair and landings", category: "Circulation", floorIndex: 0, weight: 5, aspect: 1.8, brief: "Architect and structural engineer to fix clear width, headroom, risers, handrails and fire/life-safety requirements." },
    );
  }
  rooms.push(
    { name: "Puja / study / flexible nook", category: "Flexible", floorIndex: Math.min(upperPrimaryFloor, floorCount - 1), weight: 3, aspect: 1.2, brief: "Keep the use reversible until the family confirms the priority." },
    { name: "General storage", category: "Service", floorIndex: 0, weight: 2, aspect: 1.5, brief: "Reserve full-height storage outside bedroom wardrobes and away from damp service walls." },
    { name: floorCount > 1 ? "Balcony / covered spill-out" : "Covered verandah / spill-out", category: "Semi-open", floorIndex: floorCount > 1 ? 1 : 0, weight: 4, aspect: 2, brief: "Count and detail this area only after the architect confirms development-control treatment and weather exposure." },
  );

  const programmeNetSqft = Math.max(0, Math.min(targetBuiltUpSqft, Math.round((targetBuiltUpSqft * 0.76) / 5) * 5));
  const weightTotal = rooms.reduce((sum, room) => sum + room.weight, 0);
  let assigned = 0;
  const scheduled = rooms.map((room, index) => {
    const isLast = index === rooms.length - 1;
    const areaSqft = isLast
      ? Math.max(0, programmeNetSqft - assigned)
      : Math.max(0, Math.round(((programmeNetSqft * room.weight) / weightTotal) / 5) * 5);
    assigned += areaSqft;
    const categoryCode = { Arrival: "AR", Social: "SO", Service: "SV", Private: "PR", "Wet area": "WT", Circulation: "CR", Flexible: "FX", "Semi-open": "SE" }[room.category] || "RM";
    return {
      code: `${categoryCode}-${String(index + 1).padStart(2, "0")}`,
      name: room.name,
      category: room.category,
      floor: floorLabel(room.floorIndex),
      areaSqft,
      nominalDimensions: roomDimensions(areaSqft, room.aspect),
      brief: room.brief,
    };
  });
  return { rooms: scheduled, programmeNetSqft };
}

function floorStrategies({ floorCount, targetBuiltUpSqft, rooms }) {
  const base = Math.floor(targetBuiltUpSqft / floorCount);
  let remaining = targetBuiltUpSqft;
  return Array.from({ length: floorCount }, (_, index) => {
    const targetAreaSqft = index === floorCount - 1 ? remaining : base;
    remaining -= targetAreaSqft;
    const names = rooms.filter((room) => room.floor === floorLabel(index)).map((room) => room.name);
    const isGround = index === 0;
    const isTop = index === floorCount - 1;
    return {
      level: floorLabel(index),
      targetAreaSqft,
      spaces: names,
      zoningIntent: floorCount === 1
        ? "Keep arrival, social, private and service bands legible on one step-free circulation loop."
        : isGround
          ? "Prioritise arrival, shared living, kitchen/utility, parking interface and a flexible ground-floor bedroom where scheduled."
          : isTop
            ? "Keep the quieter family/private zone around a daylit landing and align wet areas with the floor below."
            : "Use this level primarily for private rooms, family lounge and vertically aligned wet/service cores.",
      coordinationHold: isGround
        ? "Do not freeze the footprint until verified setbacks, vehicle movement, finished floor level and stair geometry work together."
        : "Carry the structural grid, stair opening, plumbing shaft and façade openings from the coordinated floor below.",
    };
  });
}

function verificationRegister(input, estimate) {
  const knownRoad = hasFiniteNumber(input.roadWidthFt);
  const knownShape = ["regular", "irregular", "corner"].includes(input.plotShape);
  const knownAccess = ["North", "East", "South", "West"].includes(input.facing);
  const knownAccessibility = input.accessibility && input.accessibility !== "unknown";
  const knownFuture = input.futureUse && input.futureUse !== "unknown";
  const knownBudget = hasFiniteNumber(input.budgetLakh);
  return [
    ["VR-01", "Boundary, dimensions and levels", "Unverified", "Client-entered plot rectangle only", "Commission a total-station/measured survey with boundaries, spot levels, adjoining levels, trees, poles, drains and access obstructions.", "Licensed surveyor + architect", "Before concept plan freeze"],
    ["VR-02", "Title, plot identity and easements", "Not provided", "No title or cadastral evidence in GrihaGrid", "Architect/legal adviser to reconcile title, sanctioned layout, plot number, easements and rights of way.", "Owner + legal adviser", "Before statutory submission"],
    ["VR-03", "Road width and access", knownRoad ? "Client-stated" : "Missing", knownRoad ? `${input.roadWidthFt} ft entered` : "No measured road width", "Verify carriageway/right-of-way width, gate position, turning, fire access and any road-widening line on site and in authority records.", "Surveyor + architect", "Before site plan freeze"],
    ["VR-04", "Plot shape / corner condition", knownShape ? "Client-stated" : "Missing", knownShape ? text(input.plotShape) : "Unknown", "Overlay the measured boundary and applicable corner/splay or irregular-plot controls.", "Architect", "Before area statement"],
    ["VR-05", "Facing and road edge", knownAccess ? "Client-stated" : "Missing", knownAccess ? `${input.facing}-facing entry assumption` : "No cardinal edge confirmed", "Confirm true north, road-bearing edge, adjacent buildings and primary pedestrian/vehicle access.", "Surveyor + architect", "Before orientation study"],
    ["VR-06", "Development controls", "To verify", `${text(estimate.city || input.city, "City not stated")} city-level context only`, "Confirm authority, land use, plot category, FAR/FSI, coverage, setbacks, height, parking, fire and environmental provisions using current official records.", "Licensed local architect", "Before concept plan freeze"],
    ["VR-07", "Soil and foundations", "Not provided", "No geotechnical evidence", "Commission the geotechnical scope recommended by the structural engineer; foundation type and bearing assumptions remain open.", "Geotechnical + structural engineers", "Before foundation design"],
    ["VR-08", "Existing utilities and drainage", "Not provided", "No mapped water, sewer, storm-water or electrical points", "Locate connections, invert levels, outfall, meters, overhead lines and storage requirements.", "MEP consultant + architect", "Before services design"],
    ["VR-09", "Accessibility route", knownAccessibility ? "Client-stated" : "Missing", accessibilityLabel(input.accessibility), "Confirm doorway, ramp, lift, toilet, turning and transfer needs with the intended users; test against adopted accessibility provisions.", "Owner + architect", "Before plan freeze"],
    ["VR-10", "Future-use strategy", knownFuture ? "Client-stated" : "Missing", futureUseLabel(input.futureUse), "Confirm whether structure, services, access and metering must support the stated future use without unsafe later alterations.", "Owner + architect + engineers", "Before design development"],
    ["VR-11", "Budget alignment", knownBudget ? "Client-stated" : "Missing", knownBudget ? `₹${Number(input.budgetLakh).toLocaleString("en-IN")} lakh budget entered` : "No client budget entered", "Reconcile scope exclusions, professional fees, authority charges, taxes, external works, escalation and contingency against the planning range.", "Owner + architect / cost consultant", "Before design development"],
  ].map(([code, topic, status, evidence, action, owner, gate]) => ({ code, topic, status, evidence, action, owner, gate }));
}

function authorityReferences(city) {
  const local = AUTHORITY_REFERENCES[city] || [{
    title: "Current local development-control regulations and sanctioned development/master plan",
    authority: "Authority having jurisdiction",
    url: "",
    use: "The licensed local architect must identify and retrieve the current official instruments for the exact plot before relying on any control.",
  }];
  return [...local, ...NATIONAL_REFERENCES].map((reference, index) => ({ code: `RF-${String(index + 1).padStart(2, "0")}`, ...reference }));
}

export function buildArchitecturalHandoff(inputValue = {}, estimateValue = {}) {
  const input = inputValue && typeof inputValue === "object" && !Array.isArray(inputValue) ? inputValue : {};
  const estimate = estimateValue && typeof estimateValue === "object" && !Array.isArray(estimateValue) ? estimateValue : {};
  const floorCount = floorCountFrom(input, estimate);
  const bedrooms = integer(input.bedrooms, floorCount === 1 ? 2 : 3, 1, 10);
  const bathrooms = integer(input.bathrooms, Math.max(2, bedrooms), 1, 12);
  const widthFt = finiteNumber(input.width);
  const lengthFt = finiteNumber(input.length);
  const plotSqft = finiteNumber(estimate.plotSqft, Math.round(widthFt * lengthFt));
  const targetBuiltUpSqft = Math.round(finiteNumber(estimate.builtUpSqft));
  const workingFootprintSqft = floorCount ? Math.round(targetBuiltUpSqft / floorCount) : 0;
  const openGroundSqft = Math.max(0, Math.round(plotSqft - workingFootprintSqft));
  const { rooms, programmeNetSqft } = allocateRooms({ bedrooms, bathrooms, floorCount, targetBuiltUpSqft, accessibility: input.accessibility });
  const planningAllowanceSqft = Math.max(0, targetBuiltUpSqft - programmeNetSqft);
  const city = text(estimate.city || input.city, "City not stated");
  const facing = text(input.facing, "Not confirmed");
  const areaPressure = rooms.filter((room) => room.nominalDimensions.startsWith("Area pressure")).map((room) => room.name);
  const references = authorityReferences(city);

  return {
    version: 1,
    title: "Architect review pack",
    stage: "Concept-design handoff",
    purpose: "A coordinated client brief for architect review and professional development—not a measured, sanction, tender, structural or construction drawing set.",
    siteBrief: {
      widthFt,
      lengthFt,
      plotSqft,
      city,
      facing,
      accessEdge: facing === "Not confirmed" ? "Road-bearing edge not confirmed" : `${facing} edge assumed as the road / primary arrival side`,
      roadWidthFt: hasFiniteNumber(input.roadWidthFt) ? Number(input.roadWidthFt) : null,
      plotShape: text(input.plotShape, "unknown"),
      floors: text(estimate.floors || input.floors, floorCount === 1 ? "G" : `G+${floorCount - 1}`),
      floorCount,
      bedrooms,
      bathrooms,
      parking: parkingLabel(input.parking),
      accessibility: accessibilityLabel(input.accessibility),
      futureUse: futureUseLabel(input.futureUse),
      styleDirection: text(input.style, "Not stated"),
      finishLevel: text(estimate.quality || input.quality, "Not stated"),
      budgetLakh: hasFiniteNumber(input.budgetLakh) ? Number(input.budgetLakh) : null,
    },
    areaReconciliation: {
      plotSqft,
      workingFootprintSqft,
      openGroundSqft,
      workingCoveragePercent: plotSqft > 0 ? Math.round((workingFootprintSqft / plotSqft) * 1000) / 10 : 0,
      targetBuiltUpSqft,
      programmeNetSqft,
      planningAllowanceSqft,
      planningAllowancePercent: targetBuiltUpSqft > 0 ? Math.round((planningAllowanceSqft / targetBuiltUpSqft) * 1000) / 10 : 0,
      note: "The allowance holds internal walls, circulation not separately scheduled, shafts, structural zones and design development. It is not a statutory area statement.",
    },
    rooms,
    floorStrategies: floorStrategies({ floorCount, targetBuiltUpSqft, rooms }),
    adjacencyPriorities: [
      { pair: "Arrival ↔ living", priority: "Protect", reason: "Create a legible entry without exposing the full private interior from the front door." },
      { pair: "Living ↔ dining", priority: "Direct", reason: "Keep shared family use connected while allowing furniture zones to remain clear of through-circulation." },
      { pair: "Dining ↔ kitchen", priority: "Direct", reason: "Shorten serving movement and preserve the option to visually close the kitchen." },
      { pair: "Kitchen ↔ utility / service edge", priority: "Direct", reason: "Keep laundry, refuse, gas/induction and maintenance movement out of the main arrival route." },
      { pair: "Bedrooms ↔ bathrooms", priority: "Short / private", reason: "Avoid bathroom doors opening directly to dining/living areas and align wet walls vertically." },
      { pair: "Stair ↔ daylit lobby", priority: "Visible / safe", reason: "Make vertical movement intuitive without using the stair as a dark residual shaft." },
      { pair: "Parking ↔ entrance", priority: "Weather-protected", reason: "Separate pedestrian safety from vehicle turning and keep the principal door usable when a car is parked." },
    ],
    climateStrategies: climateStrategies(city),
    structureAndServices: [
      { code: "SS-01", system: "Structural grid", intent: "Test a regular column/wall grid that respects parking, room proportions and façade openings.", coordination: "Structural engineer to issue the design basis, framing scheme and member sizes after soil and architectural plans are fixed." },
      { code: "SS-02", system: "Stair / vertical circulation", intent: "Hold one coordinated vertical opening with safe landings, headroom and handrails; reserve lift provision only if the brief requires it.", coordination: "Architect to test adopted code; structural engineer to coordinate openings and support." },
      { code: "SS-03", system: "Water and plumbing", intent: "Stack bathrooms near a maintainable shaft; keep kitchen/utility drainage short and provide accessible isolation points.", coordination: "MEP consultant to confirm supply, storage, hot water, venting, pipe sizes, slopes and connection levels." },
      { code: "SS-04", system: "Storm water / rainwater", intent: "Grade roofs and hardscape to visible, maintainable drainage paths with overflow protection.", coordination: "Architect/MEP consultant to size collection, recharge/harvesting and lawful outfall after rainfall and site levels are verified." },
      { code: "SS-05", system: "Electrical / data", intent: "Reserve meter, main panel, inverter/backup, earthing, data and future-load locations outside wet or obstructed zones.", coordination: "Electrical consultant to prepare load schedule, single-line diagram, protection, earthing and point layouts." },
      { code: "SS-06", system: "Cooling and ventilation", intent: "Prioritise shaded natural ventilation, then coordinate equipment and condensate without damaging façades or wet areas.", coordination: "Architect/MEP consultant to confirm heat-load assumptions, fresh air, exhaust, outdoor units and maintenance access." },
      { code: "SS-07", system: "Life safety", intent: "Keep a continuous, well-lit escape route and avoid unprotected hazards on the path to the final exit.", coordination: "Licensed professionals to apply the requirements adopted for the exact occupancy, height, area and jurisdiction." },
    ],
    verificationRegister: verificationRegister(input, estimate),
    drawingRegister: [
      { code: "DR-01", deliverable: "Measured survey and existing-site drawing", scale: "Typically 1:100 / 1:200", purpose: "Authoritative boundary, north, levels, road, neighbours, trees, utilities and constraints." },
      { code: "DR-02", deliverable: "Statutory control and area statement", scale: "Authority format", purpose: "Plot-category controls, setbacks, coverage, FAR/FSI, height, parking and area definitions with source clauses." },
      { code: "DR-03", deliverable: "Coordinated floor plans", scale: "Typically 1:100, then 1:50", purpose: "Dimensioned walls, openings, furniture, levels, circulation, shafts and room tags based on this schedule." },
      { code: "DR-04", deliverable: "Roof plan, sections and elevations", scale: "Typically 1:100 / 1:50", purpose: "Heights, daylight, shading, drainage, parapets, façade intent and vertical coordination." },
      { code: "DR-05", deliverable: "Door, window, finish and fixture schedules", scale: "Schedule / details", purpose: "Performance, sizes, quantities, hardware, waterproofing interfaces and maintainable specifications." },
      { code: "DR-06", deliverable: "Structural design and drawings", scale: "Engineer issue", purpose: "Design basis, foundations, framing, reinforcement and construction sequencing signed by the structural engineer." },
      { code: "DR-07", deliverable: "MEP coordination drawings", scale: "Typically 1:50 + schematics", purpose: "Water, drainage, electrical, earthing, cooling/ventilation, fire/life-safety and equipment access." },
      { code: "DR-08", deliverable: "Sanction / tender / construction issue sets", scale: "As required", purpose: "Separate controlled issues prepared, checked and signed by the responsible licensed professionals." },
    ],
    references,
    reviewNotes: [
      "Every dimension in the room schedule is a proportional starting point derived from the target built-up area, not a measured or code-certified dimension.",
      "The architect should preserve the brief intent, reconcile it against the verified site and current controls, and record every departure in the next revision.",
      "Do not begin structural, service, procurement or construction work from this pack.",
      ...(areaPressure.length ? [`Area pressure is visible in: ${areaPressure.join(", ")}. These spaces must be resized before concept approval.`] : []),
    ],
  };
}

function cleanStringList(value, maximum = 32) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).slice(0, maximum) : [];
}

function cleanObjectList(value, maximum = 64) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(0, maximum) : [];
}

export function normalizeArchitecturalHandoff(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Number(value.version) !== 1) return null;
  const siteBrief = value.siteBrief && typeof value.siteBrief === "object" && !Array.isArray(value.siteBrief) ? value.siteBrief : null;
  const areaReconciliation = value.areaReconciliation && typeof value.areaReconciliation === "object" && !Array.isArray(value.areaReconciliation) ? value.areaReconciliation : null;
  if (!siteBrief || !areaReconciliation) return null;
  return {
    version: 1,
    title: text(value.title, "Architect review pack"),
    stage: text(value.stage, "Concept-design handoff"),
    purpose: text(value.purpose),
    siteBrief: { ...siteBrief },
    areaReconciliation: { ...areaReconciliation },
    rooms: cleanObjectList(value.rooms),
    floorStrategies: cleanObjectList(value.floorStrategies, 8),
    adjacencyPriorities: cleanObjectList(value.adjacencyPriorities, 24),
    climateStrategies: cleanObjectList(value.climateStrategies, 24),
    structureAndServices: cleanObjectList(value.structureAndServices, 24),
    verificationRegister: cleanObjectList(value.verificationRegister, 32),
    drawingRegister: cleanObjectList(value.drawingRegister, 24),
    references: cleanObjectList(value.references, 16),
    reviewNotes: cleanStringList(value.reviewNotes, 16),
  };
}

export function publicArchitecturalProgramme(value) {
  const source = normalizeArchitecturalHandoff(value);
  if (!source) return null;
  const site = source.siteBrief;
  return {
    version: 1,
    purpose: source.purpose,
    siteBrief: {
      widthFt: finiteNumber(site.widthFt),
      lengthFt: finiteNumber(site.lengthFt),
      plotSqft: finiteNumber(site.plotSqft),
      city: text(site.city),
      facing: text(site.facing),
      accessEdge: text(site.accessEdge),
      roadWidthFt: hasFiniteNumber(site.roadWidthFt) ? finiteNumber(site.roadWidthFt) : null,
      plotShape: text(site.plotShape),
      floors: text(site.floors),
      floorCount: finiteNumber(site.floorCount),
      bedrooms: finiteNumber(site.bedrooms),
      bathrooms: finiteNumber(site.bathrooms),
      parking: text(site.parking),
      accessibility: text(site.accessibility),
      futureUse: text(site.futureUse),
      finishLevel: text(site.finishLevel),
      budgetLakh: hasFiniteNumber(site.budgetLakh) ? finiteNumber(site.budgetLakh) : null,
    },
    areaReconciliation: {
      plotSqft: finiteNumber(source.areaReconciliation.plotSqft),
      workingFootprintSqft: finiteNumber(source.areaReconciliation.workingFootprintSqft),
      openGroundSqft: finiteNumber(source.areaReconciliation.openGroundSqft),
      workingCoveragePercent: finiteNumber(source.areaReconciliation.workingCoveragePercent),
      targetBuiltUpSqft: finiteNumber(source.areaReconciliation.targetBuiltUpSqft),
      programmeNetSqft: finiteNumber(source.areaReconciliation.programmeNetSqft),
      planningAllowanceSqft: finiteNumber(source.areaReconciliation.planningAllowanceSqft),
      planningAllowancePercent: finiteNumber(source.areaReconciliation.planningAllowancePercent),
      note: text(source.areaReconciliation.note),
    },
    rooms: source.rooms.map(({ code, name, category, floor, areaSqft, nominalDimensions, brief }) => ({ code, name, category, floor, areaSqft, nominalDimensions, brief })),
    floorStrategies: source.floorStrategies.map(({ level, targetAreaSqft, spaces, zoningIntent, coordinationHold }) => ({ level, targetAreaSqft, spaces: cleanStringList(spaces), zoningIntent, coordinationHold })),
    adjacencyPriorities: source.adjacencyPriorities.map(({ pair, priority, reason }) => ({ pair, priority, reason })),
    climateStrategies: source.climateStrategies.map(({ code, intent }) => ({ code, intent })),
    structureAndServices: source.structureAndServices.map(({ code, system, intent, coordination }) => ({ code, system, intent, coordination })),
    verificationRegister: source.verificationRegister.map(({ code, topic, status, evidence, action, owner, gate }) => ({ code, topic, status, evidence, action, owner, gate })),
    drawingRegister: source.drawingRegister.map(({ code, deliverable, scale, purpose }) => ({ code, deliverable, scale, purpose })),
    references: source.references.map(({ code, title, authority, url, use }) => ({ code, title, authority, url, use })),
    reviewNotes: source.reviewNotes,
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildArchitecturalHandoff,
  normalizeArchitecturalHandoff,
  publicArchitecturalProgramme,
} from "../src/architect-report.js";

const input = {
  width: 30,
  length: 50,
  city: "Delhi",
  facing: "East",
  floors: "G+1",
  bedrooms: 3,
  bathrooms: 3,
  parking: "1 car",
  style: "Warm modern",
  quality: "Signature",
  roadWidthFt: 30,
  plotShape: "regular",
  accessibility: "step_free",
  futureUse: "none",
  budgetLakh: 55,
};

const estimate = {
  city: "Delhi",
  floors: "G+1",
  quality: "Signature",
  plotSqft: 1_500,
  builtUpSqft: 1_830,
};

test("architect handoff is deterministic, detailed, and arithmetically reconciled", () => {
  const first = buildArchitecturalHandoff(input, estimate);
  const second = buildArchitecturalHandoff(structuredClone(input), structuredClone(estimate));
  assert.deepEqual(first, second);
  assert.equal(first.version, 1);
  assert.equal(first.stage, "Concept-design handoff");
  assert.equal(first.siteBrief.city, "Delhi");
  assert.equal(first.siteBrief.bedrooms, 3);
  assert.equal(first.siteBrief.accessibility, "Step-free primary route requested");
  assert.equal(first.areaReconciliation.workingFootprintSqft, 915);
  assert.equal(first.areaReconciliation.openGroundSqft, 585);
  assert.equal(
    first.areaReconciliation.programmeNetSqft + first.areaReconciliation.planningAllowanceSqft,
    first.areaReconciliation.targetBuiltUpSqft,
  );
  assert.equal(
    first.rooms.reduce((sum, room) => sum + room.areaSqft, 0),
    first.areaReconciliation.programmeNetSqft,
  );
  assert.equal(first.floorStrategies.reduce((sum, floor) => sum + floor.targetAreaSqft, 0), 1_830);
  assert.ok(first.rooms.length >= 15);
  assert.ok(first.verificationRegister.length >= 10);
  assert.ok(first.structureAndServices.length >= 7);
  assert.ok(first.drawingRegister.length >= 8);
  assert.ok(first.references.some((reference) => /Unified Building Bye-Laws for Delhi/iu.test(reference.title)));
  assert.ok(first.references.every((reference) => /verify|confirm|test|identify|use only/iu.test(reference.use)));
});

test("architect handoff keeps claims reviewable and never presents the pack as a drawing approval", () => {
  const pack = buildArchitecturalHandoff(input, estimate);
  const serialized = JSON.stringify(pack);
  assert.match(serialized, /not a measured, sanction, tender, structural or construction drawing set/iu);
  assert.match(serialized, /not a statutory area statement/iu);
  assert.match(serialized, /geotechnical/iu);
  assert.match(serialized, /licensed local architect/iu);
  assert.match(serialized, /do not begin structural, service, procurement or construction work/iu);
  assert.doesNotMatch(serialized, /sanction approved|code compliant|construction ready|guaranteed feasible/iu);
});

test("public architect programme excludes free-text style and remains bounded", () => {
  const privateInput = {
    ...input,
    style: "Owner Name owner@example.test private note",
  };
  const publicPack = publicArchitecturalProgramme(buildArchitecturalHandoff(privateInput, estimate));
  const serialized = JSON.stringify(publicPack);
  assert.equal(serialized.includes("Owner Name"), false);
  assert.equal(serialized.includes("owner@example.test"), false);
  assert.equal(serialized.includes("private note"), false);
  assert.equal(Object.hasOwn(publicPack.siteBrief, "styleDirection"), false);
  assert.ok(publicPack.rooms.length <= 64);
  assert.ok(publicPack.references.length <= 16);
  assert.equal(normalizeArchitecturalHandoff(publicPack)?.siteBrief.city, "Delhi");
  const injected = buildArchitecturalHandoff(privateInput, estimate);
  injected.areaReconciliation.privateAddress = "SECRET AREA FIELD";
  injected.rooms[0].privateAddress = "SECRET ROOM FIELD";
  assert.doesNotMatch(JSON.stringify(publicArchitecturalProgramme(injected)), /SECRET (?:AREA|ROOM) FIELD/u);
});

test("unknown evidence stays missing instead of becoming an optimistic default", () => {
  const pack = buildArchitecturalHandoff({
    width: 20,
    length: 30,
    city: "Other",
    floors: "G",
    bedrooms: 2,
    bathrooms: null,
    parking: false,
    roadWidthFt: null,
    plotShape: "unknown",
    accessibility: "unknown",
    futureUse: "unknown",
    budgetLakh: null,
  }, {
    city: "Other",
    floors: "G",
    quality: "Essential",
    plotSqft: 600,
    builtUpSqft: 432,
  });
  assert.equal(pack.siteBrief.roadWidthFt, null);
  assert.equal(pack.siteBrief.budgetLakh, null);
  assert.equal(pack.siteBrief.parking, "No on-plot parking requested");
  for (const topic of ["Road width and access", "Plot shape / corner condition", "Accessibility route", "Future-use strategy", "Budget alignment"]) {
    assert.equal(pack.verificationRegister.find((item) => item.topic === topic)?.status, "Missing", topic);
  }
  assert.match(pack.references[0].use, /must identify and retrieve the current official instruments/iu);
});

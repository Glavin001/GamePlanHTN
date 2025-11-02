import { test } from "uvu";
import * as assert from "uvu/assert";
import DecompositionStatus from "../../../src/decompositionStatus";
import { createFpsCombatDomain, createFpsContext } from "./fpsCombatDomain";

function planNames(plan: Array<{ Name: string }>): string[] {
  return plan.map((task) => task.Name);
}

test("Prefers retreat when health critical", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    Health: 10,
    EnemyDistance: 15,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), ["RetreatToCover", "ApplyMedkit"]);
});

test("Advances to range before shooting", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 0,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    EnemyDistance: 55,
    CurrentWeaponRange: 30,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "ConfirmLineOfSight",
    "ConfirmPrimaryWeapon",
    "AdvanceIntoRange",
    "FirePrimaryWeapon",
  ]);
});

test("Fetches weapon before engaging", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    HasRangedWeapon: 0,
    KnownWeaponAvailable: 1,
    EnemyDistance: 60,
    EnemyObstructed: 0,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "ConfirmLineOfSight",
    "MoveToWeaponCache",
    "PickupWeapon",
    "AdvanceIntoRange",
    "FirePrimaryWeapon",
  ]);
});

test("Falls back to melee when unarmed", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    HasRangedWeapon: 0,
    KnownWeaponAvailable: 0,
    EnemyObstructed: 0,
    EnemyDistance: 40,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "ConfirmLineOfSight",
    "CloseDistanceForMelee",
    "MeleeStrike",
  ]);
});

test("Destroys cover with rocket then fires rifle", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 1,
    CoverDestructible: 1,
    RocketLauncherAvailable: 1,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    CurrentWeaponRange: 35,
    EnemyDistance: 35,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "MoveToRocketCache",
    "EquipRocketLauncher",
    "FireRocketAtCover",
    "ConfirmPrimaryWeapon",
    "HoldPositionForShot",
    "FirePrimaryWeapon",
  ]);
});

test("Uses vehicle breach and finishes with melee", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 1,
    RocketLauncherAvailable: 0,
    VehicleAvailable: 1,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    CurrentWeaponRange: 20,
    EnemyDistance: 50,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "MoveToVehicle",
    "EnterVehicle",
    "DriveThroughCover",
    "ExitVehicleAfterBreach",
    "CloseDistanceForMelee",
    "MeleeStrike",
  ]);
});

test.run();

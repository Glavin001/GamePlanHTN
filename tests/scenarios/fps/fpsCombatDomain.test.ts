import { test } from "uvu";
import * as assert from "uvu/assert";
import DecompositionStatus from "../../../src/decompositionStatus";
import { createFpsCombatDomain, createFpsContext } from "./fpsCombatDomain";

function planNames(plan: Array<{ Name: string }>): string[] {
  return plan.map((task) => task.Name);
}

test("Retreat uses carried medkit", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    Health: 10,
    EnemyDistance: 15,
    MedkitInInventory: 1,
    MedkitAvailable: 0,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), ["RetreatToCover", "UseCarriedMedkit"]);
});

test("Retrieves medkit before healing", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    Health: 8,
    EnemyDistance: 18,
    MedkitInInventory: 0,
    MedkitAvailable: 1,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), ["RetreatToCover", "MoveToMedkitCache", "CollectMedkit", "ApplyMedkit"]);
});

test("Holds defensive position when no medkit available", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    Health: 12,
    MedkitInInventory: 0,
    MedkitAvailable: 0,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), ["RetreatToCover", "HoldDefensivePosition"]);
});

test("Advances to range before shooting", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 0,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    EnemyDistance: 55,
    CurrentWeaponRange: 30,
    PrimaryWeaponAmmo: 3,
    GrenadeCount: 0,
    GrenadeAvailable: 0,
    GrenadeCacheAvailable: 0,
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

test("Reloads rifle before firing", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 0,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    EnemyDistance: 50,
    CurrentWeaponRange: 30,
    PrimaryWeaponAmmo: 0,
    SpareAmmoClips: 1,
    GrenadeCount: 0,
    GrenadeCacheAvailable: 0,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "ConfirmLineOfSight",
    "ReloadPrimaryWeapon",
    "AdvanceIntoRange",
    "FirePrimaryWeapon",
  ]);
});

test("Resupplies from ammo cache when empty", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 0,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    EnemyDistance: 60,
    CurrentWeaponRange: 30,
    PrimaryWeaponAmmo: 0,
    SpareAmmoClips: 0,
    AmmoCacheAvailable: 1,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "ConfirmLineOfSight",
    "MoveToAmmoCache",
    "CollectAmmoClips",
    "ReloadPrimaryWeaponFromCache",
    "AdvanceIntoRange",
    "FirePrimaryWeapon",
  ]);
});

test("Uses sidearm when rifle dry", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 0,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    EnemyDistance: 8,
    PrimaryWeaponAmmo: 0,
    SpareAmmoClips: 0,
    AmmoCacheAvailable: 0,
    HasSidearm: 1,
    SidearmAmmo: 2,
    GrenadeCount: 0,
    GrenadeCacheAvailable: 0,
    GrenadeAvailable: 0,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "ConfirmLineOfSight",
    "ConfirmSidearmReady",
    "FireSidearmBurst",
  ]);
});

test("Reloads sidearm before use", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 0,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    EnemyDistance: 8,
    PrimaryWeaponAmmo: 0,
    SpareAmmoClips: 0,
    AmmoCacheAvailable: 0,
    HasSidearm: 1,
    SidearmAmmo: 0,
    SidearmClips: 1,
    GrenadeCount: 0,
    GrenadeCacheAvailable: 0,
    GrenadeAvailable: 0,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "ConfirmLineOfSight",
    "ReloadSidearm",
    "FireSidearmBurst",
  ]);
});

test("Destroys cover with grenade in hand", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 1,
    CoverDestructible: 1,
    GrenadeCount: 1,
    GrenadeAvailable: 0,
    GrenadeCacheAvailable: 0,
    RocketLauncherAvailable: 0,
    RocketCacheAmmo: 0,
    HasRocketLauncher: 0,
    VehicleAvailable: 0,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    PrimaryWeaponAmmo: 2,
    CurrentWeaponRange: 30,
    EnemyDistance: 20,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "ConfirmGrenadeReadyForCover",
    "ThrowGrenadeAtCover",
    "ConfirmPrimaryWeapon",
    "HoldPositionForShot",
    "FirePrimaryWeapon",
  ]);
});

test("Fetches grenades to clear cover", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 1,
    CoverDestructible: 1,
    GrenadeCount: 0,
    GrenadeAvailable: 0,
    GrenadeCacheAvailable: 1,
    GrenadeCacheStock: 2,
    RocketLauncherAvailable: 0,
    RocketCacheAmmo: 0,
    HasRocketLauncher: 0,
    VehicleAvailable: 0,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    PrimaryWeaponAmmo: 2,
    CurrentWeaponRange: 30,
    EnemyDistance: 20,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "MoveToGrenadeCache",
    "CollectGrenades",
    "ThrowGrenadeAtCover",
    "ConfirmPrimaryWeapon",
    "HoldPositionForShot",
    "FirePrimaryWeapon",
  ]);
});

test("Resupplies rocket ammo before breaching", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 1,
    CoverDestructible: 1,
    HasRocketLauncher: 1,
    RocketAmmo: 0,
    RocketCacheAmmo: 2,
    RocketLauncherAvailable: 0,
    VehicleAvailable: 0,
    GrenadeCount: 0,
    GrenadeCacheAvailable: 0,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    PrimaryWeaponAmmo: 3,
    CurrentWeaponRange: 35,
    EnemyDistance: 35,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "ReturnToRocketCache",
    "ResupplyRocketAmmo",
    "FireRocketAtCover",
    "ConfirmPrimaryWeapon",
    "HoldPositionForShot",
    "FirePrimaryWeapon",
  ]);
});

test("Flanks when no destruction options remain", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 1,
    CoverDestructible: 1,
    RocketLauncherAvailable: 0,
    RocketCacheAmmo: 0,
    HasRocketLauncher: 0,
    GrenadeCount: 0,
    GrenadeAvailable: 0,
    GrenadeCacheAvailable: 0,
    VehicleAvailable: 0,
    AlternateVantageAvailable: 1,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    PrimaryWeaponAmmo: 3,
    CurrentWeaponRange: 30,
    EnemyDistance: 50,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "MoveToFlankingPosition",
    "ConfirmPrimaryWeapon",
    "HoldPositionForShot",
    "FirePrimaryWeapon",
  ]);
});

test("Prefers grenade assault on exposed enemy", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 0,
    GrenadeCount: 1,
    GrenadeAvailable: 0,
    GrenadeCacheAvailable: 0,
    EnemyDistance: 12,
    GrenadeEffectiveRange: 20,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    PrimaryWeaponAmmo: 3,
  });

  const { status, plan } = domain.findPlan(context);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(planNames(plan), [
    "ConfirmLineOfSight",
    "ConfirmGrenadeReady",
    "ThrowGrenadeAtEnemy",
  ]);
});

test("Destroys cover with rocket then fires rifle", () => {
  const domain = createFpsCombatDomain();
  const context = createFpsContext({
    EnemyObstructed: 1,
    CoverDestructible: 1,
    RocketLauncherAvailable: 1,
    HasRocketLauncher: 0,
    RocketCacheAmmo: 1,
    VehicleAvailable: 0,
    GrenadeCount: 0,
    GrenadeCacheAvailable: 0,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    PrimaryWeaponAmmo: 2,
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
    CoverDestructible: 1,
    RocketLauncherAvailable: 0,
    RocketCacheAmmo: 0,
    HasRocketLauncher: 0,
    VehicleAvailable: 1,
    HasRangedWeapon: 1,
    KnownWeaponAvailable: 0,
    CurrentWeaponRange: 20,
    PrimaryWeaponAmmo: 2,
    EnemyDistance: 50,
    GrenadeCount: 0,
    GrenadeCacheAvailable: 0,
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
    GrenadeCount: 0,
    GrenadeCacheAvailable: 0,
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

test.run();

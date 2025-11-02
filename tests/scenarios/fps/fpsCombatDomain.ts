import Context from "../../../src/context";
import Domain from "../../../src/domain";
import DomainBuilder from "../../../src/domainBuilder";
import EffectType, { type EffectTypeValue } from "../../../src/effectType";
import TaskStatus from "../../../src/taskStatus";

export type LocationId =
  | "spawn"
  | "fallback_cover"
  | "armory"
  | "rocket_cache"
  | "garage"
  | "enemy_post"
  | "flank_route";

export type FpsWorldState = {
  Health: number;
  MaxHealth: number;
  CriticalHealthThreshold: number;
  EnemyVisible: number;
  EnemyNeutralized: number;
  EnemyObstructed: number;
  EnemyCoverIntegrity: number;
  CoverDestructible: number;
  CloseQuartersAdvantage: number;
  EnemyDistance: number;
  PreferredEngagementDistance: number;
  MeleeRange: number;
  FlankEngagementDistance: number;
  AgentPosition: LocationId;
  CoverPosition: LocationId;
  EnemyPosition: LocationId;
  KnownVantageLocation: LocationId;
  KnownWeaponLocation: LocationId;
  KnownWeaponAvailable: number;
  KnownWeaponRange: number;
  HasRangedWeapon: number;
  CurrentWeaponRange: number;
  RocketLauncherAvailable: number;
  HasRocketLauncher: number;
  RocketAmmo: number;
  RocketCacheAmmo: number;
  KnownRocketLocation: LocationId;
  VehicleAvailable: number;
  VehicleLocation: LocationId;
  HasVehicle: number;
  IsInVehicle: number;
  AlternateVantageAvailable: number;
};

export type FpsContext = Context<FpsWorldState>;

const DEFAULT_STATE: FpsWorldState = {
  Health: 100,
  MaxHealth: 100,
  CriticalHealthThreshold: 30,
  EnemyVisible: 1,
  EnemyNeutralized: 0,
  EnemyObstructed: 0,
  EnemyCoverIntegrity: 1,
  CoverDestructible: 1,
  CloseQuartersAdvantage: 0,
  EnemyDistance: 25,
  PreferredEngagementDistance: 18,
  MeleeRange: 3,
  FlankEngagementDistance: 15,
  AgentPosition: "spawn",
  CoverPosition: "fallback_cover",
  EnemyPosition: "enemy_post",
  KnownVantageLocation: "flank_route",
  KnownWeaponLocation: "armory",
  KnownWeaponAvailable: 1,
  KnownWeaponRange: 40,
  HasRangedWeapon: 1,
  CurrentWeaponRange: 30,
  RocketLauncherAvailable: 0,
  HasRocketLauncher: 0,
  RocketAmmo: 0,
  RocketCacheAmmo: 1,
  KnownRocketLocation: "rocket_cache",
  VehicleAvailable: 0,
  VehicleLocation: "garage",
  HasVehicle: 0,
  IsInVehicle: 0,
  AlternateVantageAvailable: 1,
};

function planEffect<K extends keyof FpsWorldState>(
  context: FpsContext,
  key: K,
  value: FpsWorldState[K],
  effectType?: EffectTypeValue | null,
): void {
  context.setState(key, value, false, effectType ?? EffectType.PlanOnly);
}

export function createFpsContext(overrides: Partial<FpsWorldState> = {}): FpsContext {
  const context = new Context<FpsWorldState>({
    ...DEFAULT_STATE,
    ...overrides,
  });

  context.init();

  return context;
}

export function createFpsCombatDomain(): Domain<FpsContext> {
  const builder = new DomainBuilder<FpsContext>("FPS Combat Domain");

  builder
    .select("FPS Priorities")
      .sequence("StabilizeWhenCritical")
        .condition("Health below threshold", (context) =>
          (context.getState("Health") as number) <= (context.getState("CriticalHealthThreshold") as number),
        )
        .action("RetreatToCover")
          .do(() => TaskStatus.Success)
          .effect("Move to cover", EffectType.PlanOnly, (context, effectType) => {
            planEffect(context, "AgentPosition", context.getState("CoverPosition"), effectType);
            // Retreat increases distance from the threat.
            const distance = (context.getState("EnemyDistance") as number) + 10;
            planEffect(context, "EnemyDistance", distance, effectType);
            planEffect(context, "CloseQuartersAdvantage", 0, effectType);
          })
        .end()
        .action("ApplyMedkit")
          .do(() => TaskStatus.Success)
          .effect("Restore health", EffectType.PlanOnly, (context, effectType) => {
            planEffect(context, "Health", context.getState("MaxHealth"), effectType);
          })
        .end()
      .end()
      .sequence("EngageKnownEnemy")
        .condition("Enemy visible", (context) => context.hasState("EnemyVisible", 1))
        .condition("Enemy not neutralized", (context) => context.hasState("EnemyNeutralized", 0))
        .select("ResolveObstruction")
          .sequence("LineOfSightAlreadyClear")
            .condition("No obstruction", (context) => context.hasState("EnemyObstructed", 0))
            .action("ConfirmLineOfSight")
              .do(() => TaskStatus.Success)
            .end()
          .end()
          .sequence("DestroyCoverWithRocket")
            .condition("Obstruction present", (context) => context.hasState("EnemyObstructed", 1))
            .condition("Cover is destructible", (context) => context.hasState("CoverDestructible", 1))
            .condition("Rocket option available", (context) => {
              const hasRocket = context.hasState("HasRocketLauncher", 1) && (context.getState("RocketAmmo") as number) > 0;
              return hasRocket || context.hasState("RocketLauncherAvailable", 1);
            })
            .select("EnsureRocketLauncher")
              .sequence("AlreadyCarryingRocket")
                .condition("Rocket equipped", (context) => context.hasState("HasRocketLauncher", 1))
                .condition("Rocket ammo loaded", (context) => (context.getState("RocketAmmo") as number) > 0)
                .action("ReadyRocketLauncher")
                  .do(() => TaskStatus.Success)
                .end()
              .end()
              .sequence("CollectRocketLauncher")
                .condition("Rocket cache known", (context) => context.hasState("RocketLauncherAvailable", 1))
                .action("MoveToRocketCache")
                  .do(() => TaskStatus.Success)
                  .effect("Navigate to rocket cache", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "AgentPosition", context.getState("KnownRocketLocation"), effectType);
                  })
                .end()
                .action("EquipRocketLauncher")
                  .do(() => TaskStatus.Success)
                  .effect("Gain rocket launcher", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "HasRocketLauncher", 1, effectType);
                    planEffect(context, "RocketAmmo", context.getState("RocketCacheAmmo") as number, effectType);
                    planEffect(context, "RocketLauncherAvailable", 0, effectType);
                  })
                .end()
              .end()
            .end()
            .action("FireRocketAtCover")
              .condition("Rocket ready", (context) => (context.getState("RocketAmmo") as number) > 0)
              .do(() => TaskStatus.Success)
              .effect("Destroy obstruction", EffectType.PlanOnly, (context, effectType) => {
                const remaining = Math.max(0, (context.getState("RocketAmmo") as number) - 1);
                planEffect(context, "RocketAmmo", remaining, effectType);
                planEffect(context, "EnemyObstructed", 0, effectType);
                planEffect(context, "EnemyCoverIntegrity", 0, effectType);
                planEffect(context, "CloseQuartersAdvantage", 0, effectType);
              })
            .end()
          .end()
          .sequence("BreachWithVehicle")
            .condition("Obstruction present", (context) => context.hasState("EnemyObstructed", 1))
            .condition("Vehicle path available", (context) =>
              context.hasState("VehicleAvailable", 1) || context.hasState("IsInVehicle", 1),
            )
            .select("EnsureVehicle")
              .sequence("AlreadyInVehicle")
                .condition("In vehicle", (context) => context.hasState("IsInVehicle", 1))
                .action("ConfirmVehicleReady")
                  .do(() => TaskStatus.Success)
                .end()
              .end()
              .sequence("AcquireVehicle")
                .condition("Vehicle present", (context) => context.hasState("VehicleAvailable", 1))
                .action("MoveToVehicle")
                  .do(() => TaskStatus.Success)
                  .effect("Approach vehicle", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "AgentPosition", context.getState("VehicleLocation"), effectType);
                  })
                .end()
                .action("EnterVehicle")
                  .do(() => TaskStatus.Success)
                  .effect("Board vehicle", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "HasVehicle", 1, effectType);
                    planEffect(context, "IsInVehicle", 1, effectType);
                  })
                .end()
              .end()
            .end()
            .action("DriveThroughCover")
              .do(() => TaskStatus.Success)
              .effect("Vehicle breach", EffectType.PlanOnly, (context, effectType) => {
                planEffect(context, "EnemyObstructed", 0, effectType);
                planEffect(context, "EnemyCoverIntegrity", 0, effectType);
                planEffect(context, "CloseQuartersAdvantage", 1, effectType);
                planEffect(context, "EnemyDistance", context.getState("MeleeRange") as number, effectType);
                planEffect(context, "AgentPosition", context.getState("EnemyPosition"), effectType);
                planEffect(context, "VehicleAvailable", 0, effectType);
              })
            .end()
            .action("ExitVehicleAfterBreach")
              .do(() => TaskStatus.Success)
              .effect("Dismount vehicle", EffectType.PlanOnly, (context, effectType) => {
                planEffect(context, "IsInVehicle", 0, effectType);
                planEffect(context, "HasVehicle", 0, effectType);
              })
            .end()
          .end()
          .sequence("FlankObstruction")
            .condition("Obstruction present", (context) => context.hasState("EnemyObstructed", 1))
            .condition("Flank route known", (context) => context.hasState("AlternateVantageAvailable", 1))
            .action("MoveToFlankingPosition")
              .do(() => TaskStatus.Success)
              .effect("Gain clear shot", EffectType.PlanOnly, (context, effectType) => {
                planEffect(context, "AgentPosition", context.getState("KnownVantageLocation"), effectType);
                planEffect(context, "EnemyDistance", context.getState("FlankEngagementDistance") as number, effectType);
                planEffect(context, "EnemyObstructed", 0, effectType);
                planEffect(context, "CloseQuartersAdvantage", 0, effectType);
              })
            .end()
          .end()
        .end()
        .utilitySelect("ChooseAttackMode")
          .sequence("RangedEngagementPlan")
            .utility((context) => (context.hasState("CloseQuartersAdvantage", 1) ? 25 : 100))
            .condition("Ranged option possible", (context) =>
              context.hasState("HasRangedWeapon", 1) || context.hasState("KnownWeaponAvailable", 1),
            )
            .select("EnsurePrimaryWeapon")
              .sequence("WeaponReady")
                .condition("Already armed", (context) => context.hasState("HasRangedWeapon", 1))
                .action("ConfirmPrimaryWeapon")
                  .do(() => TaskStatus.Success)
                .end()
              .end()
              .sequence("RetrieveNearbyWeapon")
                .condition("Weapon cached", (context) => context.hasState("KnownWeaponAvailable", 1))
                .action("MoveToWeaponCache")
                  .do(() => TaskStatus.Success)
                  .effect("Travel to weapon cache", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "AgentPosition", context.getState("KnownWeaponLocation"), effectType);
                    planEffect(context, "EnemyDistance", (context.getState("EnemyDistance") as number) + 5, effectType);
                  })
                .end()
                .action("PickupWeapon")
                  .do(() => TaskStatus.Success)
                  .effect("Equip weapon", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "HasRangedWeapon", 1, effectType);
                    planEffect(context, "CurrentWeaponRange", context.getState("KnownWeaponRange") as number, effectType);
                    planEffect(context, "KnownWeaponAvailable", 0, effectType);
                  })
                .end()
              .end()
            .end()
            .select("ReachEffectiveRange")
              .sequence("AlreadyWithinRange")
                .condition("Within weapon range", (context) =>
                  (context.getState("EnemyDistance") as number) <= (context.getState("CurrentWeaponRange") as number),
                )
                .action("HoldPositionForShot")
                  .do(() => TaskStatus.Success)
                .end()
              .end()
              .sequence("AdvanceIntoRange")
                .action("AdvanceIntoRange")
                  .do(() => TaskStatus.Success)
                  .effect("Close distance", EffectType.PlanOnly, (context, effectType) => {
                    const preferred = context.getState("PreferredEngagementDistance") as number;
                    const maxRange = context.getState("CurrentWeaponRange") as number;
                    const newDistance = Math.min(preferred, maxRange);
                    planEffect(context, "EnemyDistance", newDistance, effectType);
                    planEffect(context, "CloseQuartersAdvantage", newDistance <= (context.getState("MeleeRange") as number) ? 1 : 0, effectType);
                  })
                .end()
              .end()
            .end()
            .action("FirePrimaryWeapon")
              .condition("Still armed", (context) => context.hasState("HasRangedWeapon", 1))
              .do(() => TaskStatus.Success)
              .effect("Neutralize enemy at range", EffectType.PlanOnly, (context, effectType) => {
                planEffect(context, "EnemyNeutralized", 1, effectType);
              })
            .end()
          .end()
          .sequence("CloseQuartersAssault")
            .utility((context) => (context.hasState("CloseQuartersAdvantage", 1) ? 120 : 40))
            .action("CloseDistanceForMelee")
              .do(() => TaskStatus.Success)
              .effect("Rush enemy", EffectType.PlanOnly, (context, effectType) => {
                planEffect(context, "EnemyDistance", context.getState("MeleeRange") as number, effectType);
                planEffect(context, "CloseQuartersAdvantage", 1, effectType);
              })
            .end()
            .action("MeleeStrike")
              .do(() => TaskStatus.Success)
              .effect("Finish enemy up close", EffectType.PlanOnly, (context, effectType) => {
                planEffect(context, "EnemyNeutralized", 1, effectType);
              })
            .end()
          .end()
        .end()
      .end()
    .end();

  return builder.build();
}

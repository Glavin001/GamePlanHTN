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
  | "flank_route"
  | "medbay"
  | "ammo_cache"
  | "grenade_locker";

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
  PrimaryWeaponAmmo: number;
  PrimaryWeaponClipSize: number;
  SpareAmmoClips: number;
  AmmoCacheAvailable: number;
  AmmoCacheLocation: LocationId;
  AmmoClipRestockAmount: number;
  HasSidearm: number;
  SidearmRange: number;
  SidearmAmmo: number;
  SidearmClipSize: number;
  SidearmClips: number;
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
  MedkitAvailable: number;
  MedkitInInventory: number;
  MedkitLocation: LocationId;
  GrenadeCount: number;
  GrenadeAvailable: number;
  GrenadeEffectiveRange: number;
  GrenadeCacheAvailable: number;
  GrenadeCacheLocation: LocationId;
  GrenadeCacheStock: number;
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
  PrimaryWeaponAmmo: 5,
  PrimaryWeaponClipSize: 5,
  SpareAmmoClips: 1,
  AmmoCacheAvailable: 0,
  AmmoCacheLocation: "ammo_cache",
  AmmoClipRestockAmount: 2,
  HasSidearm: 1,
  SidearmRange: 12,
  SidearmAmmo: 3,
  SidearmClipSize: 3,
  SidearmClips: 1,
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
  MedkitAvailable: 1,
  MedkitInInventory: 0,
  MedkitLocation: "medbay",
  GrenadeCount: 0,
  GrenadeAvailable: 0,
  GrenadeEffectiveRange: 20,
  GrenadeCacheAvailable: 0,
  GrenadeCacheLocation: "grenade_locker",
  GrenadeCacheStock: 2,
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
            const distance = (context.getState("EnemyDistance") as number) + 10;
            planEffect(context, "EnemyDistance", distance, effectType);
            planEffect(context, "CloseQuartersAdvantage", 0, effectType);
          })
        .end()
        .select("SecureHealing")
          .sequence("UseCarriedMedkitDirectly")
            .condition("Medkit carried", (context) => context.hasState("MedkitInInventory", 1))
            .action("UseCarriedMedkit")
              .do(() => TaskStatus.Success)
              .effect("Restore health with carried medkit", EffectType.PlanOnly, (context, effectType) => {
                planEffect(context, "Health", context.getState("MaxHealth"), effectType);
                planEffect(context, "MedkitInInventory", 0, effectType);
              })
            .end()
          .end()
          .sequence("RetrieveAndApplyMedkit")
            .condition("Medkit cache accessible", (context) => context.hasState("MedkitAvailable", 1))
            .action("MoveToMedkitCache")
              .do(() => TaskStatus.Success)
              .effect("Navigate to medbay", EffectType.PlanOnly, (context, effectType) => {
                planEffect(context, "AgentPosition", context.getState("MedkitLocation"), effectType);
                const distance = (context.getState("EnemyDistance") as number) + 5;
                planEffect(context, "EnemyDistance", distance, effectType);
              })
            .end()
            .action("CollectMedkit")
              .do(() => TaskStatus.Success)
              .effect("Secure medkit", EffectType.PlanOnly, (context, effectType) => {
                planEffect(context, "MedkitInInventory", 1, effectType);
                planEffect(context, "MedkitAvailable", 0, effectType);
              })
            .end()
            .action("ApplyMedkit")
              .do(() => TaskStatus.Success)
              .effect("Restore health from medbay cache", EffectType.PlanOnly, (context, effectType) => {
                planEffect(context, "Health", context.getState("MaxHealth"), effectType);
                planEffect(context, "MedkitInInventory", 0, effectType);
              })
            .end()
          .end()
          .sequence("HoldDefensivePositionWithoutMedkit")
            .action("HoldDefensivePosition")
              .do(() => TaskStatus.Success)
              .effect("Regain composure", EffectType.PlanOnly, (context, effectType) => {
                const threshold = context.getState("CriticalHealthThreshold") as number;
                const max = context.getState("MaxHealth") as number;
                const recovered = Math.min(max, threshold + 10);
                planEffect(context, "Health", recovered, effectType);
              })
            .end()
          .end()
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
              return hasRocket || context.hasState("RocketLauncherAvailable", 1) || (context.getState("RocketCacheAmmo") as number) > 0;
            })
            .select("EnsureRocketLauncher")
              .sequence("AlreadyCarryingRocket")
                .condition("Rocket equipped", (context) => context.hasState("HasRocketLauncher", 1))
                .condition("Rocket ammo loaded", (context) => (context.getState("RocketAmmo") as number) > 0)
                .action("ReadyRocketLauncher")
                  .do(() => TaskStatus.Success)
                .end()
              .end()
              .sequence("RestockRocketAmmo")
                .condition("Rocket owned but empty", (context) =>
                  context.hasState("HasRocketLauncher", 1) && (context.getState("RocketAmmo") as number) === 0,
                )
                .condition("Rocket ammo cache stocked", (context) => (context.getState("RocketCacheAmmo") as number) > 0)
                .action("ReturnToRocketCache")
                  .do(() => TaskStatus.Success)
                  .effect("Backtrack to rocket cache", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "AgentPosition", context.getState("KnownRocketLocation"), effectType);
                  })
                .end()
                .action("ResupplyRocketAmmo")
                  .do(() => TaskStatus.Success)
                  .effect("Reload rocket ammo", EffectType.PlanOnly, (context, effectType) => {
                    const ammoFromCache = context.getState("RocketCacheAmmo") as number;
                    planEffect(context, "RocketAmmo", Math.max(1, ammoFromCache), effectType);
                    planEffect(context, "RocketCacheAmmo", 0, effectType);
                    planEffect(context, "HasRocketLauncher", 1, effectType);
                  })
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
                    const ammoFromCache = context.getState("RocketCacheAmmo") as number;
                    planEffect(context, "HasRocketLauncher", 1, effectType);
                    planEffect(context, "RocketAmmo", Math.max(1, ammoFromCache), effectType);
                    planEffect(context, "RocketLauncherAvailable", 0, effectType);
                    planEffect(context, "RocketCacheAmmo", 0, effectType);
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
          .sequence("DestroyCoverWithGrenade")
            .condition("Obstruction present", (context) => context.hasState("EnemyObstructed", 1))
            .condition("Cover is destructible", (context) => context.hasState("CoverDestructible", 1))
            .condition("Grenade tactic available", (context) => {
              const grenades = context.getState("GrenadeCount") as number;
              return grenades > 0 || context.hasState("GrenadeAvailable", 1) || context.hasState("GrenadeCacheAvailable", 1);
            })
            .select("EnsureGrenadeForBreach")
              .sequence("GrenadeOnHandForBreach")
                .condition("Grenade carried", (context) => (context.getState("GrenadeCount") as number) > 0)
                .action("ConfirmGrenadeReadyForCover")
                  .do(() => TaskStatus.Success)
                .end()
              .end()
              .sequence("GrabNearbyGrenadeForBreach")
                .condition("Loose grenade spotted", (context) => context.hasState("GrenadeAvailable", 1))
                .action("PickUpLooseGrenade")
                  .do(() => TaskStatus.Success)
                  .effect("Grab loose grenade", EffectType.PlanOnly, (context, effectType) => {
                    const grenades = (context.getState("GrenadeCount") as number) + 1;
                    planEffect(context, "GrenadeCount", grenades, effectType);
                    planEffect(context, "GrenadeAvailable", 0, effectType);
                  })
                .end()
              .end()
              .sequence("FetchGrenadeCacheForBreach")
                .condition("Grenade cache stocked", (context) => context.hasState("GrenadeCacheAvailable", 1))
                .action("MoveToGrenadeCache")
                  .do(() => TaskStatus.Success)
                  .effect("Approach grenade locker", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "AgentPosition", context.getState("GrenadeCacheLocation"), effectType);
                    const distance = (context.getState("EnemyDistance") as number) + 5;
                    planEffect(context, "EnemyDistance", distance, effectType);
                  })
                .end()
                .action("CollectGrenades")
                  .do(() => TaskStatus.Success)
                  .effect("Stock grenades", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "GrenadeCount", context.getState("GrenadeCacheStock") as number, effectType);
                    planEffect(context, "GrenadeCacheAvailable", 0, effectType);
                  })
                .end()
              .end()
            .end()
            .action("ThrowGrenadeAtCover")
              .do(() => TaskStatus.Success)
              .effect("Shatter enemy cover", EffectType.PlanOnly, (context, effectType) => {
                const grenades = Math.max(0, (context.getState("GrenadeCount") as number) - 1);
                planEffect(context, "GrenadeCount", grenades, effectType);
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
          .sequence("GrenadeAssault")
            .utility((context) => {
              const grenades = context.getState("GrenadeCount") as number;
              return grenades > 0 ? 110 : 70;
            })
            .condition("Grenade assault possible", (context) => {
              const grenades = context.getState("GrenadeCount") as number;
              const distance = context.getState("EnemyDistance") as number;
              const range = context.getState("GrenadeEffectiveRange") as number;
              return distance <= range && (grenades > 0 || context.hasState("GrenadeAvailable", 1) || context.hasState("GrenadeCacheAvailable", 1));
            })
            .select("EnsureGrenadesForAttack")
              .sequence("GrenadeReadyForAttack")
                .condition("Grenade on hand", (context) => (context.getState("GrenadeCount") as number) > 0)
                .action("ConfirmGrenadeReady")
                  .do(() => TaskStatus.Success)
                .end()
              .end()
              .sequence("GrabNearbyGrenadeForAttack")
                .condition("Loose grenade available", (context) => context.hasState("GrenadeAvailable", 1))
                .action("PickUpLooseGrenade")
                  .do(() => TaskStatus.Success)
                  .effect("Grab loose grenade", EffectType.PlanOnly, (context, effectType) => {
                    const grenades = (context.getState("GrenadeCount") as number) + 1;
                    planEffect(context, "GrenadeCount", grenades, effectType);
                    planEffect(context, "GrenadeAvailable", 0, effectType);
                  })
                .end()
              .end()
              .sequence("AcquireGrenadesForAttack")
                .condition("Grenade cache stocked", (context) => context.hasState("GrenadeCacheAvailable", 1))
                .action("MoveToGrenadeCache")
                  .do(() => TaskStatus.Success)
                  .effect("Approach grenade locker", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "AgentPosition", context.getState("GrenadeCacheLocation"), effectType);
                    const distance = (context.getState("EnemyDistance") as number) + 5;
                    planEffect(context, "EnemyDistance", distance, effectType);
                  })
                .end()
                .action("CollectGrenades")
                  .do(() => TaskStatus.Success)
                  .effect("Stock grenades", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "GrenadeCount", context.getState("GrenadeCacheStock") as number, effectType);
                    planEffect(context, "GrenadeCacheAvailable", 0, effectType);
                  })
                .end()
              .end()
            .end()
            .action("ThrowGrenadeAtEnemy")
              .do(() => TaskStatus.Success)
              .effect("Eliminate enemy with grenade", EffectType.PlanOnly, (context, effectType) => {
                const grenades = Math.max(0, (context.getState("GrenadeCount") as number) - 1);
                planEffect(context, "GrenadeCount", grenades, effectType);
                planEffect(context, "EnemyNeutralized", 1, effectType);
              })
            .end()
          .end()
          .sequence("RangedEngagementPlan")
            .utility((context) => (context.hasState("CloseQuartersAdvantage", 1) ? 25 : 100))
            .condition("Ranged option possible", (context) => {
              const hasWeapon = context.hasState("HasRangedWeapon", 1);
              const ammoLoaded = (context.getState("PrimaryWeaponAmmo") as number) > 0;
              const spareClips = (context.getState("SpareAmmoClips") as number) > 0;
              const canResupply = context.hasState("AmmoCacheAvailable", 1);
              const canRetrieveWeapon = context.hasState("KnownWeaponAvailable", 1);
              return (hasWeapon && (ammoLoaded || spareClips || canResupply)) || canRetrieveWeapon;
            })
            .select("EnsurePrimaryWeapon")
              .sequence("WeaponReady")
                .condition("Already armed", (context) => context.hasState("HasRangedWeapon", 1))
                .condition("Primary ammo loaded", (context) => (context.getState("PrimaryWeaponAmmo") as number) > 0)
                .action("ConfirmPrimaryWeapon")
                  .do(() => TaskStatus.Success)
                .end()
              .end()
              .sequence("ReloadPrimaryWeapon")
                .condition("Weapon on hand but empty", (context) =>
                  context.hasState("HasRangedWeapon", 1) && (context.getState("PrimaryWeaponAmmo") as number) === 0,
                )
                .condition("Spare rifle clip available", (context) => (context.getState("SpareAmmoClips") as number) > 0)
                .action("ReloadPrimaryWeapon")
                  .do(() => TaskStatus.Success)
                  .effect("Reload primary weapon", EffectType.PlanOnly, (context, effectType) => {
                    const clipSize = context.getState("PrimaryWeaponClipSize") as number;
                    const spare = Math.max(0, (context.getState("SpareAmmoClips") as number) - 1);
                    planEffect(context, "PrimaryWeaponAmmo", clipSize, effectType);
                    planEffect(context, "SpareAmmoClips", spare, effectType);
                    planEffect(context, "HasRangedWeapon", 1, effectType);
                  })
                .end()
              .end()
              .sequence("ResupplyPrimaryAmmo")
                .condition("Weapon dry without spare clips", (context) =>
                  context.hasState("HasRangedWeapon", 1) &&
                  (context.getState("PrimaryWeaponAmmo") as number) === 0 &&
                  (context.getState("SpareAmmoClips") as number) === 0,
                )
                .condition("Ammo cache accessible", (context) => context.hasState("AmmoCacheAvailable", 1))
                .action("MoveToAmmoCache")
                  .do(() => TaskStatus.Success)
                  .effect("Travel to ammo cache", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "AgentPosition", context.getState("AmmoCacheLocation"), effectType);
                    const distance = (context.getState("EnemyDistance") as number) + 5;
                    planEffect(context, "EnemyDistance", distance, effectType);
                  })
                .end()
                .action("CollectAmmoClips")
                  .do(() => TaskStatus.Success)
                  .effect("Restock rifle ammo", EffectType.PlanOnly, (context, effectType) => {
                    planEffect(context, "SpareAmmoClips", context.getState("AmmoClipRestockAmount") as number, effectType);
                    planEffect(context, "AmmoCacheAvailable", 0, effectType);
                  })
                .end()
                .action("ReloadPrimaryWeaponFromCache")
                  .do(() => TaskStatus.Success)
                  .effect("Reload from cache", EffectType.PlanOnly, (context, effectType) => {
                    const clipSize = context.getState("PrimaryWeaponClipSize") as number;
                    const spare = Math.max(0, (context.getState("SpareAmmoClips") as number) - 1);
                    planEffect(context, "PrimaryWeaponAmmo", clipSize, effectType);
                    planEffect(context, "SpareAmmoClips", spare, effectType);
                    planEffect(context, "HasRangedWeapon", 1, effectType);
                  })
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
                    planEffect(context, "PrimaryWeaponAmmo", context.getState("PrimaryWeaponClipSize") as number, effectType);
                    planEffect(context, "SpareAmmoClips", 1, effectType);
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
                    planEffect(
                      context,
                      "CloseQuartersAdvantage",
                      newDistance <= (context.getState("MeleeRange") as number) ? 1 : 0,
                      effectType,
                    );
                  })
                .end()
              .end()
            .end()
            .action("FirePrimaryWeapon")
              .condition("Still armed", (context) => context.hasState("HasRangedWeapon", 1))
              .do(() => TaskStatus.Success)
              .effect("Neutralize enemy at range", EffectType.PlanOnly, (context, effectType) => {
                planEffect(context, "EnemyNeutralized", 1, effectType);
                const ammo = Math.max(0, (context.getState("PrimaryWeaponAmmo") as number) - 1);
                planEffect(context, "PrimaryWeaponAmmo", ammo, effectType);
              })
            .end()
          .end()
          .sequence("SidearmBurst")
            .utility(() => 80)
            .condition("Sidearm available", (context) => context.hasState("HasSidearm", 1))
            .condition("Enemy within sidearm range", (context) =>
              (context.getState("EnemyDistance") as number) <= (context.getState("SidearmRange") as number),
            )
            .select("EnsureSidearmReady")
              .sequence("SidearmLoaded")
                .condition("Sidearm ammo remaining", (context) => (context.getState("SidearmAmmo") as number) > 0)
                .action("ConfirmSidearmReady")
                  .do(() => TaskStatus.Success)
                .end()
              .end()
              .sequence("ReloadSidearm")
                .condition("Sidearm empty", (context) => (context.getState("SidearmAmmo") as number) === 0)
                .condition("Sidearm clips available", (context) => (context.getState("SidearmClips") as number) > 0)
                .action("ReloadSidearm")
                  .do(() => TaskStatus.Success)
                  .effect("Reload sidearm", EffectType.PlanOnly, (context, effectType) => {
                    const clipSize = context.getState("SidearmClipSize") as number;
                    const remainingClips = Math.max(0, (context.getState("SidearmClips") as number) - 1);
                    planEffect(context, "SidearmAmmo", clipSize, effectType);
                    planEffect(context, "SidearmClips", remainingClips, effectType);
                    planEffect(context, "HasSidearm", 1, effectType);
                  })
                .end()
              .end()
            .end()
            .action("FireSidearmBurst")
              .do(() => TaskStatus.Success)
              .effect("Neutralize enemy with sidearm", EffectType.PlanOnly, (context, effectType) => {
                const ammo = Math.max(0, (context.getState("SidearmAmmo") as number) - 1);
                planEffect(context, "SidearmAmmo", ammo, effectType);
                planEffect(context, "EnemyNeutralized", 1, effectType);
                planEffect(context, "CloseQuartersAdvantage", 0, effectType);
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

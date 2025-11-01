import Domain from "../src/domain";
import DomainBuilder from "../src/domainBuilder";
import Context from "../src/context";
import Planner from "../src/planner";
import TaskStatus from "../src/taskStatus";
import EffectType, { type EffectTypeValue } from "../src/effectType";
import PrimitiveTask from "../src/Tasks/primitiveTask";
import DecompositionStatus from "../src/decompositionStatus";

export type Vec3 = [number, number, number];

export const N = Object.freeze({
  COURTYARD: "courtyard",
  TABLE: "table_area",
  STORAGE_DOOR: "storage_door",
  STORAGE_INT: "storage_interior",
  C4_TABLE: "c4_table",
  BUNKER_DOOR: "bunker_door",
  BUNKER_INT: "bunker_interior",
  STAR: "star_pos",
  SAFE: "blast_safe_zone",
} as const);

export type NodeId = (typeof N)[keyof typeof N];

export type BuildingConfig = {
  center: Vec3;
  size: [number, number, number];
  doorFace: "north" | "south" | "east" | "west";
  doorOffset?: number;
  doorSize: [number, number];
};

export const BUILDINGS: Record<string, BuildingConfig> = {
  STORAGE: {
    center: [-10, 0, 8],
    size: [6, 3.5, 4.5],
    doorFace: "east",
    doorOffset: 1.5,
    doorSize: [1.5, 2.4],
  },
  BUNKER: {
    center: [15, 0, 0],
    size: [7, 5, 7],
    doorFace: "west",
    doorOffset: 1.5,
    doorSize: [1.5, 2.4],
  },
};

export function getBuildingInteriorPosition(building: BuildingConfig, offset: Vec3 = [0, 0, 0]): Vec3 {
  const [centerX, centerY, centerZ] = building.center;
  const [offsetX, offsetY, offsetZ] = offset;
  return [centerX + offsetX, centerY + offsetY, centerZ + offsetZ];
}

export function getBuildingDoorPosition(building: BuildingConfig): Vec3 {
  const [centerX, centerY, centerZ] = building.center;
  const [width, _height, depth] = building.size;
  const offset = building.doorOffset || 0;
  switch (building.doorFace) {
    case "east":
      return [centerX + width / 2 + offset, centerY, centerZ];
    case "west":
      return [centerX - width / 2 - offset, centerY, centerZ];
    case "south":
      return [centerX, centerY, centerZ + depth / 2 + offset];
    case "north":
    default:
      return [centerX, centerY, centerZ - depth / 2 - offset];
  }
}

export const NODE_POS: Record<NodeId, Vec3> = {
  [N.COURTYARD]: [0, 0, 0],
  [N.TABLE]: [-10, 0, 0],
  [N.SAFE]: (() => {
    const pos = getBuildingDoorPosition(BUILDINGS.BUNKER);
    return [pos[0] - 5, pos[1], pos[2]];
  })(),
  [N.STORAGE_DOOR]: getBuildingDoorPosition(BUILDINGS.STORAGE),
  [N.STORAGE_INT]: getBuildingInteriorPosition(BUILDINGS.STORAGE),
  [N.C4_TABLE]: getBuildingInteriorPosition(BUILDINGS.STORAGE, [-1, 0, 0]),
  [N.BUNKER_DOOR]: getBuildingDoorPosition(BUILDINGS.BUNKER),
  [N.BUNKER_INT]: getBuildingInteriorPosition(BUILDINGS.BUNKER),
  [N.STAR]: getBuildingInteriorPosition(BUILDINGS.BUNKER, [2, 0, 0]),
};

type GateState = {
  storageUnlocked: boolean;
  bunkerBreached: boolean;
};

type Edge<S> = [NodeId, NodeId, (s: S) => boolean];

const RAW_EDGES: Edge<GateState>[] = [
  [N.COURTYARD, N.TABLE, () => true],
  [N.COURTYARD, N.STORAGE_DOOR, () => true],
  [N.COURTYARD, N.BUNKER_DOOR, () => true],
  [N.COURTYARD, N.SAFE, () => true],
  [N.TABLE, N.STORAGE_DOOR, () => true],
  [N.STORAGE_DOOR, N.STORAGE_INT, (s) => s.storageUnlocked === true],
  [N.STORAGE_INT, N.C4_TABLE, () => true],
  [N.STORAGE_DOOR, N.BUNKER_DOOR, () => true],
  [N.BUNKER_DOOR, N.BUNKER_INT, (s) => s.bunkerBreached === true],
  [N.BUNKER_DOOR, N.SAFE, () => true],
  [N.BUNKER_INT, N.STAR, () => true],
];

function makeAdjacency<S>(raw: Edge<S>[]) {
  const map: Record<string, Array<{ to: NodeId; when: (s: S) => boolean }>> = {};
  for (const [a, b, when] of raw) {
    if (!map[a]) {
      map[a] = [];
    }
    map[a].push({ to: b, when });
    if (!map[b]) {
      map[b] = [];
    }
    map[b].push({ to: a, when });
  }
  return map;
}

const ADJ = makeAdjacency(RAW_EDGES);

function neighbors(state: GateState, from: NodeId): NodeId[] {
  return (ADJ[from] || [])
    .filter((edge) => edge.when(state))
    .map((edge) => edge.to);
}

function findPath(state: GateState, from: NodeId, to: NodeId): NodeId[] | null {
  if (from === to) {
    return [from];
  }
  const seen = new Set<NodeId>([from]);
  const q: NodeId[] = [from];
  const prev = new Map<NodeId, NodeId>();
  while (q.length) {
    const cur = q.shift()!;
    for (const n of neighbors(state, cur)) {
      if (seen.has(n)) {
        continue;
      }
      seen.add(n);
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        let p = prev.get(to);
        while (p !== undefined) {
          path.push(p);
          p = prev.get(p);
        }
        path.reverse();
        return path;
      }
      q.push(n);
    }
  }
  return null;
}

const NODE_IDS: NodeId[] = Object.values(N);
const NODE_INDEX: Record<NodeId, number> = NODE_IDS.reduce((acc, node, idx) => {
  acc[node] = idx;
  return acc;
}, {} as Record<NodeId, number>);

const INDEX_TO_NODE: Record<number, NodeId> = NODE_IDS.reduce((acc, node, idx) => {
  acc[idx] = node;
  return acc;
}, {} as Record<number, NodeId>);

const WS = {
  agentAt: "agentAt",
  keyOnTable: "keyOnTable",
  c4Available: "c4Available",
  starPresent: "starPresent",
  hasKey: "hasKey",
  hasC4: "hasC4",
  hasStar: "hasStar",
  storageUnlocked: "storageUnlocked",
  c4Placed: "c4Placed",
  bunkerBreached: "bunkerBreached",
} as const;

type WorldStateKey = (typeof WS)[keyof typeof WS];

function applyPlanningState(ctx: BunkerContext, key: WorldStateKey, value: number, effectType: EffectTypeValue | null): void {
  const appliedType = effectType ?? EffectType.PlanOnly;
  ctx.setState(key, value, false, appliedType);
  if (!ctx.WorldStateChangeStack) {
    return;
  }
  if (!ctx.WorldStateChangeStack[key]) {
    ctx.WorldStateChangeStack[key] = [];
  }
  const stack = ctx.WorldStateChangeStack[key];
  if (stack) {
    stack.length = 0;
    stack.push({ effectType: appliedType, value });
  }
}

export type BunkerGoals = {
  hasKey?: boolean;
  hasC4?: boolean;
  bunkerBreached?: boolean;
  hasStar?: boolean;
  agentAt?: NodeId;
};

export type BunkerWorldOverrides = {
  agentAt?: NodeId;
  keyOnTable?: boolean;
  c4Available?: boolean;
  starPresent?: boolean;
  hasKey?: boolean;
  hasC4?: boolean;
  hasStar?: boolean;
  storageUnlocked?: boolean;
  c4Placed?: boolean;
  bunkerBreached?: boolean;
};

const initialWorld: Record<WorldStateKey, number> = {
  [WS.agentAt]: NODE_INDEX[N.COURTYARD],
  [WS.keyOnTable]: 1,
  [WS.c4Available]: 1,
  [WS.starPresent]: 1,
  [WS.hasKey]: 0,
  [WS.hasC4]: 0,
  [WS.hasStar]: 0,
  [WS.storageUnlocked]: 0,
  [WS.c4Placed]: 0,
  [WS.bunkerBreached]: 0,
};

class BunkerContext extends Context {
  Goals: BunkerGoals = {};

  setGoal(goal: BunkerGoals): void {
    this.Goals = { ...goal };
  }

  getAgentNode(): NodeId {
    const idx = this.getState(WS.agentAt);
    return INDEX_TO_NODE[idx] ?? N.COURTYARD;
  }

  setAgentNode(node: NodeId, effectType: EffectTypeValue | null = EffectType.PlanOnly): void {
    applyPlanningState(this, WS.agentAt, NODE_INDEX[node], effectType);
  }

  getBool(key: WorldStateKey): boolean {
    return this.getState(key) === 1;
  }

  setBool(key: WorldStateKey, value: boolean, effectType: EffectTypeValue | null = EffectType.PlanOnly): void {
    applyPlanningState(this, key, value ? 1 : 0, effectType);
  }
}

function gateStateFromContext(ctx: BunkerContext): GateState {
  return {
    storageUnlocked: ctx.getBool(WS.storageUnlocked),
    bunkerBreached: ctx.getBool(WS.bunkerBreached),
  };
}

function canReach(ctx: BunkerContext, target: NodeId): boolean {
  const from = ctx.getAgentNode();
  if (from === target) {
    return true;
  }
  return findPath(gateStateFromContext(ctx), from, target) !== null;
}

function applyNoOp(builder: DomainBuilder<BunkerContext>): void {
  builder.action("").do(() => TaskStatus.Success).end();
}

function applyMove(builder: DomainBuilder<BunkerContext>, target: NodeId): void {
  builder
    .action(`MOVE ${target}`)
    .condition("Reachable", (context) => canReach(context, target))
    .do(() => TaskStatus.Success)
    .effect(
      `Set agent at ${target}`,
      EffectType.PlanOnly,
      (context: BunkerContext, effectType) => {
        context.setAgentNode(target, effectType);
      },
    )
    .end();
}

function pickupKey(builder: DomainBuilder<BunkerContext>): void {
  builder
    .action("PICKUP_KEY")
    .condition("At table", (context) => context.getAgentNode() === N.TABLE)
    .condition("Key available", (context) => context.getBool(WS.keyOnTable))
    .do(() => TaskStatus.Success)
    .effect("Take key", EffectType.PlanOnly, (context: BunkerContext, effectType) => {
      context.setBool(WS.keyOnTable, false, effectType);
      context.setBool(WS.hasKey, true, effectType);
    })
    .end();
}

function unlockStorageAction(builder: DomainBuilder<BunkerContext>): void {
  builder
    .action("UNLOCK_STORAGE")
    .condition("Door locked", (context) => !context.getBool(WS.storageUnlocked))
    .condition("Has key", (context) => context.getBool(WS.hasKey))
    .condition("At door", (context) => context.getAgentNode() === N.STORAGE_DOOR)
    .do(() => TaskStatus.Success)
    .effect("Unlock storage", EffectType.PlanOnly, (context: BunkerContext, effectType) => {
      context.setBool(WS.storageUnlocked, true, effectType);
    })
    .end();
}

function pickupC4(builder: DomainBuilder<BunkerContext>): void {
  builder
    .action("PICKUP_C4")
    .condition("C4 available", (context) => context.getBool(WS.c4Available))
    .condition("At C4 table", (context) => context.getAgentNode() === N.C4_TABLE)
    .do(() => TaskStatus.Success)
    .effect("Take C4", EffectType.PlanOnly, (context: BunkerContext, effectType) => {
      context.setBool(WS.c4Available, false, effectType);
      context.setBool(WS.hasC4, true, effectType);
    })
    .end();
}

function placeC4(builder: DomainBuilder<BunkerContext>): void {
  builder
    .action("PLACE_C4")
    .condition("Has C4", (context) => context.getBool(WS.hasC4))
    .condition("At bunker door", (context) => context.getAgentNode() === N.BUNKER_DOOR)
    .do(() => TaskStatus.Success)
    .effect("Place C4", EffectType.PlanOnly, (context: BunkerContext, effectType) => {
      context.setBool(WS.hasC4, false, effectType);
      context.setBool(WS.c4Placed, true, effectType);
    })
    .end();
}

function detonate(builder: DomainBuilder<BunkerContext>): void {
  builder
    .action("DETONATE")
    .condition("C4 placed", (context) => context.getBool(WS.c4Placed))
    .condition("At safe", (context) => context.getAgentNode() === N.SAFE)
    .do(() => TaskStatus.Success)
    .effect("Breach bunker", EffectType.PlanOnly, (context: BunkerContext, effectType) => {
      context.setBool(WS.bunkerBreached, true, effectType);
      context.setBool(WS.c4Placed, false, effectType);
    })
    .end();
}

function pickupStar(builder: DomainBuilder<BunkerContext>): void {
  builder
    .action("PICKUP_STAR")
    .condition("Star present", (context) => context.getBool(WS.starPresent))
    .condition("At star", (context) => context.getAgentNode() === N.STAR)
    .do(() => TaskStatus.Success)
    .effect("Take star", EffectType.PlanOnly, (context: BunkerContext, effectType) => {
      context.setBool(WS.starPresent, false, effectType);
      context.setBool(WS.hasStar, true, effectType);
    })
    .end();
}

function wantsStar(goals: BunkerGoals): boolean {
  return goals.hasStar === true;
}

function wantsBreach(goals: BunkerGoals): boolean {
  return goals.bunkerBreached === true || wantsStar(goals);
}

function needsBreach(ctx: BunkerContext): boolean {
  if (!wantsBreach(ctx.Goals)) {
    return false;
  }
  return !ctx.getBool(WS.bunkerBreached);
}

function needsC4(ctx: BunkerContext): boolean {
  if (ctx.Goals.hasC4) {
    return !ctx.getBool(WS.hasC4);
  }
  if (needsBreach(ctx)) {
    const hasC4 = ctx.getBool(WS.hasC4);
    const placed = ctx.getBool(WS.c4Placed);
    return !(hasC4 || placed);
  }
  return false;
}

function needsStorageAccess(ctx: BunkerContext): boolean {
  const target = ctx.Goals.agentAt;
  if (target === N.STORAGE_INT || target === N.C4_TABLE) {
    return !ctx.getBool(WS.storageUnlocked);
  }
  if (needsC4(ctx)) {
    return !ctx.getBool(WS.storageUnlocked);
  }
  return false;
}

function needsKey(ctx: BunkerContext): boolean {
  if (ctx.getBool(WS.hasKey)) {
    return false;
  }
  if (ctx.Goals.hasKey) {
    return true;
  }
  return needsStorageAccess(ctx);
}

function needsStar(ctx: BunkerContext): boolean {
  if (!wantsStar(ctx.Goals)) {
    return false;
  }
  return !ctx.getBool(WS.hasStar);
}

function buildBunkerDomain(): Domain {
  const builder = new DomainBuilder<BunkerContext>("Bunker Domain");

  builder.sequence("Fulfill Goals");

  // Acquire key if required
  builder.select("Ensure Key");
  builder
    .sequence("Acquire Key")
    .condition("Needs key", (context) => needsKey(context));
  applyMove(builder, N.TABLE);
  pickupKey(builder);
  builder.end(); // Acquire Key sequence
  applyNoOp(builder);
  builder.end(); // Ensure Key select

  // Ensure storage unlocked if needed
  builder.select("Ensure Storage Unlocked");
  builder
    .sequence("Unlock Storage")
    .condition("Needs storage access", (context) => needsStorageAccess(context))
    .condition("Door locked", (context) => !context.getBool(WS.storageUnlocked));
  applyMove(builder, N.STORAGE_DOOR);
  unlockStorageAction(builder);
  builder.end(); // Unlock Storage sequence
  applyNoOp(builder);
  builder.end(); // Ensure Storage Unlocked select

  // Acquire C4 when necessary
  builder.select("Ensure C4");
  builder
    .sequence("Acquire C4")
    .condition("Needs C4", (context) => needsC4(context));
  applyMove(builder, N.STORAGE_DOOR);
  builder.select("Maybe Unlock Storage Inside C4");
  unlockStorageAction(builder);
  applyNoOp(builder);
  builder.end();
  applyMove(builder, N.STORAGE_INT);
  applyMove(builder, N.C4_TABLE);
  pickupC4(builder);
  builder.end(); // Acquire C4 sequence
  applyNoOp(builder);
  builder.end(); // Ensure C4 select

  // Breach bunker if required
  builder.select("Ensure Bunker Breached");
  builder
    .sequence("Breach Bunker")
    .condition("Needs breach", (context) => needsBreach(context));
  builder.select("Ensure C4 Placed");
  builder
    .sequence("Place C4 Sequence")
    .condition("C4 not placed", (context) => !context.getBool(WS.c4Placed));
  applyMove(builder, N.BUNKER_DOOR);
  placeC4(builder);
  builder.end();
  applyNoOp(builder);
  builder.end();
  applyMove(builder, N.SAFE);
  detonate(builder);
  builder.end(); // Breach Bunker sequence
  applyNoOp(builder);
  builder.end(); // Ensure Bunker Breached select

  // Collect the star when required
  builder.select("Ensure Star");
  builder
    .sequence("Collect Star")
    .condition("Needs star", (context) => needsStar(context))
    .condition("Bunker open", (context) => context.getBool(WS.bunkerBreached));
  applyMove(builder, N.BUNKER_INT);
  applyMove(builder, N.STAR);
  pickupStar(builder);
  builder.end();
  applyNoOp(builder);
  builder.end();

  // Ensure final agent position when requested
  builder.select("Ensure Agent Position");
  for (const node of NODE_IDS) {
    builder
      .sequence(`Move to ${node}`)
      .condition("Goal matches node", (context) => context.Goals.agentAt === node)
      .condition("Not already there", (context) => context.getAgentNode() !== node);
    applyMove(builder, node);
    builder.end();
  }
  applyNoOp(builder);
  builder.end();

  builder.end(); // Fulfill Goals sequence

  return builder.build();
}

const bunkerDomain = buildBunkerDomain();

export function createBunkerContext(overrides: BunkerWorldOverrides = {}): BunkerContext {
  const ctx = new BunkerContext();
  ctx.WorldState = { ...initialWorld };
  if (typeof overrides.agentAt !== "undefined") {
    ctx.WorldState[WS.agentAt] = NODE_INDEX[overrides.agentAt];
  }
  const boolKeys: Array<[keyof BunkerWorldOverrides, WorldStateKey]> = [
    ["keyOnTable", WS.keyOnTable],
    ["c4Available", WS.c4Available],
    ["starPresent", WS.starPresent],
    ["hasKey", WS.hasKey],
    ["hasC4", WS.hasC4],
    ["hasStar", WS.hasStar],
    ["storageUnlocked", WS.storageUnlocked],
    ["c4Placed", WS.c4Placed],
    ["bunkerBreached", WS.bunkerBreached],
  ];
  for (const [key, wsKey] of boolKeys) {
    if (typeof overrides[key] !== "undefined") {
      ctx.WorldState[wsKey] = overrides[key] ? 1 : 0;
    }
  }
  ctx.init();
  return ctx;
}

export function getBunkerDomain(): Domain {
  return bunkerDomain;
}

function extractPlanStrings(plan: PrimitiveTask[]): string[] {
  return plan
    .map((task) => (task.Name ?? "").trim())
    .filter((name) => name.length > 0);
}

export function planGoal(goal: BunkerGoals, options: { initial?: BunkerWorldOverrides } = {}): string[] {
  const ctx = createBunkerContext(options.initial ?? {});
  ctx.setGoal(goal);
  const result = bunkerDomain.findPlan(ctx);
  if (result.plan.length === 0 && result.status !== DecompositionStatus.Succeeded) {
    return [];
  }
  return extractPlanStrings(result.plan);
}

export function planUsingPlanner(goal: BunkerGoals, options: { initial?: BunkerWorldOverrides } = {}): { plan: string[]; context: BunkerContext } {
  const domain = getBunkerDomain();
  const ctx = createBunkerContext(options.initial ?? {});
  ctx.setGoal(goal);
  const planner = new Planner();
  planner.tick(domain, ctx, false);
  return {
    plan: extractPlanStrings(planner.getPlan()),
    context: ctx,
  };
}



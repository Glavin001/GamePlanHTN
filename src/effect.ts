// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

import Context from "./context";
import type { EffectTypeValue } from "./effectType";

export type EffectAction = (context: Context, type: EffectTypeValue | null) => void;

export interface EffectConfig {
  name: string;
  type: EffectTypeValue;
  action: EffectAction;
}

export type EffectDefinition = EffectConfig | EffectAction;

class Effect {
  public readonly Type: EffectTypeValue | null;

  public readonly Name: string;

  public readonly _effectFunction: EffectAction;

  constructor(props: EffectDefinition) {
    if (typeof props === "function") {
      this._effectFunction = props;
      this.Type = null;
      this.Name = "Unnamed Effect";
    } else {
      this._effectFunction = props.action;
      this.Type = props.type;
      this.Name = props.name;
    }
  }

  apply(context?: Context | null): void {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    if (typeof this._effectFunction === "function") {
      this._effectFunction(context, this.Type);
    }
  }
}

export default Effect;

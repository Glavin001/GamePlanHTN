import Context, { type WorldStateBase } from "./context";
import type { EffectTypeValue } from "./effectType";

export type EffectAction<TContext extends Context<WorldStateBase> = Context> = (context: TContext, type: EffectTypeValue | null) => void;

export interface EffectConfig<TContext extends Context<WorldStateBase> = Context> {
  name: string;
  type: EffectTypeValue;
  action: EffectAction<TContext>;
}

export type EffectDefinition<TContext extends Context<WorldStateBase> = Context> = EffectConfig<TContext> | EffectAction<TContext>;

class Effect<TContext extends Context<WorldStateBase> = Context> {
  public readonly Type: EffectTypeValue | null;

  public readonly Name: string;

  public readonly _effectFunction: EffectAction<TContext>;

  constructor(props: EffectDefinition<TContext>) {
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
      this._effectFunction(context as TContext, this.Type);
    }
  }
}

export default Effect;

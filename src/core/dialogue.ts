import type { Condition, DialogueDef, NpcDef } from '../data/schemas';
import type { World } from './world';

export interface DialogueView {
  speaker: string;
  text: string;
  choices: string[];
}

/** Longest chain of branch nodes followed before giving up (guards against loops in data). */
const MAX_BRANCH_HOPS = 20;

export function checkCondition(world: World, c: Condition | undefined): boolean {
  if (!c) return true;
  const p = world.player;
  if (c.job !== undefined && p.jobName.toLowerCase() !== c.job) return false;
  if (c.jobLevelMin !== undefined && p.jobLevel < c.jobLevelMin) return false;
  if (c.skillMin !== undefined && world.skillLevel(c.skillMin.id) < c.skillMin.level) return false;
  if (c.hasItem !== undefined && !world.hasItem(c.hasItem.id, c.hasItem.count)) return false;
  return true;
}

/**
 * Walks one conversation: shows the current node, applies the actions of a
 * chosen option and moves on. Branch nodes are resolved automatically.
 */
export class DialogueRunner {
  private nodeId: string | null = 'start';
  private choiceMap: number[] = [];
  /** Set when the last choice asked to open a shop; the UI picks it up. */
  openShop: string | null = null;

  constructor(
    private readonly world: World,
    private readonly def: DialogueDef,
    readonly npc: NpcDef,
  ) {
    this.resolve();
  }

  get done(): boolean {
    return this.nodeId === null;
  }

  view(): DialogueView | null {
    if (this.nodeId === null) return null;
    const node = this.def.nodes[this.nodeId]!;
    if ('branch' in node) return null;
    const visible = node.choices.map((c, i) => [c, i] as const).filter(([c]) => checkCondition(this.world, c.if));
    this.choiceMap = visible.map(([, i]) => i);
    return {
      speaker: this.npc.name,
      text: node.text.replaceAll('{name}', this.world.player.name),
      choices: visible.map(([c]) => c.label),
    };
  }

  /** Picks the n-th visible choice. A node without choices ends on any call. */
  choose(n: number): void {
    if (this.nodeId === null) return;
    const node = this.def.nodes[this.nodeId]!;
    if ('branch' in node || node.choices.length === 0) {
      this.nodeId = null;
      return;
    }
    this.view();
    const choice = node.choices[this.choiceMap[n] ?? -1];
    if (!choice) return;
    for (const action of choice.do) {
      const result = this.world.applyAction(action);
      if (result.openShop) this.openShop = result.openShop;
    }
    this.nodeId = choice.next ?? null;
    this.resolve();
  }

  private resolve(): void {
    for (let hops = 0; this.nodeId !== null && hops < MAX_BRANCH_HOPS; hops++) {
      const node = this.def.nodes[this.nodeId]!;
      if (!('branch' in node)) return;
      this.nodeId = node.branch.find((b) => checkCondition(this.world, b.if))?.next ?? node.else;
    }
    if (this.nodeId !== null && 'branch' in this.def.nodes[this.nodeId]!) this.nodeId = null;
  }
}

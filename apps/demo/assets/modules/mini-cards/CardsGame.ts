import { _decorator, Color, Component, Node, Sprite, SpriteFrame, type EventTouch } from 'cc';
import { bindText, BindingScope } from '@cck/engine';
import { getGameHost } from '../../foundation/game/host';
import {
  exitButton,
  fieldByWidth,
  gameLabel,
  gameNode,
  gameSprite,
  loadGameArt,
  releaseGameArt,
} from '../../foundation/game/stage';
import { CARD_SIZE, CardsVM, DECK_SIZE, DIE_FACES, DIE_SIZE } from './CardsVM';

const { ccclass } = _decorator;
const TAG = '[CCK-CARDS]';

/** 本模块的 bundle 名（= `modules/mini-cards` 目录名），也是这批贴图的释放组。 */
const BUNDLE = 'mini-cards';

/** 场地按宽定尺，宽度取原版的 800。 */
const FIELD_WIDTH = 800;

/** 牌堆 / 出牌位 / 两颗骰子摆哪。纯布局。 */
const DECK_POS = { x: -190, y: 150 } as const;
const PILE_POS = { x: 190, y: 150 } as const;
const DIE_POS = { red: { x: -110, y: -170 }, white: { x: 110, y: -170 } } as const;

/**
 * 66 张图：52 张牌面 + 牌背 + 红白骰各 6 面。
 *
 * 用 `concat` 拼而不是数组展开 —— Cocos 构建的 babel loose spread 会把 `[...x]` 降级成
 * `[].concat(x)`，预览测不出、只在产物里炸（lint 有硬规则挡）。
 */
const ART: readonly string[] = Array.from(
  { length: DECK_SIZE },
  (_, i) => `card${String(i).padStart(2, '0')}`,
)
  .concat(['card-back'])
  .concat(Array.from({ length: DIE_FACES }, (_, i) => `die-red${i}`))
  .concat(Array.from({ length: DIE_FACES }, (_, i) => `die-white${i}`));

/**
 * mini-cards · Kenney「Dice & Cards」的 Cocos 版（kind:'game'）。
 *
 * 美术与交互来自 Kenney 的 Construct 2 模板 `dicecards.capx`（CC0，www.kenney.nl）。
 *
 * 三件事跟别的子游戏不一样，都是有意的：
 *
 * 1. **没有 `update()`** —— 桌上的东西只在点了之后才变，每帧空转一遍没有意义。玩法仍在
 *    {@link CardsVM} 里，View 只是在两个 `TOUCH_END` 之后各同步一次。
 * 2. **没有记分板** —— 它没有可比的成绩。它演示的是 `GameHost` 的**另外两件事**：
 *    桌上写着 `player.name`（谁在玩），右上角 `exit()`（怎么出去）。
 * 3. **没有背景图** —— 这套素材本来就没有，原版靠布局底色。这里也不硬凑：底色由 kit 的
 *    常驻相机组给。要贴桌布就往本 bundle 的 `art/` 里加一张，别去借别的包的图。
 */
@ccclass('CardsGame')
export class CardsGame extends Component {
  private vm?: CardsVM;
  private frames!: Record<string, SpriteFrame>;
  private binds?: BindingScope;

  private pile?: Node;
  private readonly cardNodes: Node[] = [];
  private dieRed?: Node;
  private dieWhite?: Node;

  async start(): Promise<void> {
    const metrics = fieldByWidth(FIELD_WIDTH);

    const frames = await loadGameArt(this.node, BUNDLE, ART);
    if (!frames) return; // 加载期间被切走了
    this.frames = frames;

    this.vm = new CardsVM();
    this.buildTable(metrics.scale);
    this.buildHud(metrics.halfScreenHeight);
    this.sync();
    console.log(`${TAG} Cards.scene 启动（${ART.length} 张图，${DECK_SIZE} 张牌一副）`);
  }

  onDestroy(): void {
    this.binds?.dispose();
    releaseGameArt(BUNDLE);
  }

  // —— 建桌 ————————————————————————————————————————————————

  private buildTable(scale: number): void {
    const table = gameNode(this.node, 'Table');
    table.setScale(scale, scale, 1);

    this.pile = gameNode(table, 'Pile');
    this.pile.setPosition(PILE_POS.x, PILE_POS.y, 0);

    const deck = gameSprite(table, 'Deck', this.frames['card-back'], [0.5, 0.5], CARD_SIZE.width, CARD_SIZE.height);
    deck.setPosition(DECK_POS.x, DECK_POS.y, 0);
    deck.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      e.propagationStopped = true;
      this.vm!.draw();
      this.sync();
    });

    this.dieRed = this.dieNode(table, 'DieRed', DIE_POS.red);
    this.dieWhite = this.dieNode(table, 'DieWhite', DIE_POS.white);
  }

  private dieNode(parent: Node, name: string, pos: { readonly x: number; readonly y: number }): Node {
    const node = gameSprite(parent, name, this.frames['die-red0'], [0.5, 0.5], DIE_SIZE.width, DIE_SIZE.height);
    node.setPosition(pos.x, pos.y, 0);
    node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      e.propagationStopped = true;
      this.vm!.roll();
      this.sync();
    });
    return node;
  }

  private buildHud(halfScreenHeight: number): void {
    const vm = this.vm!;
    this.binds = new BindingScope();

    // 玩家名来自 GameHost —— 子游戏不自己去翻登录态，也不认识 auth 那一层。
    const who = gameLabel(this.node, 'Player', 48, new Color(230, 235, 245), [820, 90]);
    who.string = `${getGameHost().player.name} 的牌桌`;
    who.node.setPosition(0, halfScreenHeight - 170, 0);

    const deckInfo = gameLabel(this.node, 'Deck', 44, new Color(190, 200, 215), [820, 90]);
    deckInfo.node.setPosition(0, halfScreenHeight - 250, 0);
    this.binds.add(
      bindText(deckInfo, () => `第 ${vm.shuffles.value} 副 · 还剩 ${vm.remaining.value} 张${vm.lastCard.value ? ` · 刚发 ${vm.lastCard.value}` : ''}`),
    );

    const hint = gameLabel(this.node, 'Hint', 44, new Color(200, 210, 225), [820, 200]);
    hint.node.setPosition(0, -430, 0);
    this.binds.add(bindText(hint, () => `点牌堆发牌 · 点骰子重掷（${vm.diceTotal.value} 点）`));

    const back = exitButton(this.node, { color: new Color(230, 200, 150) });
    back.node.setPosition(-330, halfScreenHeight - 90, 0);
  }

  // —— 点完同步一次 ————————————————————————————————————————

  /** 桌面 = VM 的当前状态。只在发牌 / 掷骰之后调，没有每帧轮询。 */
  private sync(): void {
    const vm = this.vm!;
    for (let i = this.cardNodes.length; i < vm.dealt.length; i++) {
      // 牌都堆在同一处（原版就是 `cardBack.X + 200` 这一个点），靠各自的歪斜看出是一摞。
      const node = gameSprite(this.pile!, `Card${i}`, this.frames['card-back'], [0.5, 0.5], CARD_SIZE.width, CARD_SIZE.height);
      this.cardNodes.push(node);
    }
    for (let i = 0; i < this.cardNodes.length; i++) {
      const node = this.cardNodes[i];
      node.active = i < vm.dealt.length;
      if (i >= vm.dealt.length) continue;
      const card = vm.dealt[i];
      node.angle = card.tilt;
      node.getComponent(Sprite)!.spriteFrame = this.frames[`card${String(card.face).padStart(2, '0')}`];
    }
    this.dieRed!.getComponent(Sprite)!.spriteFrame = this.frames[`die-red${vm.dice[0].value}`];
    this.dieWhite!.getComponent(Sprite)!.spriteFrame = this.frames[`die-white${vm.dice[1].value}`];
  }
}

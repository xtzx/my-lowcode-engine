import {
  IPublicTypeTitleContent,
  IPublicTypeLocationChildrenDetail,
  IPublicModelNode,
  IPublicTypeDisposable,
} from '@alilc/lowcode-types';
import { isI18nData, isLocationChildrenDetail, uniqueId } from '@alilc/lowcode-utils';
import EventEmitter from 'events';
import { Tree } from './tree';
import { IOutlinePanelPluginContext } from './tree-master';

/**
 * 大纲树过滤结果
 */
export interface FilterResult {
  // 过滤条件是否生效
  filterWorking: boolean;
  // 命中子节点
  matchChild: boolean;
  // 命中本节点
  matchSelf: boolean;
  // 关键字
  keywords: string;
}

enum EVENT_NAMES {
  filterResultChanged = 'filterResultChanged',

  expandedChanged = 'expandedChanged',

  hiddenChanged = 'hiddenChanged',

  lockedChanged = 'lockedChanged',

  titleLabelChanged = 'titleLabelChanged',

  expandableChanged = 'expandableChanged',

  conditionChanged = 'conditionChanged',
}

export default class TreeNode {
  readonly pluginContext: IOutlinePanelPluginContext;
  event = new EventEmitter();

  private _node: IPublicModelNode;

  readonly tree: Tree;

  private _filterResult: FilterResult = {
    filterWorking: false,
    matchChild: false,
    matchSelf: false,
    keywords: '',
  };

  /**
   * 默认为折叠状态
   * 在初始化根节点时，设置为展开状态
   */
  private _expanded = false;

  id = uniqueId('treeNode');

  get nodeId(): string {
    return this.node.id;
  }

  /**
   * 是否可以展开
   */
  get expandable(): boolean {
    if (this.locked) return false;
    const expandable = this.hasChildren() || this.hasSlots() || this.dropDetail?.index != null;
    return expandable;
  }

  get expanded(): boolean {
    return this.isRoot(true) || (this.expandable && this._expanded);
  }

  /**
   * 插入"线"位置信息
   */
  get dropDetail(): IPublicTypeLocationChildrenDetail | undefined | null {
    const loc = this.pluginContext.project.getCurrentDocument()?.dropLocation;
    return loc && this.isResponseDropping() && isLocationChildrenDetail(loc.detail) ? loc.detail : null;
  }

  get depth(): number {
    return this.node.zLevel;
  }

  get detecting() {
    const doc = this.pluginContext.project.currentDocument;
    return !!(doc?.isDetectingNode(this.node));
  }

  get hidden(): boolean {
    const cv = this.node.isConditionalVisible();
    if (cv == null) {
      return !this.node.visible;
    }
    return !cv;
  }

  get locked(): boolean {
    return this.node.isLocked;
  }

  get selected(): boolean {
    // TODO: check is dragging
    const selection = this.pluginContext.project.getCurrentDocument()?.selection;
    if (!selection) {
      return false;
    }
    return selection?.has(this.node.id);
  }

  get title(): IPublicTypeTitleContent {
    // return this.node.title;
    // 如果是 Slot 节点
    if (this.node.isSlotNode) {
      const slotId = this.node.schema?.id;
      const { parent } = this.node;

      // 尝试从父节点的 list 中找到对应的 label
      if (parent) {
        const list = parent.getPropValue('list');
        if (Array.isArray(list)) {
          const item = list.find((item) => item.children?.id === slotId);
          if (item?.label) {
            return `插槽(${item.label})`;
          }
        }
      }
    }

    // 否则返回默认 title
    return this.node.title;
  }

  get titleLabel() {
    let { title } = this;
    if (!title) {
      return '';
    }
    if ((title as any).label) {
      title = (title as any).label;
    }
    if (typeof title === 'string') {
      return title;
    }
    if (isI18nData(title)) {
      const currentLocale = this.pluginContext.getLocale();
      const currentTitle = title[currentLocale];
      return currentTitle;
    }
    return this.node.componentName;
  }

  get icon() {
    return this.node.componentMeta?.icon;
  }

  get parent(): TreeNode | null {
    const { parent } = this.node;
    if (parent) {
      return this.tree.getTreeNode(parent);
    }
    return null;
  }

  get slots(): TreeNode[] {
    // todo: shallowEqual
    const nodeSlots = this.node.slots;
    // console.log('[📊 TreeNode.slots]', {
    //   componentName: this.node.componentName,
    //   slotsCount: nodeSlots.length,
    //   slotNames: nodeSlots.map((s: any) => s.getExtraProp?.('name')?.getAsString?.() || 'N/A'),
    // });
    return nodeSlots.map((node) => this.tree.getTreeNode(node));
  }

  get condition(): boolean {
    return this.node.hasCondition() && !this.node.conditionGroup;
  }

  get children(): TreeNode[] | null {
    return this.node.children?.map((node) => this.tree.getTreeNode(node)) || null;
  }

  get node(): IPublicModelNode {
    return this._node;
  }

  constructor(tree: Tree, node: IPublicModelNode) {
    this.tree = tree;
    this.pluginContext = tree.pluginContext;
    this._node = node;
  }

  setLocked(flag: boolean) {
    this.node.lock(flag);
    this.event.emit(EVENT_NAMES.lockedChanged, flag);
  }
  deleteNode(node: IPublicModelNode) {
    node && node.remove();
  }
  onFilterResultChanged(fn: () => void): IPublicTypeDisposable {
    this.event.on(EVENT_NAMES.filterResultChanged, fn);
    return () => {
      this.event.off(EVENT_NAMES.filterResultChanged, fn);
    };
  }
  onExpandedChanged(fn: (expanded: boolean) => void): IPublicTypeDisposable {
    this.event.on(EVENT_NAMES.expandedChanged, fn);
    return () => {
      this.event.off(EVENT_NAMES.expandedChanged, fn);
    };
  }
  onHiddenChanged(fn: (hidden: boolean) => void): IPublicTypeDisposable {
    this.event.on(EVENT_NAMES.hiddenChanged, fn);
    return () => {
      this.event.off(EVENT_NAMES.hiddenChanged, fn);
    };
  }
  onLockedChanged(fn: (locked: boolean) => void): IPublicTypeDisposable {
    this.event.on(EVENT_NAMES.lockedChanged, fn);
    return () => {
      this.event.off(EVENT_NAMES.lockedChanged, fn);
    };
  }

  onTitleLabelChanged(fn: (treeNode: TreeNode) => void): IPublicTypeDisposable {
    this.event.on(EVENT_NAMES.titleLabelChanged, fn);

    return () => {
      this.event.off(EVENT_NAMES.titleLabelChanged, fn);
    };
  }

  onConditionChanged(fn: (treeNode: TreeNode) => void): IPublicTypeDisposable {
    this.event.on(EVENT_NAMES.conditionChanged, fn);

    return () => {
      this.event.off(EVENT_NAMES.conditionChanged, fn);
    };
  }

  onExpandableChanged(fn: (expandable: boolean) => void): IPublicTypeDisposable {
    this.event.on(EVENT_NAMES.expandableChanged, fn);
    return () => {
      this.event.off(EVENT_NAMES.expandableChanged, fn);
    };
  }

  /**
   * 触发 onExpandableChanged 回调
   */
  notifyExpandableChanged(): void {
    this.event.emit(EVENT_NAMES.expandableChanged, this.expandable);
  }

  notifyTitleLabelChanged(): void {
    this.event.emit(EVENT_NAMES.titleLabelChanged, this.title);
  }

  notifyConditionChanged(): void {
    this.event.emit(EVENT_NAMES.conditionChanged, this.condition);
  }

  setHidden(flag: boolean) {
    if (this.node.conditionGroup) {
      return;
    }
    if (this.node.visible !== !flag) {
      this.node.visible = !flag;
    }
    this.event.emit(EVENT_NAMES.hiddenChanged, flag);
  }

  isFocusingNode(): boolean {
    const loc = this.pluginContext.project.getCurrentDocument()?.dropLocation;
    if (!loc) {
      return false;
    }
    return (
      isLocationChildrenDetail(loc.detail) && loc.detail.focus?.type === 'node' && loc.detail?.focus?.node.id === this.nodeId
    );
  }

  setExpanded(value: boolean) {
    this._expanded = value;
    this.event.emit(EVENT_NAMES.expandedChanged, value);
  }

  isRoot(includeOriginalRoot = false) {
    const rootNode = this.pluginContext.project.getCurrentDocument()?.root;
    return this.tree.root === this || (includeOriginalRoot && rootNode === this.node);
  }

  /**
   * 是否是响应投放区
   */
  isResponseDropping(): boolean {
    const loc = this.pluginContext.project.getCurrentDocument()?.dropLocation;
    if (!loc) {
      return false;
    }
    return loc.target?.id === this.nodeId;
  }

  setTitleLabel(label: string) {
    const origLabel = this.titleLabel;
    if (label === origLabel) {
      return;
    }
    if (label === '') {
      this.node.getExtraProp('title', false)?.remove();
    } else {
      this.node.getExtraProp('title', true)?.setValue(label);
    }
    this.event.emit(EVENT_NAMES.titleLabelChanged, this);
  }

  /**
   * 是否是容器，允许子节点拖入
   */
  isContainer(): boolean {
    return this.node.isContainerNode;
  }

  /**
   * 判断是否有"插槽"
   */
  hasSlots(): boolean {
    return this.node.hasSlots();
  }

  hasChildren(): boolean {
    return !!(this.isContainer() && this.node.children?.notEmptyNode);
  }

  select(isMulti: boolean) {
    const { node } = this;

    const selection = this.pluginContext.project.getCurrentDocument()?.selection;
    if (isMulti) {
      selection?.add(node.id);
    } else {
      selection?.select(node.id);
    }
  }

  /**
   * 展开节点，支持依次展开父节点
   */
  expand(tryExpandParents = false) {
    // 这边不能直接使用 expanded，需要额外判断是否可以展开
    // 如果只使用 expanded，会漏掉不可以展开的情况，即在不可以展开的情况下，会触发展开
    if (this.expandable && !this._expanded) {
      this.setExpanded(true);
    }
    if (tryExpandParents) {
      this.expandParents();
    }
  }

  expandParents() {
    let p = this.node.parent;
    while (p) {
      this.tree.getTreeNode(p).setExpanded(true);
      p = p.parent;
    }
  }

  setNode(node: IPublicModelNode) {
    if (this._node !== node) {
      this._node = node;
    }
  }

  get filterReult(): FilterResult {
    return this._filterResult;
  }

  setFilterReult(val: FilterResult) {
    this._filterResult = val;
    this.event.emit(EVENT_NAMES.filterResultChanged);
  }
}

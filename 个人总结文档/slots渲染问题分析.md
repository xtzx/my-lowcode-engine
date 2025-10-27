# Tabs 组件 Slots 数量渲染问题分析

## 🐛 问题描述

在大纲树（Outline Pane）中，容器类组件（如 Tabs）的插槽（slots）数量渲染存在问题：
- 在配置端添加一个 tab 时
- `treeNode.slots` 数量可能不变
- 或者可能多出两个

## 📊 数据流程梳理

### 1. Slots 数据结构

**底层 Node 定义** (`packages/designer/src/document/node/node.ts:333-337`)
```typescript
@obx.shallow _slots: INode[] = [];

get slots(): INode[] {
  return this._slots;
}
```

### 2. Slots 修改流程

**添加 Slot** (`packages/designer/src/document/node/node.ts:1049-1057`)
```typescript
addSlot(slotNode: INode) {
  const slotName = slotNode?.getExtraProp('name')?.getAsString();
  // ⚠️ 关键逻辑：如果已存在相同 slotName 的 slot，先删除旧的
  if (includeSlot(this, slotName)) {
    removeSlot(this, slotName);
  }
  slotNode.internalSetParent(this as INode, true);
  this._slots.push(slotNode);  // ⚠️ 直接修改数组，没有触发事件！
}
```

**删除 Slot** (`packages/designer/src/document/node/node.ts:1022-1028`)
```typescript
unlinkSlot(slotNode: INode) {
  const i = this._slots.indexOf(slotNode);
  if (i < 0) {
    return false;
  }
  this._slots.splice(i, 1);  // ⚠️ 直接修改数组，没有触发事件！
}
```

**调用时机** (`packages/designer/src/document/node/props/prop.ts:456-465`)
```typescript
// 当属性值设置为 Slot 类型时
setAsSlot(data: IPublicTypeJSSlot) {
  if (this._slotNode) {
    this._slotNode.import(slotSchema);
  } else {
    const { owner } = this.props;
    this._slotNode = owner.document?.createNode<ISlotNode>(slotSchema);
    if (this._slotNode) {
      owner.addSlot(this._slotNode);  // ⚠️ 调用 addSlot
      this._slotNode.internalSetSlotFor(this);
    }
  }
}
```

### 3. Outline Pane 渲染流程

**TreeNode slots getter** (`packages/plugin-outline-pane/src/controllers/tree-node.ts:154-157`)
```typescript
get slots(): TreeNode[] {
  // todo: shallowEqual  ⚠️ 注释说明开发者意识到可能需要浅比较
  return this.node.slots.map((node) => this.tree.getTreeNode(node));
}
```

**TreeNodeSlots 组件** (`packages/plugin-outline-pane/src/views/tree-branches.tsx:190-218`)
```typescript
class TreeNodeSlots extends PureComponent<{  // ⚠️ 使用 PureComponent
    treeNode: TreeNode;
  }> {
  render() {
    const { treeNode } = this.props;
    if (!treeNode.hasSlots()) {
      return null;
    }

    return (
      <div className="tree-node-slots">
        {treeNode.slots.map(tnode => (  // ⚠️ 每次 render 都会重新计算
          <TreeNodeView key={tnode.nodeId} treeNode={tnode} />
        ))}
      </div>
    );
  }
}
```

### 4. 事件监听机制

**Tree 类的监听** (`packages/plugin-outline-pane/src/controllers/tree.ts:27-31`)
```typescript
doc?.onChangeNodeChildren((info: {node: IPublicModelNode }) => {
  const { node } = info;
  const treeNode = this.getTreeNodeById(node.id);
  treeNode?.notifyExpandableChanged();  // ✅ children 变化时会通知
});

// ⚠️ 但是没有监听 slots 变化！
```

## 🔍 问题根源分析

### 根本原因：响应式失效

1. **PureComponent 的浅比较限制**
   - `TreeNodeSlots` 使用 `PureComponent`
   - 只对 props 进行浅比较（`===`）
   - `props.treeNode` 是同一个对象引用，永远相等
   - 即使 `treeNode.slots` 数据变了，组件也不会重新渲染

2. **缺少事件通知机制**
   - `addSlot` 和 `unlinkSlot` 直接修改 `_slots` 数组
   - 没有触发任何事件通知
   - Outline Pane 无法感知 slots 变化

3. **Mobx 响应式断链**
   - 虽然 `_slots` 用 `@obx.shallow` 装饰
   - Mobx 可以检测到 `push`/`splice` 操作
   - 但 `TreeNodeSlots` 是普通 React 组件，不是 mobx observer
   - 无法自动响应 mobx 数据变化

### 为什么有时候能更新？

**触发条件**：当发生以下情况时，会"意外"触发重新渲染
1. 节点选中/取消选中
2. 节点展开/折叠
3. 其他属性变化导致父组件重新渲染
4. 手动刷新页面

### 为什么有时候多两个？

**可能原因**：
1. `addSlot` 中的删除逻辑（`removeSlot`）失败
2. 在某些异步场景下，新旧 slot 都被保留
3. 重复调用 `addSlot` 但删除逻辑未正确执行

## 🎯 expandable 的对比

**为什么 expandable 能正常工作？**

```typescript
// TreeNode.ts:72-75
get expandable(): boolean {
  if (this.locked) return false;
  return this.hasChildren() || this.hasSlots() || this.dropDetail?.index != null;
}

// Tree.ts:27-31
doc?.onChangeNodeChildren((info) => {
  treeNode?.notifyExpandableChanged();  // ✅ 触发事件
});

// TreeNodeView.tsx:157-162
treeNode.onExpandableChanged((expandable: boolean) => {
  this.setState({
    expandable,  // ✅ 更新 state，触发重新渲染
    treeChildren: treeNode.children,
  });
});
```

**对比 slots**：
- ❌ 没有 `onSlotsChanged` 事件
- ❌ 没有在 state 中保存 slots
- ❌ 依赖 props 触发渲染（但 props 不变）

## 💡 解决方案

### 方案 1：添加 slots 变化事件（推荐）

**步骤 1：在 Node 类中添加 slots 变化通知**
```typescript
// packages/designer/src/document/node/node.ts
addSlot(slotNode: INode) {
  const slotName = slotNode?.getExtraProp('name')?.getAsString();
  if (includeSlot(this, slotName)) {
    removeSlot(this, slotName);
  }
  slotNode.internalSetParent(this as INode, true);
  this._slots.push(slotNode);

  // ✅ 新增：触发 children 变化事件
  this.document?.onChangeNodeChildren?.emit?.({ node: this });
}

unlinkSlot(slotNode: INode) {
  const i = this._slots.indexOf(slotNode);
  if (i < 0) {
    return false;
  }
  this._slots.splice(i, 1);

  // ✅ 新增：触发 children 变化事件
  this.document?.onChangeNodeChildren?.emit?.({ node: this });
}
```

**步骤 2：在 TreeNodeSlots 中监听并保存到 state**
```typescript
class TreeNodeSlots extends PureComponent<{
    treeNode: TreeNode;
  }, {
    slots: TreeNode[];
  }> {

  state = {
    slots: this.props.treeNode.slots,
  };

  private offSlotsChanged: (() => void) | null = null;

  componentDidMount() {
    const { treeNode } = this.props;

    // 监听 expandable 变化（slots 变化会触发 expandable 变化）
    this.offSlotsChanged = treeNode.onExpandableChanged(() => {
      this.setState({ slots: treeNode.slots });
    });
  }

  componentWillUnmount() {
    this.offSlotsChanged?.();
  }

  render() {
    const { treeNode } = this.props;
    const { slots } = this.state;

    if (!treeNode.hasSlots()) {
      return null;
    }

    return (
      <div className="tree-node-slots">
        {slots.map(tnode => (
          <TreeNodeView key={tnode.nodeId} treeNode={tnode} />
        ))}
      </div>
    );
  }
}
```

### 方案 2：使用 Mobx Observer（最简单）

```typescript
import { observer } from 'mobx-react';

const TreeNodeSlots = observer(({ treeNode }: { treeNode: TreeNode }) => {
  if (!treeNode.hasSlots()) {
    return null;
  }

  return (
    <div className="tree-node-slots">
      {treeNode.slots.map(tnode => (
        <TreeNodeView key={tnode.nodeId} treeNode={tnode} />
      ))}
    </div>
  );
});
```

### 方案 3：改为普通 Component

```typescript
class TreeNodeSlots extends Component<{  // 去掉 Pure
    treeNode: TreeNode;
  }> {
  render() {
    // ... 保持不变
  }
}
```

## 📋 推荐方案对比

| 方案 | 优点 | 缺点 | 实施难度 |
|------|------|------|---------|
| 方案1：事件通知 | 架构清晰，符合现有模式 | 需要修改多处代码 | ⭐⭐⭐ |
| 方案2：Mobx Observer | 简单快速，自动响应 | 增加 mobx-react 依赖 | ⭐ |
| 方案3：普通组件 | 改动最小 | 性能略差（每次都渲染） | ⭐ |

## 🔧 立即可用的临时方案

在 `TreeNodeSlots` 中保存 slots 到 state，并监听 expandable 变化：

```typescript
// packages/plugin-outline-pane/src/views/tree-branches.tsx
class TreeNodeSlots extends PureComponent<{
    treeNode: TreeNode;
  }, {
    slots: TreeNode[];
    slotsVersion: number;
  }> {

  state = {
    slots: this.props.treeNode.slots,
    slotsVersion: 0,
  };

  private offExpandableChanged: (() => void) | null = null;

  componentDidMount() {
    // slots 变化会影响 expandable，所以监听 expandable 变化
    this.offExpandableChanged = this.props.treeNode.onExpandableChanged(() => {
      const newSlots = this.props.treeNode.slots;
      // 比较 slots 数量是否变化
      if (newSlots.length !== this.state.slots.length) {
        this.setState({
          slots: newSlots,
          slotsVersion: this.state.slotsVersion + 1,
        });
      }
    });
  }

  componentWillUnmount() {
    this.offExpandableChanged?.();
  }

  render() {
    const { treeNode } = this.props;
    const { slots } = this.state;

    if (!treeNode.hasSlots()) {
      return null;
    }

    return (
      <div className="tree-node-slots">
        {slots.map(tnode => (
          <TreeNodeView key={tnode.nodeId} treeNode={tnode} />
        ))}
      </div>
    );
  }
}
```

## ✅ 总结

**核心问题**：
1. Slots 变化时没有触发事件通知
2. TreeNodeSlots 是 PureComponent，无法感知深层数据变化
3. 缺少响应式更新机制

**推荐解决方向**：
- **短期**：使用方案3（改为普通组件）或临时方案（监听 expandable）
- **长期**：使用方案1（添加完整的事件通知机制）或方案2（引入 mobx observer）





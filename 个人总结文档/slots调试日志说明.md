# Slots 渲染问题调试日志说明

## 📋 已添加日志的位置

### 1. **packages/designer/src/document/node/props/prop.ts**

#### `setValue()` 方法
- **触发时机**：每次属性值变化时
- **关键日志**：
  ```
  [Prop.setValue] START - 记录 propId, propKey, 新旧值类型
  [Prop.setValue] detected JSSlot, calling setAsSlot - 检测到 JSSlot
  [Prop.setValue] calling dispose - 调用清理
  [Prop.setValue] calling setupItems - 重建 items
  [Prop.setValue] END
  ```

#### `dispose()` 方法
- **触发时机**：`setValue` 时清理旧数据
- **关键日志**：
  ```
  [Prop.dispose] START - 记录 type, itemsCount, mapsKeys, slotNode 信息
  [Prop.dispose] purging child prop - 遍历清理每个子 Prop
  [Prop.dispose] removing own slotNode - 移除 slotNode（如果有）
  [Prop.dispose] END
  ```

#### `purge()` 方法
- **触发时机**：Prop 被销毁时
- **关键日志**：
  ```
  [Prop.purge] START - 记录 type, hasSlotNode, slotForMatches
  [Prop.purge] removing slotNode - 实际移除 slotNode
  [Prop.purge] slotNode exists but slotFor does NOT match - ⚠️ 警告：slotFor 不匹配
  [Prop.purge] END
  ```

#### `setAsSlot()` 方法
- **触发时机**：属性值是 JSSlot 时
- **关键日志**：
  ```
  [Prop.setAsSlot] START - 记录 propId, dataName, hasExistingSlotNode, ownerSlotsCount
  [Prop.setAsSlot] call stack - 完整调用栈
  [Prop.setAsSlot] slotSchema - slot 的 schema 信息
  [Prop.setAsSlot] REUSING existing slotNode - 复用已有 slot
  [Prop.setAsSlot] CREATING new slotNode - 创建新 slot
  [Prop.setAsSlot] calling owner.addSlot - 调用 addSlot，记录 ownerCurrentSlotsCount
  [Prop.setAsSlot] END
  ```

#### `items` getter（重要！）
- **触发时机**：访问 Prop 的 items 时（数组/对象子项）
- **关键日志**：
  ```
  [Prop.items getter] START rebuilding items - 记录 type, mapsKeys, valueLength
  [Prop.items getter] processing LIST - 处理数组类型
  [Prop.items getter] processing item - 每个数组项的处理
  [Prop.items getter] REUSING old prop - ⚠️ 复用旧 Prop（关键！）
  [Prop.items getter] CREATING new prop - 创建新 Prop
  [Prop.items getter] old prop NOT reused, should have been purged - ⚠️ 警告：旧 Prop 未复用
  [Prop.items getter] END
  ```

---

### 2. **packages/designer/src/document/node/node.ts**

#### `addSlot()` 方法
- **触发时机**：向 Node 添加 slot 时
- **关键日志**：
  ```
  [Node.addSlot] START - 记录 nodeId, slotNodeId, slotName, currentSlotsCount
  [Node.addSlot] call stack - 完整调用栈
  [Node.addSlot] found duplicate slotName, calling removeSlot - 发现重复，调用去重
  [Node.addSlot] END - 记录 newSlotsCount, newSlotIds, newSlotNames
  ```

#### `removeSlot()` 方法
- **触发时机**：从 Node 移除 slot 时
- **关键日志**：
  ```
  [Node.removeSlot] START - 记录 slotNodeId, slotName, currentSlotsCount
  [Node.removeSlot] call stack - 完整调用栈
  [Node.removeSlot] slot NOT found in _slots array - ⚠️ 警告：slot 不在数组中
  [Node.removeSlot] END - 记录移除的索引，剩余 slots
  ```

#### `unlinkSlot()` 方法
- **触发时机**：断开 slot 关联时
- **关键日志**：
  ```
  [Node.unlinkSlot] START - 记录 slotNodeId, currentSlotsCount
  [Node.unlinkSlot] slot NOT found in _slots array - ⚠️ 警告：slot 不在数组中
  [Node.unlinkSlot] END - 记录移除的索引，剩余 slots
  ```

---

### 3. **packages/plugin-outline-pane/src/controllers/tree-node.ts**

#### `slots` getter
- **触发时机**：TreeNode 访问 slots 时
- **关键日志**：
  ```
  [TreeNode.slots getter] - 记录 nodeId, componentName, slotsCount, slotIds, slotNames
  ```

---

### 4. **packages/plugin-outline-pane/src/views/tree-branches.tsx**

#### `TreeNodeSlots render()`
- **触发时机**：渲染插槽列表时
- **关键日志**：
  ```
  [TreeNodeSlots render] - 记录 treeNodeId, nodeId, componentName, slotsLength
  ```

---

## 🔍 调试步骤

### 1. 清理控制台
```javascript
console.clear();
```

### 2. 执行删除操作
- 删除 tabs 组件的一个标签项

### 3. 查看日志输出

按照以下顺序检查日志：

#### ① 检查 `setValue` 流程
```
[Prop.setValue] START { propKey: "list", newValueType: "object", isArray: true }
```
- 确认删除后 `list` 数组的长度是否正确

#### ② 检查 `dispose` 流程
```
[Prop.dispose] START { key: "list", itemsCount: 4, mapsKeys: ["0","1","2","3"] }
[Prop.dispose] purging child prop { idx: 0, childKey: 0, hasSlotNode: true }
[Prop.dispose] purging child prop { idx: 1, childKey: 1, hasSlotNode: true }
...
```
- 确认是否调用了所有子项的 `purge()`
- 确认 `mapsKeys` 是否包含所有旧项的索引

#### ③ 检查 `purge` 流程（关键！）
```
[Prop.purge] START { key: 1, hasSlotNode: true, slotForMatches: true }
[Prop.purge] removing slotNode { slotNodeId: "node_xxx", slotName: "slot_2yyx" }
```
- **如果 `slotForMatches: false`**，说明 `slotFor` 指向错误，slot **不会被移除**
- **如果没有 `[Prop.purge] removing slotNode` 日志**，说明 slot **没有被移除**

#### ④ 检查 `removeSlot` 是否被调用
```
[Node.removeSlot] START { slotNodeId: "node_xxx", slotName: "slot_2yyx" }
[Node.removeSlot] END, removed at index 1, remaining slots: ["node_aaa", "node_bbb", "node_ccc"]
```
- **如果没有此日志**，说明 `removeSlot` **根本没有被调用**
- **如果有 `slot NOT found` 警告**，说明 slot 已经不在数组中了

#### ⑤ 检查 `items getter` 复用逻辑（最关键！）
```
[Prop.items getter] START rebuilding items { mapsKeys: ["0","1","2","3"], valueLength: 3 }
[Prop.items getter] processing item { idx: 0, hasOldProp: true, itemKey: "bgbs" }
[Prop.items getter] REUSING old prop { idx: 0, oldPropPurged: false }
[Prop.items getter] processing item { idx: 1, hasOldProp: true, itemKey: "dp93" }
[Prop.items getter] REUSING old prop { idx: 1, oldPropPurged: ??? }  ← 关键！
[Prop.items getter] old prop NOT reused { oldKey: "3", oldPropPurged: ??? }
```
- **如果 `idx: 1` 复用的 Prop 的 `oldPropPurged: true`**，说明**复用了已销毁的 Prop**！
- **如果 `hasOldProp: true` 但 item 是新的**，说明**索引匹配错误**！

#### ⑥ 检查 `setAsSlot` 调用次数和时机
```
[Prop.setAsSlot] START { propKey: "children", dataName: "slot_dp93" }
[Prop.setAsSlot] REUSING existing slotNode { slotNodeId: "node_xxx" }
```
- **如果同一个 `dataName` 调用了多次 `setAsSlot` 且都是 CREATING**，说明重复创建
- **如果调用了 `owner.addSlot`**，查看 `ownerCurrentSlotsCount` 是否正确

#### ⑦ 最终检查 `TreeNode.slots` 数量
```
[TreeNode.slots getter] { slotsCount: 4, slotIds: [...], slotNames: [...] }
```
- 对比 `slotsCount` 与实际 schema 中的 list 数量

---

## 🎯 预期发现的问题

### 假设：删除 list[1] 后

**问题场景：`items getter` 使用索引复用 Prop**

```
删除前：list = [item0(slot_cuaa), item1(slot_2yyx), item2(slot_dp93), item3(slot_459e)]
            _maps = { "0": Prop0, "1": Prop1, "2": Prop2, "3": Prop3 }

删除后：list = [item0(slot_cuaa), item2(slot_dp93), item3(slot_459e)]

setupItems 复用逻辑：
  idx=0, itemKey="bgbs" → 复用 _maps["0"] ✓ 正确，Prop0 → item0
  idx=1, itemKey="dp93" → 复用 _maps["1"] ✗ 错误！Prop1(已purge) → item2
  idx=2, itemKey="459e" → 复用 _maps["2"] ✗ 错误！Prop2 → item3
```

**预期日志**：
```
[Prop.dispose] START { itemsCount: 4, mapsKeys: ["0","1","2","3"] }
[Prop.dispose] purging child prop { idx: 1, childHasSlotNode: true, childSlotNodeId: "node_xxx" }
[Prop.purge] START { key: 1, hasSlotNode: true }
[Prop.purge] removing slotNode { slotNodeId: "node_xxx", slotName: "slot_2yyx" }
[Node.removeSlot] START { slotName: "slot_2yyx" }
[Node.removeSlot] END, removed at index 1

[Prop.items getter] START rebuilding items { mapsKeys: ["0","1","2","3"], valueLength: 3 }
[Prop.items getter] processing item { idx: 1, hasOldProp: true, itemKey: "dp93" }
[Prop.items getter] REUSING old prop { idx: 1, oldPropPurged: TRUE }  ← 问题！
[Prop.items getter] old prop NOT reused { oldKey: "3", oldPropPurged: false }

[Prop.setValue] detected JSSlot, calling setAsSlot
[Prop.setAsSlot] REUSING existing slotNode { slotNodeId: "node_xxx" }  ← slot_2yyx 的 node
[Prop.setAsSlot] calling owner.addSlot { ownerCurrentSlotsCount: 3 }
[Node.addSlot] found duplicate slotName  ← 可能没有去重，因为 slotName 已经改变了
```

---

## 📝 将日志结果发给我

请执行以下步骤：

1. 打开浏览器控制台
2. 执行 `console.clear()`
3. **删除 tabs 的第 2 个标签项**（index=1）
4. 复制**所有**控制台日志
5. 将日志粘贴给我

**特别关注**：
- 所有 `[Prop.purge]` 日志，尤其是 `slotForMatches` 字段
- 所有 `[Prop.items getter]` 日志，尤其是 `REUSING old prop` 的 `oldPropPurged` 字段
- 所有 `[Node.removeSlot]` 日志
- 是否有任何 `⚠️ 警告` 日志

---

## 🔧 构建项目

由于添加了很多日志，需要重新构建：

```bash
# 使用 bash 执行 nvm 命令
bash -c "source ~/.nvm/nvm.sh && nvm use 18.20.0 && cd /Users/bjhl/Documents/WorkProject/lowcode-engine && npm run build:umd"
```

或者分步执行：
```bash
bash
source ~/.nvm/nvm.sh
nvm use 18.20.0
cd /Users/bjhl/Documents/WorkProject/lowcode-engine
npm run build:umd
```

---

## 🎉 日志完成

所有关键位置都已添加日志，现在可以清晰地追踪：
1. ✅ Prop 的创建、更新、销毁流程
2. ✅ Slot 的添加、移除流程
3. ✅ 数组项的复用逻辑
4. ✅ TreeNode 渲染时的 slots 数量

把调试日志发给我后，我会精确定位问题原因并给出解决方案！🚀


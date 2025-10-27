# Slots 渲染问题调试 - 简化版日志

## 📋 关键日志说明

### 图标含义
- 🔵 蓝色：数组变化
- 🟡 黄色：数组项复用逻辑（**最关键！**）
- 🟢 绿色：添加 slot
- 🔴 红色：移除 slot
- ⚠️ 警告：异常情况
- 📊 紫色：最终结果

---

## 🔍 会看到的日志

### 1. 删除 list 项时

```
[🔵 Prop.setValue] list 数组变化
  oldLength: 4
  newLength: 3
```
👆 确认数组确实从 4 项变成了 3 项

---

### 2. 重建 list items（核心！）

```
[🟡 items getter] 重建 list items
  oldMapsKeys: ["0", "1", "2", "3"]
  newDataLength: 3
```
👆 旧的 _maps 有 4 个键（索引 0-3），新数据只有 3 项

---

### 3. 逐项复用检查（最关键！）

```
[🟡 items[0]] 复用旧 Prop
  oldPropPurged: false
  itemKey: "bgbs"
  itemSlotName: "slot_cuaa"
```
👆 索引 0：复用旧 Prop[0]，正常 ✅

```
[🟡 items[1]] 复用旧 Prop
  oldPropPurged: ??? ← 关键！
  itemKey: "dp93"
  itemSlotName: "slot_dp93"
```
👆 索引 1：**复用旧 Prop[1]**，但数据是 item2！
- 如果 `oldPropPurged: true` → 问题确认！复用了已销毁的 Prop
- 如果 `oldPropPurged: false` → 旧 Prop 没被正确 purge

```
[🟡 items[2]] 复用旧 Prop
  oldPropPurged: false
  itemKey: "459e"
  itemSlotName: "slot_459e"
```
👆 索引 2：复用旧 Prop[2]，但数据是 item3

```
[⚠️ items] 旧 Prop[3] 未被复用
  purged: ???
```
👆 旧 Prop[3] 没有被复用
- 如果 `purged: true` → 正常，已被 purge
- 如果 `purged: false` → 异常！没有被 purge

---

### 4. Slot 移除日志

```
[🔴 purge] 移除 slot
  slotName: "slot_2yyx"
```
👆 Prop purge 时调用了 `slotNode.remove()`

```
[🔴 removeSlot]
  slotName: "slot_2yyx"
  beforeCount: 4
[🔴 removeSlot] 完成
  afterCount: 3
```
👆 Node 的 `removeSlot` 被调用，slots 数量从 4 减少到 3

---

### 5. Slot 添加日志（问题场景）

```
[🟢 setAsSlot] 新建 slot
  slotName: "slot_dp93"
  ownerSlotsCount: 3
```
👆 创建新 slot 时，owner 当前有 3 个 slots

```
[🟢 addSlot]
  slotName: "slot_dp93"
  beforeCount: 3
[🟢 addSlot] 发现重复 slotName，移除旧的  ← 可能不会出现
[🟢 addSlot] 完成
  afterCount: 4
```
👆 添加 slot 后，数量变成 4

---

### 6. 最终结果

```
[📊 TreeNode.slots]
  componentName: "SingleTabs"
  slotsCount: 4  ← 应该是 3！
  slotNames: ["slot_cuaa", "slot_2yyx", "slot_dp93", "slot_459e"]
```
👆 UI 渲染时，slots 数量仍然是 4

---

## ⚠️ 关键警告日志

### 如果看到这个：
```
[⚠️ purge] slotFor 不匹配，slot 未移除！
  slotId: "node_xxx"
  slotName: "slot_2yyx"
```
👆 **问题根源**：`slotFor` 指向错误，导致 slot 没有被移除！

### 如果看到这个：
```
[⚠️ removeSlot] slot 不在 _slots 数组中！
```
👆 尝试移除 slot，但它已经不在数组里了

---

## 🎯 预期的问题日志

删除 list[1] 后，预期会看到：

```
[🔵 Prop.setValue] list 数组变化 { oldLength: 4, newLength: 3 }
[🟡 items getter] 重建 list items { oldMapsKeys: ["0","1","2","3"], newDataLength: 3 }
[🟡 items[0]] 复用旧 Prop { oldPropPurged: false, itemKey: "bgbs", itemSlotName: "slot_cuaa" }
[🟡 items[1]] 复用旧 Prop { oldPropPurged: TRUE, itemKey: "dp93", itemSlotName: "slot_dp93" }
                                      ^^^^^^^^ 问题！复用了已销毁的 Prop
[🟡 items[2]] 复用旧 Prop { oldPropPurged: false, itemKey: "459e", itemSlotName: "slot_459e" }
[⚠️ items] 旧 Prop[3] 未被复用 { purged: true }

[🔴 purge] 移除 slot { slotName: "slot_2yyx" }
[🔴 removeSlot] { slotName: "slot_2yyx", beforeCount: 4 }
[🔴 removeSlot] 完成 { afterCount: 3 }

[🟢 setAsSlot] 新建 slot { slotName: "slot_dp93", ownerSlotsCount: 3 }
[🟢 addSlot] { slotName: "slot_dp93", beforeCount: 3 }
[🟢 addSlot] 完成 { afterCount: 4 }  ← slot 又变成 4 个了！

[📊 TreeNode.slots] { componentName: "SingleTabs", slotsCount: 4 }
```

---

## 🔧 操作步骤

### 1. 构建项目
```bash
bash -c "source ~/.nvm/nvm.sh && nvm use 18.20.0 && cd /Users/bjhl/Documents/WorkProject/lowcode-engine && npm run build:umd"
```

### 2. 执行调试
1. 打开浏览器控制台
2. 执行 `console.clear()`
3. **删除 tabs 的第 2 个标签项**（index=1）
4. 观察控制台日志

### 3. 重点关注
- 🟡 **items[1] 是否复用了已 purge 的 Prop**
- 🔴 **removeSlot 是否被调用**
- 🟢 **addSlot 是否导致数量增加**
- 📊 **最终 slotsCount 是否正确**

---

## 📝 预计日志数量

简化后，删除一个 tab 大约会产生：
- 10-15 行核心日志
- 0-5 行警告日志

总计不超过 **20 行**，便于查看和分析！🎉

---

## 💡 把日志发给我

复制控制台中**所有带图标的日志**（🔵🟡🟢🔴⚠️📊），粘贴给我即可！


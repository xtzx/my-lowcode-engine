# ArraySetter 真正原因与解决方案

> **问题**: 修改数组项顺序后，实际页面正确显示，但 ArraySetter UI 没有更新
>
> **Date**: 2025-10-30

---

## 🔍 问题根源定位

### 关键代码：`getDerivedStateFromProps`

```typescript
// 第 75-103 行
static getDerivedStateFromProps(props: ArraySetterProps, state: ArraySetterState) {
  const items: IPublicModelSettingField[] = [];
  const { value, field } = props;
  const valueLength = value && Array.isArray(value) ? value.length : 0;

  for (let i = 0; i < valueLength; i++) {
    let item = state.items[i];  // ← 问题1：按索引复用
    if (!item) {
      // 创建新 SettingField
      item = field.createField({
        name: i.toString(),
        setter: props.itemSetter,
        forceInline: 1,
        type: 'field',
        extraProps: {
          defaultValue: value[i],
          setValue: (target: IPublicModelSettingField) => {
            onItemChange(target, i, item, props);
          },
        },
      });
      item.setValue(value[i]);  // ← 只在创建时设置值
    }
    // ⚠️ 问题2：复用时没有更新数据！
    items.push(item);
  }

  return {
    items,
  };
}
```

### 🚨 致命问题

**问题 1：按索引复用，不按数据的唯一性**
```typescript
let item = state.items[i];  // ← 使用数组索引 i 来查找
```

**问题 2：复用时没有调用 `setValue`**
```typescript
if (!item) {
  // ...
  item.setValue(value[i]);  // ← 只有创建新 item 时才设置值
}
// 复用的 item 没有更新值！
items.push(item);
```

---

## 📊 完整执行流程分析

### 场景设置

```typescript
// Tabs 组件的 list 属性
初始数据: [
  { key: 'A', label: '标签A', children: {...} },
  { key: 'B', label: '标签B', children: {...} },
  { key: 'C', label: '标签C', children: {...} }
]

用户拖拽后: [
  { key: 'B', label: '标签B', children: {...} },
  { key: 'A', label: '标签A', children: {...} },
  { key: 'C', label: '标签C', children: {...} }
]
```

---

### 🔴 场景 1：`this._maps` 未清空（之前的行为）

#### Step 1: 初始状态

```typescript
// Prop 层（packages/designer/src/document/node/props/prop.ts）
Prop('list')._value = [A数据, B数据, C数据]
Prop('list')._maps = {
  '0': prop_A,
  '1': prop_B,
  '2': prop_C
}
Prop('list')._items = [prop_A, prop_B, prop_C]

// ArraySetter 层
ArraySetter.state.items = [
  field_A (持有 prop_A 的引用),
  field_B (持有 prop_B 的引用),
  field_C (持有 prop_C 的引用)
]
```

#### Step 2: 用户拖拽，数据变化

```typescript
// 1. schema 数据变成 [B, A, C]
// 2. 触发 Prop('list').setValue([B数据, A数据, C数据])
// 3. dispose() 执行，但 this._maps 没有清空（之前的 bug）
// 4. items getter 重新执行

// items getter 逻辑（之前的实现，_maps 未清空）
data.forEach((item: any, idx: number) => {
  // idx=0, item=B数据
  const hasOldProp = this._maps?.has('0');  // ✅ true
  prop = this._maps.get('0');  // 得到 prop_A
  prop.setValue(B数据);  // ← 关键！prop_A 内部数据被更新为 B
  maps.set('0', prop_A);

  // idx=1, item=A数据
  const hasOldProp = this._maps?.has('1');  // ✅ true
  prop = this._maps.get('1');  // 得到 prop_B
  prop.setValue(A数据);  // ← prop_B 内部数据被更新为 A
  maps.set('1', prop_B);

  // idx=2, item=C数据
  const hasOldProp = this._maps?.has('2');  // ✅ true
  prop = this._maps.get('2');  // 得到 prop_C
  prop.setValue(C数据);  // ← prop_C 内部数据被更新为 C
  maps.set('2', prop_C);
});

// 结果
Prop('list')._items = [
  prop_A(数据=B),  // ← 引用不变，但内部数据变了
  prop_B(数据=A),
  prop_C(数据=C)
]
```

#### Step 3: ArraySetter.getDerivedStateFromProps 执行

```typescript
// props.value = [prop_A(数据=B), prop_B(数据=A), prop_C(数据=C)]

for (let i = 0; i < 3; i++) {
  let item = state.items[i];  // 复用旧的 field

  // i=0: state.items[0] = field_A
  // field_A 持有 prop_A 的引用
  // 虽然没有调用 field_A.setValue()，但 prop_A 的内部数据已经是 B
  // 所以 field_A.getValue() 会返回 B 的数据！

  // i=1: state.items[1] = field_B
  // field_B 持有 prop_B 的引用，prop_B 内部数据是 A

  // i=2: state.items[2] = field_C
  // field_C 持有 prop_C 的引用，prop_C 内部数据是 C
}

// 结果
ArraySetter.state.items = [
  field_A → prop_A(数据=B),  // ← 显示 B ✅
  field_B → prop_B(数据=A),  // ← 显示 A ✅
  field_C → prop_C(数据=C)   // ← 显示 C ✅
]
```

#### Step 4: UI 渲染

```typescript
items.map((field) => (
  <ArrayItem key={field.id} field={field} />
))

// field_A.getValue() → prop_A.getValue() → B数据 ✅
// field_B.getValue() → prop_B.getValue() → A数据 ✅
// field_C.getValue() → prop_C.getValue() → C数据 ✅
```

**结果**：✅ UI 正确显示 [B, A, C]

**原理**：虽然 ArraySetter 没有更新 SettingField，但 Prop 的内部数据被更新了，所以间接地让 UI 显示正确。

---

### 🟢 场景 2：`this._maps` 已清空（当前的行为）

#### Step 1: 初始状态（同上）

```typescript
Prop('list')._items = [prop_A, prop_B, prop_C]
ArraySetter.state.items = [field_A, field_B, field_C]
```

#### Step 2: 用户拖拽，数据变化

```typescript
// 1. schema 数据变成 [B, A, C]
// 2. 触发 Prop('list').setValue([B数据, A数据, C数据])
// 3. dispose() 执行
this._items = null;
this._maps = null;  // ← 清空了！

// 4. items getter 重新执行
data.forEach((item: any, idx: number) => {
  // idx=0, item=B数据
  const hasOldProp = this._maps?.has('0');  // ❌ false (因为 _maps = null)
  prop = new Prop(this, B数据, 0);  // 创建全新的 Prop
  maps.set('0', new_prop_B);

  // idx=1, item=A数据
  const hasOldProp = this._maps?.has('1');  // ❌ false
  prop = new Prop(this, A数据, 1);  // 创建全新的 Prop
  maps.set('1', new_prop_A);

  // idx=2, item=C数据
  const hasOldProp = this._maps?.has('2');  // ❌ false
  prop = new Prop(this, C数据, 2);  // 创建全新的 Prop
  maps.set('2', new_prop_C);
});

// 结果
Prop('list')._items = [
  new_prop_B(数据=B),  // ← 全新的实例
  new_prop_A(数据=A),  // ← 全新的实例
  new_prop_C(数据=C)   // ← 全新的实例
]

// props.value 也变成了新的数组引用
props.value = [new_prop_B, new_prop_A, new_prop_C]
```

#### Step 3: ArraySetter.getDerivedStateFromProps 执行

```typescript
// props.value = [new_prop_B, new_prop_A, new_prop_C]
// state.items = [field_A, field_B, field_C]

for (let i = 0; i < 3; i++) {
  let item = state.items[i];

  // i=0: state.items[0] = field_A
  // field_A 还持有旧的 prop_A 的引用！
  // 而 props.value[0] = new_prop_B
  // 但 getDerivedStateFromProps 没有调用 field_A.setValue()
  // 所以 field_A 还是指向旧的 prop_A！
  items.push(field_A);  // ← 问题！field_A 持有的是 prop_A，而不是 new_prop_B

  // i=1: state.items[1] = field_B
  // 同样的问题
  items.push(field_B);

  // i=2: state.items[2] = field_C
  items.push(field_C);
}

// 结果
ArraySetter.state.items = [
  field_A → 旧的 prop_A(数据=A),  // ← 显示 A ❌ 应该显示 B
  field_B → 旧的 prop_B(数据=B),  // ← 显示 B ❌ 应该显示 A
  field_C → 旧的 prop_C(数据=C)   // ← 显示 C ✅
]
```

#### Step 4: UI 渲染

```typescript
items.map((field) => (
  <ArrayItem key={field.id} field={field} />
))

// field_A.getValue() → 旧的 prop_A.getValue() → A数据 ❌ 错误！
// field_B.getValue() → 旧的 prop_B.getValue() → B数据 ❌ 错误！
// field_C.getValue() → 旧的 prop_C.getValue() → C数据 ✅ 正确
```

**结果**：❌ UI 显示的还是 [A, B, C]，没有更新！

**原因**：
1. Prop 实例完全重建了（旧的 prop_A, prop_B, prop_C 被新的 new_prop_B, new_prop_A, new_prop_C 替换）
2. 但 ArraySetter 的 SettingField 还持有旧 Prop 的引用
3. `getDerivedStateFromProps` 按索引复用 SettingField，但**没有更新 SettingField 的值**
4. 导致 SettingField 读取的还是旧 Prop 的数据

---

## 🎯 根本原因总结

### ArraySetter 的设计缺陷

1. **按索引复用 SettingField**：
   ```typescript
   let item = state.items[i];  // ← 用索引 i 查找
   ```
   - 没有按数据的唯一标识（如 `value[i].key`）来匹配
   - 顺序变化时，索引对应的数据变了，但复用的 SettingField 没变

2. **复用时不更新数据**：
   ```typescript
   if (!item) {
     item = field.createField({...});
     item.setValue(value[i]);  // ← 只在创建时设置
   }
   // 复用时没有 item.setValue(value[i])
   items.push(item);
   ```

### 为什么之前能"歪打正着"？

**关键**：旧的 Prop 实例的内部数据被更新了

```
field_A → prop_A → prop_A.setValue(B数据) → field_A.getValue() 能得到 B
```

虽然 SettingField 没更新，但它持有的 Prop 引用的内部数据变了，所以间接地让 UI 正确。

### 为什么现在不工作？

**关键**：Prop 实例被完全替换了

```
field_A → 旧的 prop_A(数据=A)
props.value[0] → new_prop_B(数据=B)
// field_A 和 new_prop_B 没有任何关联！
```

SettingField 持有的还是旧 Prop 的引用，读取的自然是旧数据。

---

## 💡 解决方案

### 方案 1：在 `getDerivedStateFromProps` 中更新 SettingField（推荐）

```typescript
static getDerivedStateFromProps(props: ArraySetterProps, state: ArraySetterState) {
  const items: IPublicModelSettingField[] = [];
  const { value, field } = props;
  const valueLength = value && Array.isArray(value) ? value.length : 0;

  for (let i = 0; i < valueLength; i++) {
    let item = state.items[i];
    if (!item) {
      item = field.createField({
        name: i.toString(),
        setter: props.itemSetter,
        forceInline: 1,
        type: 'field',
        extraProps: {
          defaultValue: value[i],
          setValue: (target: IPublicModelSettingField) => {
            onItemChange(target, i, item, props);
          },
        },
      });
    }

    // ✅ 修复：无论是否复用，都要更新值
    item.setValue(value[i]);

    items.push(item);
  }

  return {
    items,
  };
}
```

**优点**：
- 简单直接，只需修改一处
- 确保 SettingField 始终持有最新的 Prop 引用
- 不依赖 Prop 内部数据是否更新

**缺点**：
- 每次 props 变化都会调用 `setValue`，可能有性能影响
- 但通常数组长度不会太大，影响不大

---

### 方案 2：按数据的唯一标识复用 SettingField（更好）

```typescript
static getDerivedStateFromProps(props: ArraySetterProps, state: ArraySetterState) {
  const items: IPublicModelSettingField[] = [];
  const { value, field } = props;
  const valueLength = value && Array.isArray(value) ? value.length : 0;

  // ✅ 建立旧 items 的映射（按数据的唯一标识）
  const oldItemsMap = new Map<string, IPublicModelSettingField>();
  state.items.forEach((item) => {
    const itemValue = item.getValue();
    const itemKey = itemValue?.key ?? itemValue?.id ?? item.name;
    if (itemKey) {
      oldItemsMap.set(itemKey, item);
    }
  });

  for (let i = 0; i < valueLength; i++) {
    const itemValue = value[i];
    const itemKey = itemValue?.key ?? itemValue?.id ?? i.toString();

    // ✅ 按数据的唯一标识查找旧 item
    let item = oldItemsMap.get(itemKey);

    if (!item) {
      item = field.createField({
        name: i.toString(),
        setter: props.itemSetter,
        forceInline: 1,
        type: 'field',
        extraProps: {
          defaultValue: value[i],
          setValue: (target: IPublicModelSettingField) => {
            onItemChange(target, i, item, props);
          },
        },
      });
    }

    // ✅ 更新值（包含位置信息）
    item.setKey(i);  // 更新索引
    item.setValue(value[i]);

    items.push(item);
    oldItemsMap.delete(itemKey);  // 标记为已使用
  }

  // ✅ 清理未使用的旧 items
  oldItemsMap.forEach((unusedItem) => {
    unusedItem.purge();
  });

  return {
    items,
  };
}
```

**优点**：
- 正确处理顺序变化：同一数据项对应同一个 SettingField
- 避免不必要的重新创建
- 更符合 React 的 key 机制

**缺点**：
- 需要数据项有稳定的唯一标识（如 `key` 字段）
- 实现稍复杂

---

### 方案 3：修改 Prop.items getter（配合方案 1）

这是你之前的问题，我们也可以一并修复：

```typescript
// packages/designer/src/document/node/props/prop.ts

private get items(): IProp[] | null {
  if (this._items) return this._items;

  return runInAction(() => {
    let items: IProp[] | null = null;
    if (this._type === 'list') {
      const maps = new Map<string, IProp>();
      const data = this._value;

      // ✅ 先建立旧 _maps 按数据 key 的反向映射
      const oldPropsMap = new Map<string, IProp>();
      if (this._maps) {
        this._maps.forEach((prop) => {
          const propValue = prop.getValue();
          const propKey = propValue?.key ?? propValue?.id;
          if (propKey) {
            oldPropsMap.set(propKey, prop);
          }
        });
      }

      data.forEach((item: any, idx: number) => {
        items = items || [];
        let prop;

        // ✅ 按数据的 key 查找旧 Prop
        const itemKey = item?.key ?? item?.id;
        const hasOldProp = itemKey && oldPropsMap.has(itemKey);

        if (hasOldProp) {
          prop = oldPropsMap.get(itemKey)!;
          prop.setValue(item);
          oldPropsMap.delete(itemKey);
        } else {
          prop = new Prop(this, item, idx);
        }
        maps.set(idx.toString(), prop);
        items.push(prop);
      });

      this._maps = maps;
    }
    // ... 其他逻辑
  });
}
```

---

## 📋 推荐修复步骤

### 最小修改（立即修复）

**只修改 ArraySetter.getDerivedStateFromProps**：

```typescript
for (let i = 0; i < valueLength; i++) {
  let item = state.items[i];
  if (!item) {
    item = field.createField({...});
  }
  item.setValue(value[i]);  // ← 添加这一行
  items.push(item);
}
```

**位置**：在你提供的代码中，第 96 行后面添加 `else { item.setValue(value[i]); }`

### 完整修复（长期方案）

1. **修改 ArraySetter**（方案 2）：按数据的唯一标识复用
2. **修改 Prop.items getter**（方案 3）：按数据的唯一标识复用 Prop

这样可以从根本上解决问题，让系统更健壮。

---

## 🔬 验证方法

### 添加调试日志

```typescript
static getDerivedStateFromProps(props: ArraySetterProps, state: ArraySetterState) {
  console.log('[ArraySetter] getDerivedStateFromProps', {
    propsValue: props.value.map(v => ({ key: v?.key, label: v?.label })),
    stateItems: state.items.map(item => ({
      id: item.id,
      name: item.name,
      value: item.getValue(),
    })),
  });

  // ... 原有逻辑
}
```

### 预期效果

修复后，拖拽顺序时应该看到：
```
[ArraySetter] getDerivedStateFromProps {
  propsValue: [
    { key: 'B', label: '标签B' },
    { key: 'A', label: '标签A' },
    { key: 'C', label: '标签C' }
  ],
  stateItems: [
    { id: 'field_1', name: '0', value: { key: 'B', label: '标签B' } },  ← 正确
    { id: 'field_2', name: '1', value: { key: 'A', label: '标签A' } },  ← 正确
    { id: 'field_3', name: '2', value: { key: 'C', label: '标签C' } }   ← 正确
  ]
}
```

---

## 📝 总结

### 问题链条

```
1. this._maps = null
   ↓
2. Prop.items getter 创建全新的 Prop 实例
   ↓
3. props.value 变成新的 Prop 数组
   ↓
4. ArraySetter.getDerivedStateFromProps 被触发
   ↓
5. 按索引复用 SettingField，但没有调用 setValue
   ↓
6. SettingField 持有旧 Prop 的引用
   ↓
7. UI 显示旧数据
```

### 解决路径

**短期**：ArraySetter 复用时调用 `setValue`
**长期**：改为按数据唯一标识复用（ArraySetter + Prop.items getter）

### 优先级

1. **立即修复**：ArraySetter.getDerivedStateFromProps 添加 `setValue`
2. **后续优化**：改为按唯一标识复用
3. **不要回退**：`this._maps = null` 必须保留

---

**ArraySetter 文件位置**：
- 很可能在 `packages/editor-skeleton/src/components/setters/array-setter/` 或类似路径
- 需要找到对应的 TypeScript/JSX 文件进行修改

需要我帮你实现这个修复吗？🛠️


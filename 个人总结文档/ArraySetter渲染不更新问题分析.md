# ArraySetter 渲染不更新问题分析

> **问题描述**: 在清空 `this._maps = null;` 后，修改数组项顺序时，实际页面正确显示，但 ArraySetter 的 UI 没有更新。
>
> **Date**: 2025-10-30

---

## 📋 问题现象

### 操作步骤
1. Tabs 组件有 3 个标签项：[A, B, C]
2. 在页面上拖拽调整顺序为：[B, A, C]
3. **实际页面**：✅ Tab 位置正确变动了
4. **ArraySetter UI**：❌ 配置面板中的顺序没有变化

### 关键代码
```typescript
// packages/designer/src/document/node/props/prop.ts

@action
private dispose() {
  const items = untracked(() => this._items);
  if (items) {
    items.forEach((prop) => prop.purge());
  }
  this._items = null;

  // ✅ 清空 _maps，防止复用已 purge 的 Prop
  this._maps = null;  // ← 这行代码引发了新问题

  if (this._type !== 'slot' && this._slotNode) {
    this._slotNode.remove();
    this._slotNode = undefined;
  }
}
```

---

## 🔍 根本原因分析

### 1. `items` getter 的缓存机制

让我们先理解 `items` getter 的工作原理：

```typescript
// packages/designer/src/document/node/props/prop.ts (line 162-242)

private get items(): IProp[] | null {
  if (this._items) return this._items;  // ← 有缓存直接返回

  return runInAction(() => {
    let items: IProp[] | null = null;
    if (this._type === 'list') {
      const maps = new Map<string, IProp>();
      const data = this._value;  // ← 当前数组数据

      // ⚠️ 关键：使用数组索引作为 key，而不是数据的唯一标识
      data.forEach((item: any, idx: number) => {
        items = items || [];
        let prop;
        const hasOldProp = this._maps?.has(idx.toString());  // ← 用索引查找

        if (hasOldProp) {
          // 复用旧 Prop，更新其数据
          prop = this._maps.get(idx.toString())!;
          prop.setValue(item);  // ← 更新数据但保持引用
        } else {
          // 创建新 Prop
          prop = new Prop(this, item, idx);
        }
        maps.set(idx.toString(), prop);  // ← 存储时也用索引
        items.push(prop);
      });

      this._maps = maps;  // ← 更新缓存
    }
    // ... 省略其他逻辑
    this._items = items;
    return this._items;
  });
}
```

**核心问题**：`_maps` 使用**数组索引**作为 key，而不是数据项的唯一标识！

---

## 📊 场景对比：修改前 vs 修改后

### 场景设置
```
初始数据：[A, B, C]
用户拖拽后：[B, A, C]
```

### 🔴 之前（没有 `this._maps = null;`）

#### Step 1: 初始状态
```typescript
数据: [A, B, C]
_maps: {
  '0': prop_A (持有 A 数据),
  '1': prop_B (持有 B 数据),
  '2': prop_C (持有 C 数据)
}
```

#### Step 2: 拖拽后数据变化
```typescript
schema 数据变成: [B, A, C]
触发 setValue([B, A, C])
```

#### Step 3: items getter 执行（_maps 未清空）
```typescript
遍历新数据:
  - idx=0, item=B
    hasOldProp = _maps.has('0') ✅ true
    prop = _maps.get('0') → 得到 prop_A
    prop_A.setValue(B数据)  // ← prop_A 现在持有 B 的数据

  - idx=1, item=A
    hasOldProp = _maps.has('1') ✅ true
    prop = _maps.get('1') → 得到 prop_B
    prop_B.setValue(A数据)  // ← prop_B 现在持有 A 的数据

  - idx=2, item=C
    hasOldProp = _maps.has('2') ✅ true
    prop = _maps.get('2') → 得到 prop_C
    prop_C.setValue(C数据)  // ← prop_C 还是 C 的数据

结果：
_maps: {
  '0': prop_A(内部数据=B),  // ← 引用不变，数据变了
  '1': prop_B(内部数据=A),  // ← 引用不变，数据变了
  '2': prop_C(内部数据=C)
}
```

#### Step 4: ArraySetter 的反应
```typescript
// ArraySetter 收到的 props
props.value = [
  prop_A,  // 引用没变，但内部数据从 A → B
  prop_B,  // 引用没变，但内部数据从 B → A
  prop_C   // 引用没变，数据也没变
]

// ArraySetter 可能的实现（伪代码）
{props.value.map((prop, index) => (
  <Item
    key={prop.key ?? index}  // ← 如果用 prop.key（数组索引）作为 React key
    data={prop.getValue()}   // ← 数据已更新
  />
))}

// React 的判断：
// - key=0 的组件还在，数据变了 → 重新渲染 ✅
// - key=1 的组件还在，数据变了 → 重新渲染 ✅
// - key=2 的组件还在，数据没变 → 不渲染 ✅
```

**结果**：✅ UI 能正确更新（虽然逻辑是错的，但"歪打正着"）

---

### 🟢 现在（有了 `this._maps = null;`）

#### Step 1: 初始状态
```typescript
数据: [A, B, C]
_maps: {
  '0': prop_A (持有 A 数据),
  '1': prop_B (持有 B 数据),
  '2': prop_C (持有 C 数据)
}
```

#### Step 2: 拖拽后数据变化
```typescript
schema 数据变成: [B, A, C]
触发 setValue([B, A, C])
  → dispose()
  → this._maps = null  // ← 关键：清空了缓存
```

#### Step 3: items getter 执行（_maps 已清空）
```typescript
遍历新数据:
  - idx=0, item=B
    hasOldProp = _maps?.has('0') ❌ false (因为 _maps = null)
    prop = new Prop(this, B数据, 0)  // ← 创建全新的 Prop

  - idx=1, item=A
    hasOldProp = _maps?.has('1') ❌ false
    prop = new Prop(this, A数据, 1)  // ← 创建全新的 Prop

  - idx=2, item=C
    hasOldProp = _maps?.has('2') ❌ false
    prop = new Prop(this, C数据, 2)  // ← 创建全新的 Prop

结果：
_maps: {
  '0': new_prop_B(内部数据=B),  // ← 全新的实例
  '1': new_prop_A(内部数据=A),  // ← 全新的实例
  '2': new_prop_C(内部数据=C)   // ← 全新的实例
}
```

#### Step 4: ArraySetter 的反应（问题出现）
```typescript
// ArraySetter 收到的 props（全新的 Prop 实例）
props.value = [
  new_prop_B,  // 全新的引用
  new_prop_A,  // 全新的引用
  new_prop_C   // 全新的引用
]

// 问题 1：如果 Prop 没有稳定的唯一标识
new Prop(this, item, idx)
// ↑ 构造函数中，idx 是数组索引（0, 1, 2）
// 如果 Prop.key = idx，那么：
//   new_prop_B.key = 0
//   new_prop_A.key = 1
//   new_prop_C.key = 2
// 这和之前的 key 一样！

// ArraySetter 可能的实现（伪代码）
{props.value.map((prop, index) => (
  <Item
    key={prop.key ?? index}  // ← key 还是 0, 1, 2
    data={prop.getValue()}
  />
))}

// React 的判断：
// - key=0: 之前是 A，现在是 B，但 React 认为是同一个组件
//   → 如果 Item 是 PureComponent，且只比较浅层 props
//   → prop 引用变了，应该重新渲染
//   → 但如果 ArraySetter 内部有自己的状态缓存...

// 问题 2：ArraySetter 可能有内部状态
class ArraySetter extends Component {
  state = {
    items: this.props.value.map(prop => ({
      id: prop.key,        // ← 用 prop.key 作为 id
      internalState: {}    // ← 内部状态
    }))
  }

  // 如果 componentDidUpdate 没有正确处理...
  componentDidUpdate(prevProps) {
    // ❌ 错误的实现：只检查数组长度
    if (prevProps.value.length !== this.props.value.length) {
      this.updateItems();
    }
    // ← 长度没变（都是 3），所以不更新！
  }
}
```

**结果**：❌ UI 没有更新

---

## 🎯 问题的核心矛盾

### 矛盾点 1：索引 vs 唯一标识

```typescript
// items getter 使用索引作为 key
maps.set(idx.toString(), prop);  // ← idx = 0, 1, 2

// 但数据项有自己的唯一标识
item = {
  label: '标签项1',
  key: 'bgbs',  // ← 这才是真正的唯一标识
  children: { ... }
}
```

**导致的问题**：
- 顺序变化时，索引没变（还是 0, 1, 2）
- 但索引对应的数据变了（0 从 A 变成 B）
- Prop 的 key 还是索引，无法反映真实的数据变化

### 矛盾点 2：引用稳定性 vs 数据正确性

| 场景 | 引用稳定性 | 数据正确性 | UI 更新 |
|------|-----------|-----------|---------|
| **之前**（不清空 _maps） | ✅ 稳定（复用旧 Prop） | ❌ 错位（prop_A 持有 B 数据） | ✅ 更新（MobX 响应式） |
| **现在**（清空 _maps） | ❌ 不稳定（创建新 Prop） | ✅ 正确（new_prop_B 持有 B 数据） | ❌ 不更新（ArraySetter 问题） |

---

## 🛠️ 可能的原因

### 原因 1：ArraySetter 的 React Key 设置不当

```typescript
// 可能的错误实现
items.map((prop, index) => (
  <Item key={index} prop={prop} />  // ← 用 index 作为 key
))

// 或
items.map((prop) => (
  <Item key={prop.key} prop={prop} />  // ← prop.key 是数组索引，不是数据的 key
))
```

**问题**：
- React 认为 `key=0` 的组件还是同一个
- 即使 `prop` 引用变了，React 也可能复用组件实例
- 如果组件内部有状态，状态不会重置

### 原因 2：ArraySetter 内部状态未同步

```typescript
class ArraySetter extends Component {
  state = {
    expandedItems: [0, 2],  // ← 内部维护的展开状态
    // ...其他状态
  }

  componentDidUpdate(prevProps) {
    // ❌ 只检查长度变化
    if (prevProps.value.length !== this.props.value.length) {
      this.syncState();
    }

    // ✅ 应该检查每个 item 的变化
    // if (prevProps.value !== this.props.value) {
    //   this.syncState();
    // }
  }
}
```

### 原因 3：MobX 响应式问题

```typescript
// 如果 ArraySetter 使用了 @observer
@observer
class ArraySetter extends Component {
  render() {
    // 如果这里只访问了 props.value.length
    const count = this.props.value.length;

    // 而没有访问每个 item 的具体内容
    // 那么 MobX 只会追踪 length 的变化
    // 顺序变化不会触发重新渲染
  }
}
```

### 原因 4：PureComponent 的浅比较

```typescript
class ArraySetter extends PureComponent {
  render() {
    // PureComponent 会进行浅比较
    // 如果 props.value 是同一个数组引用（只是内容变了）
    // 就不会重新渲染
  }
}
```

---

## 💡 解决方案

### 方案 1：修改 `items` getter，使用数据的唯一标识

```typescript
private get items(): IProp[] | null {
  if (this._items) return this._items;

  return runInAction(() => {
    let items: IProp[] | null = null;
    if (this._type === 'list') {
      const maps = new Map<string, IProp>();
      const data = this._value;

      data.forEach((item: any, idx: number) => {
        items = items || [];
        let prop;

        // ✅ 使用数据的唯一标识（如 item.key）而不是索引
        const itemKey = item?.key ?? idx.toString();
        const hasOldProp = this._maps?.has(itemKey);

        if (hasOldProp) {
          prop = this._maps.get(itemKey)!;
          prop.setValue(item);
        } else {
          prop = new Prop(this, item, idx);
          // 可能需要给 Prop 添加一个唯一标识字段
          // prop.uniqueId = itemKey;
        }
        maps.set(itemKey, prop);  // ← 用 itemKey 存储
        items.push(prop);
      });

      this._maps = maps;
    }
    // ...
  });
}
```

**优点**：
- 数据项的唯一标识不变，Prop 实例可以正确复用
- 顺序变化时，只是 Prop 在数组中的位置变了，引用不变

**缺点**：
- 需要数据项有稳定的唯一标识（如 `key` 字段）
- 如果数据项没有唯一标识，需要额外处理

---

### 方案 2：保持当前实现，修复 ArraySetter

需要找到 ArraySetter 的实现并修复：

```typescript
// ArraySetter 的正确实现

@observer
class ArraySetter extends Component {
  render() {
    const { value } = this.props;

    return (
      <div>
        {value.map((prop, index) => {
          // ✅ 使用数据的唯一标识作为 React key
          const itemData = prop.getValue();
          const uniqueKey = itemData?.key ?? itemData?.id ?? index;

          return (
            <Item
              key={uniqueKey}      // ← 使用数据的唯一标识
              prop={prop}
              index={index}
            />
          );
        })}
      </div>
    );
  }
}
```

或者强制使用数据的 key：

```typescript
@observer
class ArraySetter extends Component {
  render() {
    const { value } = this.props;

    return (
      <div>
        {value.map((prop, index) => {
          // 强制重新渲染：给每个 Prop 生成唯一的 key
          const itemData = prop.getValue();
          const uniqueKey = `${itemData?.key || index}-${Date.now()}`;

          return <Item key={uniqueKey} prop={prop} />;
        })}
      </div>
    );
  }
}
```

---

### 方案 3：在 `dispose()` 中选择性清空 `_maps`

```typescript
@action
private dispose() {
  const items = untracked(() => this._items);
  if (items) {
    items.forEach((prop) => prop.purge());
  }
  this._items = null;

  // ✅ 只在必要时清空 _maps
  // 如果是删除操作（items 被 purge 了），清空 _maps
  // 如果只是顺序变化，保留 _maps 但更新映射关系

  if (this._type === 'slot' || items?.some(item => item.purged)) {
    this._maps = null;  // ← 只在 Prop 被 purge 时清空
  }
  // 否则保留 _maps，让 items getter 复用 Prop

  if (this._type !== 'slot' && this._slotNode) {
    this._slotNode.remove();
    this._slotNode = undefined;
  }
}
```

**问题**：这个方案可能会重新引入之前的 bug（复用已 purge 的 Prop）

---

### 方案 4：修改 Prop 构造函数，添加唯一标识

```typescript
export class Prop implements IProp, IPropParent {
  readonly isProp = true;
  readonly id: string;  // ← 添加唯一标识

  constructor(
    public parent: IPropParent,
    value: IPublicTypeCompositeValue | UNSET = UNSET,
    key?: string | number,
    spread = false,
    options = {},
  ) {
    makeObservable(this);
    this.owner = parent.owner;
    this.props = parent.props;
    this.key = key;
    this.spread = spread;
    this.options = options;

    // ✅ 生成唯一标识
    // 如果数据有 key/id，使用数据的 key
    // 否则生成一个 uuid
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      this.id = value.key || value.id || uuid();
    } else {
      this.id = uuid();
    }

    if (value !== UNSET) {
      this.setValue(value);
    }
    this.setupItems();
  }
}
```

然后在 `items` getter 中使用 `prop.id`：

```typescript
data.forEach((item: any, idx: number) => {
  items = items || [];
  let prop;

  // 尝试找到持有相同数据的旧 Prop（通过数据的 key 查找）
  const itemKey = item?.key ?? item?.id;
  const oldProp = itemKey && this._findPropByDataKey(itemKey);

  if (oldProp && !oldProp.purged) {
    prop = oldProp;
    prop.setValue(item);
  } else {
    prop = new Prop(this, item, idx);
  }

  maps.set(prop.id, prop);  // ← 用 Prop 的 id 作为 key
  items.push(prop);
});
```

---

## 🔬 调试建议

### 1. 添加调试日志

```typescript
// 在 items getter 中
data.forEach((item: any, idx: number) => {
  // ...
  console.log('[items getter]', {
    idx,
    itemKey: item?.key,
    hasOldProp,
    oldPropId: hasOldProp ? prop.id : 'N/A',
    newPropCreated: !hasOldProp,
  });
});
```

### 2. 检查 ArraySetter 的实现

找到 ArraySetter 组件的源码：
```bash
# 搜索 ArraySetter 组件
grep -r "class ArraySetter" packages/
grep -r "ArraySetter extends" packages/
```

### 3. 检查 React key

在浏览器开发者工具中：
```javascript
// 在 Console 中执行
$$('[data-setter-component]').forEach(el => {
  console.log(el.getAttribute('data-key'), el);
});
```

### 4. 监听 Prop 变化

```typescript
// 在 Prop 类中添加
@action
setValue(val: IPublicTypeCompositeValue) {
  console.log('[Prop.setValue]', {
    propId: this.id,
    key: this.key,
    oldValue: this._value,
    newValue: val,
    stack: new Error().stack,  // ← 查看调用栈
  });

  // ... 原有逻辑
}
```

---

## 📝 总结

### 问题本质

`this._maps = null;` 暴露了一个设计缺陷：

1. **`items` getter 使用数组索引作为缓存 key**
   - 顺序变化时，索引不变，导致错位
   - 之前"歪打正着"让 UI 能更新（虽然逻辑错了）

2. **清空 `_maps` 后，每次都创建新 Prop**
   - 数据正确了，但引用完全变了
   - ArraySetter 的 UI 响应机制可能依赖引用稳定性

3. **ArraySetter 可能存在的问题**
   - React key 设置不当
   - 内部状态未同步
   - PureComponent 浅比较失效
   - MobX 响应式追踪不完整

### 推荐方案

**短期方案**（方案 2）：
- 找到 ArraySetter 的实现
- 修复其 React key 和状态同步逻辑
- 保持 `this._maps = null;` 不变（因为它修复了更严重的 bug）

**长期方案**（方案 1 + 方案 4）：
- 修改 `items` getter，使用数据的唯一标识而不是索引
- 给 Prop 添加稳定的 `id` 字段
- 确保 ArraySetter 使用数据的唯一标识作为 React key

### 下一步

1. **定位 ArraySetter 组件**
   ```bash
   find packages/ -name "*array*setter*" -type f
   ```

2. **检查其实现**
   - React key 如何设置？
   - 是否是 PureComponent？
   - 是否有内部状态？
   - 如何响应 props 变化？

3. **针对性修复**
   - 根据具体实现选择最合适的方案

---

**最后的建议**：

目前 `this._maps = null;` 修复了一个更严重的 bug（复用已 purge 的 Prop），**不应该回退这个修改**。

ArraySetter UI 不更新是一个次要问题，应该通过**修复 ArraySetter 组件**来解决，而不是回退核心逻辑的修复。

让我知道你找到 ArraySetter 的实现后，我可以帮你分析具体的修复方案！🔍


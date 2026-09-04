# Interview Algorithm Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every interview-focused catalog entry execute and visualize its real named algorithm against the canonical structure.

**Architecture:** Keep the current parse-once dispatcher and add explicit AST matchers for the exact missing algorithm families. Extend the queue protocol by one back-dequeue command so a monotonic deque can be represented faithfully; keep every ambiguous form fail closed.

**Tech Stack:** TypeScript 7, Acorn AST, Zod trace schemas, React/D3 scene rendering, Node test runner through `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-04-interview-algorithm-instrumentation-design.md`

## Global Constraints

- The canonical structure declaration is the first meaningful statement and is the real algorithm input.
- Instrumentation remains syntax-directed, narrow, fail closed, and side-effect preserving.
- Do not add generic control-flow analysis or unrelated abstractions.
- Preserve the approved interview algorithm names and complexities.
- Do not create new commits. All completed work amends `b6627a1` once, after full verification and a remote-SHA check.

---

### Task 1: Add semantic catalog regression coverage

**Files:**

- Modify: `tests/catalogVisualization.test.ts`

**Interfaces:**

- Consumes: `algorithmCatalog`, `instrumentJavaScript`, `runCode`, `parseJavaScript`.
- Produces: result-oracle and trace-source assertions used by all later tasks.

- [ ] **Step 1: Add a real catalog-source executor**

Add a test-only helper that captures actual `console.log` arguments without modifying source:

```ts
function executeCatalogSource(code: string): readonly unknown[][] {
  const output: unknown[][] = [];
  const console = { log: (...values: unknown[]) => output.push(values) };
  Function('console', `"use strict";\n${code}`)(console);
  return output;
}
```

- [ ] **Step 2: Add hand-derived result oracles**

Add literal expectations for the repaired entries:

```ts
const expectedLastConsoleValue = {
  'maximum-subarray': 6,
  'spiral-matrix-traversal': [1, 2, 3, 6, 9, 8, 7, 4, 5],
  'rotate-matrix': [
    [7, 4, 1],
    [8, 5, 2],
    [9, 6, 3],
  ],
  'matrix-transpose': [
    [1, 0, 1],
    [0, 0, 0],
    [1, 0, 1],
  ],
  'in-order-traversal': 3,
  'pre-order-traversal': true,
  'post-order-traversal': [[3], [9, 20], [15, 7]],
  'balanced-parentheses': true,
  'postfix-evaluation': [1, 1, 4, 2, 1, 1, 0, 0],
  'next-greater-element': 10,
  'breadth-first-search': true,
  'generate-binary-numbers': [3, 3, 5, 5, 6, 7],
  'reverse-queue': 4,
  'linked-list-cycle': true,
  'group-anagrams': [['eat', 'tea', 'ate'], ['tan', 'nat'], ['bat']],
  'frequency-counter': 4,
} as const;
```

For `linked-list-middle`, assert the returned linked-list value chain `[1, 1, 2, 3, 4, 4]` rather than object identity.

- [ ] **Step 3: Add trace ownership assertions**

Parse each affected catalog source, locate the named function (`spiralOrder`, `maxDepth`, `isValidBst`, `levelOrder`, `canFinish`, `maxSlidingWindow`, `mergeTwoLists`), and assert every non-initialization structural command has `source.line` inside that function's `loc.start.line..loc.end.line`. Also require Sliding Window Maximum to emit at least one `queue.dequeueBack` command.

- [ ] **Step 4: Run the red catalog test**

Run:

```powershell
npx tsx --test --test-force-exit tests/catalogVisualization.test.ts
```

Expected: FAIL because helper traversals own tree/graph/list traces, Spiral Matrix starts from zeros, and `queue.dequeueBack` does not exist.

- [ ] **Step 5: Checkpoint without committing**

Run `git diff --check`. Do not commit.

---

### Task 2: Add queue back-dequeue semantics and restore the monotonic deque

**Files:**

- Modify: `src/protocol/traceSchemas.ts`
- Modify: `src/protocol/traceTypes.ts`
- Modify: `src/protocol/semanticValidation.ts`
- Modify: `src/scene/sceneReducer.ts`
- Modify: `src/tracer/tracer.ts`
- Modify: `src/instrumentation/instrumentQueue.ts`
- Modify: `src/data/catalog/algorithms.json`
- Modify: `tests/sourceContract.test.ts`
- Modify: `tests/visualization.test.ts`

**Interfaces:**

- Produces: `queue.dequeueBack` command and `tracer.dequeueBack()` operation.
- Preserves: existing `queue.dequeue` front-removal behavior.

- [ ] **Step 1: Add failing protocol and reducer tests**

Use literal commands to prove:

```ts
{ type: 'queue.create', values: [0, 1, 2] }
{ type: 'queue.dequeueBack' }
```

reduces to values `[0, 1]` with the final item identity removed, and that a back-dequeue on an empty queue reports `QUEUE_UNDERFLOW` in both semantic validation and the reducer.

- [ ] **Step 2: Add a failing instrumentation test**

Instrument this source and assert exactly one `queue.dequeueBack` command occurs while the returned value remains `2`:

```js
const queue = [0, 1, 2];
function trimBack(values) {
  return values.pop();
}
console.log(trimBack(queue));
```

Add a malformed variant using `values.pop(1)` and assert `unsupported`.

- [ ] **Step 3: Verify the tests fail for the missing command**

Run:

```powershell
npx tsx --test tests/sourceContract.test.ts tests/visualization.test.ts
```

Expected: FAIL because `queue.dequeueBack` is not in the schema, tracer, reducer, or instrumenter.

- [ ] **Step 4: Implement the protocol command**

Add a strict schema with only the shared command base and `type: z.literal('queue.dequeueBack')`; add it to `traceCommandSchema`; export `QueueDequeueBackCommand`; accept it in queue semantic validation with the same underflow rule as front dequeue.

- [ ] **Step 5: Implement scene and tracer behavior**

In `sceneReducer`, remove `values.at(-1)` and `itemIds.at(-1)`, clear `peekedIndex`, and remove marker indices targeting the former last position. In `tracer.ts`, add:

```ts
dequeueBack: operation('dequeueBack', { queue: 'queue.dequeueBack' }),
```

- [ ] **Step 6: Extend the queue instrumenter narrowly**

Add `dequeue-back` to `QueueCall`, accept only direct zero-argument `.pop()` on the proven queue root, allocate a dedicated helper, call the original bound method exactly once, emit `trace.dequeueBack` only for a traceable returned value, and return the original result.

- [ ] **Step 7: Restore the O(n) catalog algorithm**

Use a non-empty index deque seeded with `0`, loop from index `1`, remove expired indices with `.shift()`, remove dominated indices with `.pop()`, append the current index, and read the front maximum. Drain remaining indices after computing the result so the existing final-scene expectation remains empty.

- [ ] **Step 8: Run focused green tests**

Run the Task 2 test command and the Sliding Window catalog test. Expected: PASS.

- [ ] **Step 9: Checkpoint without committing**

Run `git diff --check`. Do not commit.

---

### Task 3: Trace Spiral Matrix reads on the canonical matrix

**Files:**

- Modify: `src/instrumentation/instrumentMatrix.ts`
- Modify: `src/data/catalog/algorithms.json`
- Modify: `tests/sourceContract.test.ts`
- Modify: `tests/catalogVisualization.test.ts`

**Interfaces:**

- Produces: `matrix.mark` commands with `{ marker: 'probe', positions: [{ row, column }] }`.

- [ ] **Step 1: Add a failing matrix-read matcher test**

Use a canonical matrix and `result.push(values[row][column])` in a direct block statement. Assert the trace marks the visited positions in spiral order. Add a malformed optional-chain or aliased-row variant and assert `unsupported`.

- [ ] **Step 2: Verify red**

Run `npx tsx --test tests/sourceContract.test.ts`. Expected: the supported traversal is currently `unsupported`.

- [ ] **Step 3: Implement `MatrixMark`**

Add a `MatrixMark` operation carrying the enclosing expression statement, matched cell, and source line. Match only a direct single-argument `.push(matrix[row][column])` call on a non-canonical result array. Insert `trace.mark` before the statement and register the matrix read as safe only when it belongs to the matched operation.

- [ ] **Step 4: Restore the canonical catalog input**

Remove `matrixSource` and the zero output buffer. `spiralOrder(matrix)` reads the canonical `matrix` and returns the traversal result without mutating the matrix.

- [ ] **Step 5: Run focused green tests**

Run the source-contract matrix test and Spiral Matrix catalog test. Expected: PASS with initial and final matrix `[[1,2,3],[4,5,6],[7,8,9]]`.

- [ ] **Step 6: Checkpoint without committing**

Run `git diff --check`. Do not commit.

---

### Task 4: Trace the actual tree algorithms

**Files:**

- Modify: `src/instrumentation/instrumentTree.ts`
- Modify: `src/data/catalog/algorithms.json`
- Modify: `tests/sourceContract.test.ts`
- Modify: `tests/catalogVisualization.test.ts`

**Interfaces:**

- Preserves: current exact DFS traversal instrumentation.
- Produces: tree visits from `maxDepth`, `isValidBst`, and `levelOrder` themselves.

- [ ] **Step 1: Add three supported-pattern tests and three near-miss tests**

Use the exact catalog forms. Assert visit order and return result for each supported algorithm. For near misses, alter one structural requirement—an extra recursive call, a non-canonical initial argument, or an aliased dequeue—and assert `unsupported`.

- [ ] **Step 2: Verify red**

Run the three focused tests. Expected: all actual algorithms are `unsupported` without helper traversals.

- [ ] **Step 3: Generalize the internal visit representation**

Represent each proven visit as:

```ts
type TreeVisit = {
  readonly insertionPoint: AnyNode;
  readonly target: Identifier;
  readonly line: number;
};
```

Keep one `TreeCandidate` and one WeakMap-based rendering path; only the pattern-specific matcher changes.

- [ ] **Step 4: Add exact recursive matchers**

Add `matchMaximumDepthTraversal` and `matchBstValidationTraversal`. Each matcher proves the null guard, exact recursive self-calls on `.left` and `.right`, expected parameter flow, and exactly one external invocation whose first argument is `tree`. Insert the visit immediately after the null guard.

- [ ] **Step 5: Add the exact level-order matcher**

Prove a queue seeded with the function root, one `shift()` assigned to a local node per iteration, pushes of non-null `.left` and `.right`, and one external call with `tree`. Insert the visit after the dequeue declaration using the dequeued node identifier.

- [ ] **Step 6: Reject ambiguity**

Collect matches from the existing DFS matcher and the three new matchers. Instrument only when exactly one candidate exists; retain all current unsafe root-write/reference checks.

- [ ] **Step 7: Remove catalog duplicates**

Delete every `inputTree` and `visitTree`. Call `maxDepth(tree)`, `isValidBst(tree, -Infinity, Infinity)`, and `levelOrder(tree)` directly.

- [ ] **Step 8: Run focused green tests**

Run tree instrumentation tests and the three catalog tests. Expected: PASS, with trace source lines inside the named algorithm functions.

- [ ] **Step 9: Checkpoint without committing**

Run `git diff --check`. Do not commit.

---

### Task 5: Trace Kahn's Course Schedule traversal

**Files:**

- Modify: `src/instrumentation/instrumentGraph.ts`
- Modify: `src/data/catalog/algorithms.json`
- Modify: `tests/sourceContract.test.ts`
- Modify: `tests/catalogVisualization.test.ts`

**Interfaces:**

- Preserves: current canonical static graph creation and exact BFS matcher.
- Produces: `graph.visitNode` and `graph.visitEdge` from Kahn's loop.

- [ ] **Step 1: Add failing Kahn matcher tests**

Use static string course IDs and a canonical adjacency object. Assert node visits `0,1,2,3`, edge visits `0->1,0->2,1->3,2->3`, and result `true`. Change the outgoing-edge update order in a near miss and assert `unsupported`.

- [ ] **Step 2: Verify red**

Run the focused graph tests. Expected: Kahn source is `unsupported`.

- [ ] **Step 3: Implement an explicit `KahnTraversal` matcher**

Prove indegree initialization for every canonical graph key, indegree increments from each canonical adjacency edge, zero-indegree queue seeding, one dequeue assigned to the current course, one completion increment, and outgoing-edge decrement/enqueue logic. Reuse the static graph node/edge IDs already produced by `instrumentGraph`.

- [ ] **Step 4: Emit visits at actual execution points**

Insert `trace.visit` after the queue dequeue and `trace.visitEdge` at the start of the canonical outgoing-edge loop body. Preserve the original expression order and do not evaluate adjacency or queue expressions twice.

- [ ] **Step 5: Restore the direct catalog algorithm**

Delete `visitCourses` and the separate prerequisites-driven graph rebuild. `canFinish(graph)` computes indegrees and performs Kahn's algorithm directly on the canonical static graph.

- [ ] **Step 6: Run focused green tests**

Run graph instrumentation tests and the Course Schedule catalog test. Expected: PASS with source ownership inside `canFinish`.

- [ ] **Step 7: Checkpoint without committing**

Run `git diff --check`. Do not commit.

---

### Task 6: Trace a real two-list merge

**Files:**

- Modify: `src/instrumentation/instrumentLinkedList.ts`
- Modify: `src/protocol/semanticValidation.ts`
- Modify: `src/data/catalog/algorithms.json`
- Modify: `tests/sourceContract.test.ts`
- Modify: `tests/catalogVisualization.test.ts`
- Modify: `tests/visualization.test.ts`

**Interfaces:**

- Preserves: reversal and read-only list matchers.
- Produces: one initial scene containing both input components and merge-owned `linked-list.setNext`, `setHead`, and `setTail` commands.

- [ ] **Step 1: Add failing merge tests**

Use two static sorted inputs `[1,2,4]` and `[1,3,4]`. Assert initial scene nodes contain both disjoint chains, final display order is `[1,1,2,3,4,4]`, the returned head has that same value chain, and mutation-command source lines belong to `mergeTwoLists`. Add a near miss with a third list or computed `.next` access and assert `unsupported`.

- [ ] **Step 2: Verify red**

Run the focused linked-list tests. Expected: the real merge is `unsupported`.

- [ ] **Step 3: Allocate static identities across both lists**

Read exactly two top-level static list declarations: canonical `linkedList` followed by one auxiliary list. Continue node IDs across both declarations and build a single WeakMap. Create the scene with all nodes, the canonical first head/tail, and the second chain disconnected.

Permit exactly two disjoint acyclic singly linked chains in initial semantic validation while preserving the canonical first chain's head/tail checks. Reject additional components, cycles, shared tails, and disconnected final states. All other list kinds and final connectedness requirements remain unchanged. This corrects the plan's original assumption that initial disconnected components were already accepted.

- [ ] **Step 4: Match the exact merge control flow**

Prove the dummy node, `tail`, `left`, and `right` initializers; the dual-non-null loop; the value comparison; mutually exclusive `tail.next` assignment and pointer advance; `tail = tail.next`; final remainder assignment; and `return dummy.next`. Require exactly one external call with the two declared list roots.

- [ ] **Step 5: Emit merge mutations without duplicate side effects**

After each proven `tail.next` assignment, look up `tail` and its new `next` in the WeakMap and emit `trace.setNext` only when `tail` is a tracked input node. Wrap the one external call in a helper that receives the already-computed returned head, walks only the completed merged topology to identify its tail, emits `setHead`/`setTail` with the return-statement source line, and returns the same head.

- [ ] **Step 6: Restore the catalog inputs**

Remove the pre-merged canonical list and `visitList`. Restore canonical `[1,2,4]`, auxiliary `[1,3,4]`, and call `mergeTwoLists(linkedList, linkedList2)` directly.

- [ ] **Step 7: Run focused green tests**

Run linked-list instrumentation tests and Merge Two Sorted Lists catalog test. Expected: PASS with no helper-owned trace.

- [ ] **Step 8: Checkpoint without committing**

Run `git diff --check`. Do not commit.

---

### Task 7: Harden stack initialization and finalize renderer behavior

**Files:**

- Modify: `src/instrumentation/instrumentStack.ts`
- Modify: `src/data/catalog/algorithms.json`
- Modify: `src/visualization/renderArray.ts`
- Modify: `src/visualization/renderGraph.ts`
- Modify: `src/visualization/renderHashTable.ts`
- Modify: `src/visualization/renderLinkedList.ts`
- Modify: `src/visualization/renderQueue.ts`
- Modify: `src/visualization/renderStack.ts`
- Modify: `src/visualization/renderTree.ts`
- Modify: `tests/sourceContract.test.ts`
- Modify: `tests/visualizationDom.test.ts`

**Interfaces:**

- Produces: safe static non-empty stack initialization and label-free structure diagrams.

- [ ] **Step 1: Add focused stack boundary tests**

Assert `[]`, `[0]`, `[-1, 'sentinel']`, and the maximum allowed static length instrument successfully. Assert holes, spreads, identifiers, booleans, overlong strings, and `TRACE_LIMITS.collectionItems + 1` elements remain unsupported.

- [ ] **Step 2: Verify red for the boundary cases**

Run the focused stack tests. Expected: over-limit static input currently instruments and must fail.

- [ ] **Step 3: Bound the initializer**

Require `initializer.elements.length <= TRACE_LIMITS.collectionItems` and `staticTraceValue(element) !== null` for every element. Keep the existing empty-array behavior.

- [ ] **Step 4: Retain truthful stack catalog inputs**

Keep Valid Parentheses seeded with an unmatched opener completed by the input, Daily Temperatures seeded with index `0` and starting from index `1`, and Largest Rectangle seeded with index `0` and starting from index `1`. Drain visual working state only after the algorithm result is complete.

- [ ] **Step 5: Verify renderer label removal**

Retain the current production removal of `.visualization-empty-structure` nodes and `.visualization-stack-top`. Confirm the application-level no-scene empty state test still passes.

- [ ] **Step 6: Run focused green tests**

Run source-contract stack tests and the two focused DOM tests. Expected: PASS.

- [ ] **Step 7: Checkpoint without committing**

Run `git diff --check`. Do not commit.

---

### Task 8: Full verification, review, amend, and lease-protected push

**Files:**

- Verify all modified files.
- Amend existing commit only.

**Interfaces:**

- Produces: rewritten `main` commit replacing `b6627a1`; no additional commit.

- [ ] **Step 1: Run all quality gates**

Run independently and require exit code 0:

```powershell
npm run test
npm run typecheck
npm run lint
npm run format:check
npm run build
git diff --check
```

- [ ] **Step 2: Review the final diff**

Confirm every catalog algorithm uses its canonical structure, no display-only helper remains, no unrelated file changed, and the spec's requirements are covered.

- [ ] **Step 3: Request an independent code review**

Review the working-tree diff against `b6627a1`. Fix every Critical or Important finding and rerun the affected focused tests plus all quality gates.

- [ ] **Step 4: Verify remote history before amending**

Run:

```powershell
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
git ls-remote origin refs/heads/main
```

Require local HEAD, remote-tracking `origin/main`, and live remote `main` all to equal `b6627a1d0005a47a3aa48c1a7a7b74f3845044c6`. Stop if any differs.

- [ ] **Step 5: Amend the existing commit**

Stage only reviewed in-scope files and run:

```powershell
git commit --amend --no-edit
```

Verify the branch has exactly one rewritten tip rather than an added commit by comparing `git rev-list --count b6627a1..HEAD` and inspecting `git log -2 --oneline`.

- [ ] **Step 6: Validate the rewritten commit**

Run `git show --check --stat HEAD` and rerun the full quality gates against the committed tree.

- [ ] **Step 7: Force-push with an explicit lease**

Using the verified old remote SHA, run:

```powershell
git push --force-with-lease=main:b6627a1d0005a47a3aa48c1a7a7b74f3845044c6 origin main
```

- [ ] **Step 8: Verify final local and remote state**

Require `git status --short --branch` to be clean and `git ls-remote origin refs/heads/main` to equal the new local `HEAD`.

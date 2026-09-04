# Interview Algorithm Instrumentation Design

## Goal

Keep the interview-focused catalog while ensuring that every playback command is produced by the named algorithm operating on the canonical visualized structure.

## Constraints

- Preserve the existing source contract: the canonical structure declaration remains the first meaningful statement.
- Keep instrumentation syntax-directed, narrow, and fail closed. Unsupported or ambiguous shapes return the original source unchanged.
- Preserve evaluation order, return values, and single execution of every user expression.
- Do not add generic control-flow analysis, aliases, registries, contexts, or services.
- Remove diagram-internal `EMPTY` text and the stack `TOP` label while retaining the application-level empty state.
- Amend commit `b6627a1` only. Do not create a new commit.

## Catalog Source Design

Each catalog entry uses its canonical structure as the real algorithm input:

- Maximum Subarray mutates its canonical array with in-place Kadane state.
- Spiral Matrix reads and marks cells in the canonical input matrix; it does not copy into a synthetic output matrix.
- Rotate Image mutates the canonical matrix through explicit indexed swaps.
- Maximum Depth and Validate BST recurse directly over `tree`.
- Binary Tree Level Order Traversal consumes `tree` directly with its breadth-first queue.
- Valid Parentheses, Daily Temperatures, and Largest Rectangle start with meaningful static stack state and still produce their standard results.
- Course Schedule runs Kahn's algorithm directly over the static canonical graph.
- Sliding Window Maximum uses a real decreasing deque of indices with front and back removal.
- Rotting Oranges stores flattened grid positions in the canonical queue so queue trace values remain finite numbers.
- Linked List Cycle restores its final topology after detection.
- Merge Two Sorted Lists merges the two statically declared input lists and returns the merged canonical head.
- Group Anagrams stores numeric group indices in the canonical map so traced values remain primitive.
- Longest Consecutive Sequence uses the canonical map as a membership table; its copy describes a map rather than a set.

## Instrumentation Design

### Matrix

Extend `instrumentMatrix` with a read-mark operation that matches a direct matrix cell passed to `result.push(...)` as a standalone statement. Insert `trace.mark` immediately before that statement with the matched row and column. Existing set, swap, and comparison matchers remain unchanged, and any unsafe root usage still rejects the source.

### Tree

Keep static tree creation and WeakMap identity allocation. Add three explicit traversal variants:

1. Recursive maximum-depth shape: null guard followed by a return that recursively evaluates both children.
2. Recursive BST-validation shape: null guard, bounds guard, then recursive validation of both children.
3. Level-order shape: a local queue seeded with the root and a loop whose direct `shift()` result is the visited node.

Each variant must prove one external call whose first argument is the canonical tree. Recursive variants insert `trace.visit` after the null guard; level order inserts it after the node dequeue. Existing exact DFS traversal support remains intact. Multiple or ambiguous matches fail closed.

### Graph

Retain the current exact BFS matcher and add an exact Kahn matcher for a static adjacency object. The matcher proves indegree construction from canonical adjacency, queue seeding from zero-indegree nodes, one dequeue per completed node, and one canonical adjacency loop per outgoing-edge update. It inserts node and edge visits at those execution points. Dynamic graph construction and aliasing remain unsupported.

### Linked List

Retain reversal and read-only traversal support. Add an exact two-list merge matcher that:

- discovers the canonical `linkedList` and exactly one additional static list input;
- assigns collision-free WeakMap IDs across both lists;
- creates both initial components in one linked-list scene;
- traces only proven `tail.next = left|right` assignments where `tail` is a tracked input node;
- finalizes head and tail from the returned merged head without re-running user code.

Any untracked node, unsupported assignment, extra call, or ambiguous second list rejects instrumentation.

Initial singly linked topology validation must allow exactly two disjoint acyclic chains for these inputs, with the canonical head and tail describing the first chain. Cycles, shared tails, and additional components remain invalid. Final topology validation still requires every node to belong to one connected list. Other linked-list kinds retain their existing validation rules.

### Queue and Protocol

Add one queue command for removing the back item. The command carries only source metadata, mirroring `queue.dequeue`; semantic validation requires a non-empty queue; the scene reducer removes the final value and identity; the tracer exposes one operation method; and `instrumentQueue` wraps only direct zero-argument `.pop()` calls on the proven canonical queue binding.

This operation allows Sliding Window Maximum to retain its standard O(n) monotonic-deque algorithm. Existing `.shift()`, cursor-dequeue, peek, and enqueue behavior remains unchanged.

### Stack

Allow a canonical stack initializer containing only static finite numbers or bounded strings. Empty arrays remain valid. Holes, spreads, dynamic expressions, unsupported literals, and values beyond protocol limits remain rejected.

## Test Design

- Extend focused instrumentation tests for every new matcher with a supported real algorithm and a nearby malformed variant that must remain unsupported.
- Add protocol, semantic-validation, reducer, and playback coverage for queue back-dequeue, including empty-queue rejection and stable identity removal.
- Execute catalog source independently with literal result oracles for the changed interview algorithms.
- In the catalog pipeline test, parse each affected source and prove non-create trace command line metadata lies inside the named algorithm function, preventing detached helper traces.
- Keep the existing all-catalog pipeline/render test and the DOM assertions for removed in-diagram labels.
- Run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, and `git diff --check`.

## Git History

After verification, fetch the remote, confirm `origin/main` still points to `b6627a1`, amend that commit with the complete repair, and push with `--force-with-lease=main:b6627a1d0005a47a3aa48c1a7a7b74f3845044c6`. Stop without pushing if the remote moved.

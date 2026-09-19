import type { AnyNode, CallExpression, ExpressionStatement } from 'acorn';
import { isNamed as named, isNamedMember as member } from '../matchers';
import {
  createIdentifierAllocator,
  hasUnsafeInstrumentationSyntax,
  parseJavaScript,
} from '../ast';
import {
  applySourceEdits,
  sourceSpan as location,
  type SourceEdit,
  frameCall as frame,
} from '../edits';
import { readStaticTree } from './staticTree';

function call(
  node: AnyNode | null | undefined,
  callee: string,
  argument: string,
): node is CallExpression {
  return (
    node?.type === 'CallExpression' &&
    !node.optional &&
    named(node.callee, callee) &&
    node.arguments.length === 1 &&
    named(node.arguments[0], argument)
  );
}

function childCall(
  node: AnyNode | undefined,
  callee: string,
  receiver: string,
  side: 'left' | 'right',
): node is ExpressionStatement {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'CallExpression' &&
    !node.expression.optional &&
    named(node.expression.callee, callee) &&
    node.expression.arguments.length === 1 &&
    member(node.expression.arguments[0], receiver, side)
  );
}

export function instrumentInorderFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (
    program === null ||
    hasUnsafeInstrumentationSyntax(program) ||
    program.body.length !== 3
  )
    return null;
  const [tree, outer, answer] = program.body;
  if (
    tree?.type !== 'VariableDeclaration' ||
    tree.kind !== 'const' ||
    tree.declarations.length !== 1 ||
    tree.declarations[0]?.id.type !== 'Identifier' ||
    tree.declarations[0].init?.type !== 'ObjectExpression' ||
    outer?.type !== 'FunctionDeclaration' ||
    outer.id === null ||
    outer.async ||
    outer.generator ||
    outer.params.length !== 1 ||
    outer.params[0]?.type !== 'Identifier' ||
    answer?.type !== 'VariableDeclaration' ||
    answer.kind !== 'const' ||
    answer.declarations.length !== 1 ||
    answer.declarations[0]?.id.type !== 'Identifier'
  )
    return null;

  const root = tree.declarations[0].id.name;
  const parameter = outer.params[0].name;
  const result = answer.declarations[0];
  if (!call(result.init, outer.id.name, root)) return null;
  const nodes = readStaticTree(tree.declarations[0].init, root, { nextId: 0 });
  if (nodes === null) return null;

  const [outputDeclaration, inner, initialCall, outerReturn] = outer.body.body;
  if (
    outer.body.body.length !== 4 ||
    outputDeclaration?.type !== 'VariableDeclaration' ||
    outputDeclaration.kind !== 'const' ||
    outputDeclaration.declarations.length !== 1 ||
    outputDeclaration.declarations[0]?.id.type !== 'Identifier' ||
    outputDeclaration.declarations[0].init?.type !== 'ArrayExpression' ||
    outputDeclaration.declarations[0].init.elements.length !== 0 ||
    inner?.type !== 'FunctionDeclaration' ||
    inner.id === null ||
    inner.async ||
    inner.generator ||
    inner.params.length !== 1 ||
    inner.params[0]?.type !== 'Identifier' ||
    initialCall?.type !== 'ExpressionStatement' ||
    !call(initialCall.expression, inner.id.name, parameter) ||
    outerReturn?.type !== 'ReturnStatement' ||
    !named(outerReturn.argument, outputDeclaration.declarations[0].id.name)
  )
    return null;

  const output = outputDeclaration.declarations[0].id.name;
  const node = inner.params[0].name;
  const [guard, left, append, right] = inner.body.body;
  if (
    inner.body.body.length !== 4 ||
    guard?.type !== 'IfStatement' ||
    guard.alternate !== null ||
    guard.test.type !== 'BinaryExpression' ||
    guard.test.operator !== '===' ||
    !named(guard.test.left, node) ||
    guard.test.right.type !== 'Literal' ||
    guard.test.right.value !== null ||
    guard.consequent.type !== 'ReturnStatement' ||
    guard.consequent.argument !== null ||
    !childCall(left, inner.id.name, node, 'left') ||
    append?.type !== 'ExpressionStatement' ||
    append.expression.type !== 'CallExpression' ||
    append.expression.optional ||
    !member(append.expression.callee, output, 'push') ||
    append.expression.arguments.length !== 1 ||
    !member(append.expression.arguments[0], node, 'value') ||
    !childCall(right, inner.id.name, node, 'right')
  )
    return null;

  // Exact supported grammar and distinct bindings prevent partial traces under shadowing or edits.
  if (
    result.id.type !== 'Identifier' ||
    new Set([
      root,
      outer.id.name,
      parameter,
      output,
      inner.id.name,
      node,
      result.id.name,
    ]).size !== 7
  )
    return null;

  const allocate = createIdentifierAllocator(program, '__traceTree');
  const ids = allocate();
  const path = allocate();
  const rootCallId = allocate();
  const childCallIds = [allocate(), allocate()];
  const traceNodes = nodes
    .map(
      ({ id, value, children }) =>
        `{ id: ${JSON.stringify(id)}, value: ${JSON.stringify(value)}, children: ${JSON.stringify(children)} }`,
    )
    .join(', ');
  const mapEntries = nodes
    .map(({ access, id }) => `[${access}, ${JSON.stringify(id)}]`)
    .join(', ');

  const pathCommand = `{ type: 'tree.mark', marker: 'path', nodeIds: [...${path}] }`;
  const edits: SourceEdit[] = [
    {
      start: tree.end,
      end: tree.end,
      text:
        `\ntrace.initialize({ type: 'scene.init', structure: 'tree' }, { type: 'tree.create', rootId: ${JSON.stringify(nodes[0]?.id)}, nodes: [${traceNodes}] });\n` +
        `const ${ids} = new WeakMap([${mapEntries}]);\nconst ${path} = [];\n`,
    },
    {
      start: outputDeclaration.end,
      end: outputDeclaration.end,
      text: `\n${frame(outputDeclaration, `{ type: 'assign', target: ${JSON.stringify(output)}, before: null, value: [] }`)}\n`,
    },
    {
      start: initialCall.start,
      end: initialCall.start,
      text:
        `\nif (${parameter} !== null) ${path}.push(${ids}.get(${parameter}));\n` +
        `const ${rootCallId} = ` +
        frame(
          initialCall,
          `{ type: 'call', callee: ${JSON.stringify(inner.id!.name)}, from: null, target: ${parameter} === null ? 'null' : ${ids}.get(${parameter}) }`,
          [pathCommand],
        ) +
        '\n',
    },
    {
      start: initialCall.end,
      end: initialCall.end,
      text: `\nif (${parameter} !== null) ${path}.pop();\ntrace.completeImplicitReturn(${rootCallId}, undefined, ${location(initialCall.expression)}, ${parameter} === null ? 'null' : ${ids}.get(${parameter}), null);\n`,
    },
    ...([left, right] as const).map((step, index): SourceEdit => {
      const side = index === 0 ? 'left' : 'right';
      const target = `${node}.${side}`;
      const callId = childCallIds[index]!;
      return {
        start: step.start,
        end: step.start,
        text:
          `\nif (${target} !== null) ${path}.push(${ids}.get(${target}));\n` +
          `const ${callId} = ` +
          frame(
            step,
            `{ type: 'call', callee: ${JSON.stringify(inner.id!.name)}, from: ${ids}.get(${node}), target: ${target} === null ? 'null' : ${ids}.get(${target}) }`,
            [pathCommand],
          ) +
          '\n',
      };
    }),
    ...([left, right] as const).map((step, index): SourceEdit => {
      const side = index === 0 ? 'left' : 'right';
      const target = `${node}.${side}`;
      return {
        start: step.end,
        end: step.end,
        text: `\nif (${target} !== null) ${path}.pop();\ntrace.completeImplicitReturn(${childCallIds[index]!}, undefined, ${location(step.expression)}, ${target} === null ? 'null' : ${ids}.get(${target}), ${ids}.get(${node}));\n`,
      };
    }),
    {
      start: append.end,
      end: append.end,
      text: `\n${frame(append, `{ type: 'collection', action: 'append', role: 'traversal', item: ${node}.value }`, [`{ type: 'tree.visit', nodeId: ${ids}.get(${node}) }`])}\n`,
    },
    {
      start: guard.start,
      end: guard.end,
      text: `if (${node} === null) { ${frame(guard.consequent, `{ type: 'return', value: { kind: 'undefined' }, from: 'null', to: ${path}.at(-1) ?? null }`, [pathCommand])} return; }`,
    },
    {
      start: outerReturn.argument!.start,
      end: outerReturn.argument!.end,
      text: `trace.returnValue(${output}, ${location(outerReturn)}, 'traversal order')`,
    },
  ];
  return applySourceEdits(source, edits);
}

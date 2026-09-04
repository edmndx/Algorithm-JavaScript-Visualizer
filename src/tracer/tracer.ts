import { TRACE_LIMITS, traceCommandSchema } from '../protocol/traceSchemas';
import type { TraceCommand, TraceStructure } from '../protocol/traceTypes';

type CommandOf<Type extends TraceCommand['type']> = Extract<
  TraceCommand,
  { readonly type: Type }
>;

type CommandPayload<Type extends TraceCommand['type']> =
  Type extends TraceCommand['type'] ? Omit<CommandOf<Type>, 'type'> : never;

type OperationMap = {
  readonly [Structure in TraceStructure]?:
    Extract<TraceCommand['type'], `${Structure}.${string}`> | 'message';
};

export class TracerError extends Error {
  constructor(
    readonly code: 'INVALID_ARGUMENT' | 'INVALID_STATE' | 'COMMAND_LIMIT',
    message: string,
  ) {
    super(message);
    this.name = 'TracerError';
  }
}

export function createTracer() {
  const commands: TraceCommand[] = [];
  let structure: TraceStructure | null = null;

  function parseCommand<Type extends TraceCommand['type']>(
    type: Type,
    payload: CommandPayload<Type>,
  ): CommandOf<Type> {
    const result = traceCommandSchema.safeParse({ ...payload, type });

    if (!result.success) {
      const issues = result.error.issues
        .map(
          (issue) =>
            `${issue.path.length === 0 ? 'command' : issue.path.join('.')}: ${issue.message}`,
        )
        .join('; ');

      throw new TracerError(
        'INVALID_ARGUMENT',
        `Invalid "${type}" operation: ${issues}`,
      );
    }

    return result.data as CommandOf<Type>;
  }

  function append(command: TraceCommand): void {
    if (commands.length >= TRACE_LIMITS.commands) {
      throw new TracerError(
        'COMMAND_LIMIT',
        `Cannot emit "${command.type}": the trace already contains the maximum of ${TRACE_LIMITS.commands} commands.`,
      );
    }

    commands.push(command);
  }

  function operation<
    const Type extends Exclude<TraceCommand['type'], 'scene.init'>,
  >(
    name: string,
    types: Readonly<Partial<Record<TraceStructure, Type>>> & OperationMap,
  ): (payload: CommandPayload<Type>) => void {
    return (payload) => {
      if (structure === null) {
        throw new TracerError(
          'INVALID_STATE',
          `Cannot perform "${name}": expected an initialized structure, but the tracer is uninitialized.`,
        );
      }

      const type = types[structure];

      if (type === undefined) {
        throw new TracerError(
          'INVALID_STATE',
          `Cannot perform "${name}": expected ${Object.keys(types).join(' or ')}, but the actual structure is "${structure}".`,
        );
      }

      const createType = `${structure}.create`;

      if (commands.length === 1 && type !== createType) {
        throw new TracerError(
          'INVALID_STATE',
          `Cannot emit "${type}": expected "${createType}" as the second command.`,
        );
      }

      if (commands.length > 1 && type === createType) {
        throw new TracerError(
          'INVALID_STATE',
          `Cannot emit "${type}": the "${structure}" structure has already been created.`,
        );
      }

      append(parseCommand(type, payload));
    };
  }

  return {
    initialize(payload: CommandPayload<'scene.init'>): void {
      if (structure !== null) {
        throw new TracerError(
          'INVALID_STATE',
          `Cannot perform "initialize": expected an uninitialized tracer, but the actual structure is "${structure}".`,
        );
      }

      const command = parseCommand('scene.init', payload);

      append(command);
      structure = command.structure;
    },

    createArray: operation('createArray', { array: 'array.create' }),
    createMatrix: operation('createMatrix', { matrix: 'matrix.create' }),
    createTree: operation('createTree', { tree: 'tree.create' }),
    createGraph: operation('createGraph', { graph: 'graph.create' }),
    createStack: operation('createStack', { stack: 'stack.create' }),
    createQueue: operation('createQueue', { queue: 'queue.create' }),
    createLinkedList: operation('createLinkedList', {
      'linked-list': 'linked-list.create',
    }),
    createHashTable: operation('createHashTable', {
      'hash-table': 'hash-table.create',
    }),

    compare: operation('compare', {
      array: 'array.compare',
      matrix: 'matrix.compare',
      tree: 'tree.compare',
    }),
    swap: operation('swap', {
      array: 'array.swap',
      matrix: 'matrix.swap',
    }),
    set: operation('set', {
      array: 'array.set',
      matrix: 'matrix.set',
      'hash-table': 'hash-table.set',
    }),
    mark: operation('mark', {
      array: 'array.mark',
      matrix: 'matrix.mark',
      tree: 'tree.mark',
      stack: 'stack.mark',
      queue: 'queue.mark',
      'linked-list': 'linked-list.mark',
      'hash-table': 'hash-table.mark',
    }),

    setRoot: operation('setRoot', { tree: 'tree.setRoot' }),
    addNode: operation('addNode', {
      tree: 'tree.addNode',
      graph: 'graph.addNode',
      'linked-list': 'linked-list.addNode',
    }),
    removeNode: operation('removeNode', {
      tree: 'tree.removeNode',
      graph: 'graph.removeNode',
      'linked-list': 'linked-list.removeNode',
    }),
    setChildren: operation('setChildren', { tree: 'tree.setChildren' }),
    setValue: operation('setValue', {
      tree: 'tree.setValue',
      graph: 'graph.setNodeValue',
      'linked-list': 'linked-list.setValue',
    }),
    swapValues: operation('swapValues', { tree: 'tree.swapValues' }),
    visit: operation('visit', {
      tree: 'tree.visit',
      graph: 'graph.visitNode',
      'linked-list': 'linked-list.visit',
    }),

    addEdge: operation('addEdge', { graph: 'graph.addEdge' }),
    removeEdge: operation('removeEdge', { graph: 'graph.removeEdge' }),
    setEdgeWeight: operation('setEdgeWeight', {
      graph: 'graph.setEdgeWeight',
    }),
    visitEdge: operation('visitEdge', { graph: 'graph.visitEdge' }),
    markNodes: operation('markNodes', { graph: 'graph.markNodes' }),
    markEdges: operation('markEdges', { graph: 'graph.markEdges' }),
    distance: operation('distance', { graph: 'graph.distance' }),

    push: operation('push', { stack: 'stack.push' }),
    pop: operation('pop', { stack: 'stack.pop' }),
    peek: operation('peek', {
      stack: 'stack.peek',
      queue: 'queue.peek',
    }),
    enqueue: operation('enqueue', { queue: 'queue.enqueue' }),
    dequeue: operation('dequeue', { queue: 'queue.dequeue' }),
    dequeueBack: operation('dequeueBack', { queue: 'queue.dequeueBack' }),

    setHead: operation('setHead', { 'linked-list': 'linked-list.setHead' }),
    setTail: operation('setTail', { 'linked-list': 'linked-list.setTail' }),
    setNext: operation('setNext', { 'linked-list': 'linked-list.setNext' }),
    setPrevious: operation('setPrevious', {
      'linked-list': 'linked-list.setPrevious',
    }),

    delete: operation('delete', { 'hash-table': 'hash-table.delete' }),
    move: operation('move', { 'hash-table': 'hash-table.move' }),
    visitBucket: operation('visitBucket', {
      'hash-table': 'hash-table.visitBucket',
    }),
    visitEntry: operation('visitEntry', {
      'hash-table': 'hash-table.visitEntry',
    }),

    message: operation('message', {
      array: 'message',
      matrix: 'message',
      tree: 'message',
      graph: 'message',
      stack: 'message',
      queue: 'message',
      'linked-list': 'message',
      'hash-table': 'message',
    }),

    /** Full trace semantics remain a downstream validation responsibility. */
    getCommands(): readonly TraceCommand[] {
      if (commands.length < 2) {
        throw new TracerError(
          'INVALID_STATE',
          `Cannot perform "getCommands": expected scene.init and a matching structure creation command, but the tracer is ${structure === null ? 'uninitialized' : `waiting for "${structure}.create"`}.`,
        );
      }

      return structuredClone(commands);
    },
  };
}

// @vitest-environment jsdom
import fc from 'fast-check';
import type { Bus } from '../src/lib/domain/bus/bus.contract.js';
import { createBus } from '../src/lib/bus/create-bus.js';
import { stubReportError } from './helpers.js';

/**
 * Properties of the bus against small reference models. Each property has its own fixed seed, so a
 * failure reproduces and fast-check prints the shrunk counterexample; copy that into
 * create-bus.spec.ts as an example test.
 *
 * Deeper local search: COMM_PROPERTY_SEED=<n> COMM_PROPERTY_RUNS=<n> pnpm vitest run test/model.spec.ts
 */
const SEED = Number(process.env['COMM_PROPERTY_SEED'] ?? 20261111);
const RUNS = Number(process.env['COMM_PROPERTY_RUNS'] ?? 1000);
const settings = (offset: number) => ({ seed: SEED + offset, numRuns: RUNS });

const CHANNELS = ['a', 'b', 'c'] as const;
type ChannelId = (typeof CHANNELS)[number];
const channel = fc.constantFrom(...CHANNELS);

type Command =
  | { kind: 'emit'; channel: ChannelId; value: number; retain: boolean }
  | { kind: 'on'; channel: ChannelId; throws: boolean; signal: boolean }
  | { kind: 'off'; pick: number }
  | { kind: 'abort'; pick: number }
  | { kind: 'peek'; channel: ChannelId };

// Two channels and picks biased to recent subscriptions make stale-off sequences likely.
const few = fc.constantFrom<ChannelId>('a', 'b');
const command: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    kind: fc.constant('emit' as const),
    channel: few,
    value: fc.integer({ min: 0, max: 99 }),
    retain: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant('on' as const),
    channel: few,
    throws: fc.boolean(),
    signal: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('off' as const), pick: fc.nat({ max: 3 }) }),
  fc.record({ kind: fc.constant('abort' as const), pick: fc.nat({ max: 3 }) }),
  fc.record({ kind: fc.constant('peek' as const), channel: few })
);

type Subscription = {
  channel: ChannelId;
  active: boolean;
  received: unknown[];
  expected: unknown[];
  off: () => void;
  controller?: AbortController;
};

type Model = {
  retained: Map<ChannelId, unknown>;
  subs: Subscription[];
  throwing: Set<Subscription>;
};

function runCommand(bus: Bus, model: Model, cmd: Command): void {
  switch (cmd.kind) {
    case 'emit': {
      bus.emit(cmd.channel, cmd.value, { retain: cmd.retain });
      if (cmd.retain) model.retained.set(cmd.channel, cmd.value);
      else model.retained.delete(cmd.channel);
      model.subs
        .filter(sub => sub.active && sub.channel === cmd.channel)
        .forEach(sub => sub.expected.push(cmd.value));
      return;
    }
    case 'on': {
      const controller = cmd.signal ? new AbortController() : undefined;
      const sub: Subscription = {
        channel: cmd.channel,
        active: true,
        received: [],
        expected: [],
        off: () => {},
      };
      if (controller) sub.controller = controller;
      if (model.retained.has(cmd.channel)) sub.expected.push(model.retained.get(cmd.channel));
      sub.off = bus.on(
        cmd.channel,
        value => {
          sub.received.push(value);
          if (cmd.throws) throw new Error('listener');
        },
        { signal: controller?.signal }
      );
      if (cmd.throws) model.throwing.add(sub);
      model.subs.push(sub);
      return;
    }
    case 'off':
    case 'abort': {
      const sub = model.subs[model.subs.length - 1 - (cmd.pick % Math.max(1, model.subs.length))];
      if (!sub) return;
      if (cmd.kind === 'abort' && sub.controller) sub.controller.abort();
      else sub.off();
      sub.active = false;
      return;
    }
    case 'peek':
      expect(bus.peek(cmd.channel)).toBe(model.retained.get(cmd.channel));
  }
}

describe('bus properties', () => {
  it('matches the reference model for any sequence of emit, on, off, abort and peek', () => {
    fc.assert(
      fc.property(fc.array(command, { maxLength: 60 }), commands => {
        const reported = stubReportError();
        const bus = createBus();
        const model: Model = { retained: new Map(), subs: [], throwing: new Set() };

        commands.forEach(cmd => runCommand(bus, model, cmd));

        model.subs.forEach(sub => expect(sub.received).toEqual(sub.expected));
        // every delivery to a throwing listener is one report
        const reports = [...model.throwing].reduce((sum, sub) => sum + sub.expected.length, 0);
        expect(reported).toHaveBeenCalledTimes(reports);
        vi.unstubAllGlobals();
      }),
      settings(1)
    );
  });

  // A rule makes a listener on `on` re-emit on `to` while the value's depth is below the limit.
  // Channels may already hold a retained value when the listeners subscribe, so the replay inside
  // `on` cascades too.
  type Rule = { on: ChannelId; to: ChannelId | null };
  type Delivery = { listener: number; channel: ChannelId; value: string };
  type Event = { targets: number[]; channel: ChannelId; value: string };
  const MAX_DEPTH = 4;
  const depthOf = (value: string): number => value.split('.').length;

  // Reference: one FIFO; a delivery's targets are fixed when the value is emitted.
  function fifoModel(rules: Rule[], retained: ChannelId[], triggers: ChannelId[]): Delivery[] {
    const log: Delivery[] = [];
    const subscribed: number[] = [];
    const last = new Map<ChannelId, string>(retained.map((ch, i) => [ch, `r${i}`]));
    const listening = (ch: ChannelId) => subscribed.filter(l => rules[l]!.on === ch);
    const drain = (queue: Event[]): void => {
      while (queue.length > 0) {
        const { targets, channel: ch, value } = queue.shift()!;
        targets.forEach(listener => {
          log.push({ listener, channel: ch, value });
          const to = rules[listener]!.to;
          if (!to || depthOf(value) >= MAX_DEPTH) return;
          const next = `${value}.${listener}`;
          last.set(to, next);
          queue.push({ targets: listening(to), channel: to, value: next });
        });
      }
    };
    rules.forEach((rule, listener) => {
      subscribed.push(listener);
      const value = last.get(rule.on);
      if (value !== undefined) drain([{ targets: [listener], channel: rule.on, value }]);
    });
    triggers.forEach((ch, i) => {
      last.set(ch, `${i}`);
      drain([{ targets: listening(ch), channel: ch, value: `${i}` }]);
    });
    return log;
  }

  it('delivers re-entrant emits, live and from replay, in FIFO order, once per listener', () => {
    const rule = fc.record({ on: channel, to: fc.option(channel, { nil: null }) });
    fc.assert(
      fc.property(
        fc.array(rule, { minLength: 1, maxLength: 5 }),
        fc.array(channel, { maxLength: 3 }),
        fc.array(channel, { maxLength: 4 }),
        (rules, retained, triggers) => {
          const bus = createBus();
          const log: Delivery[] = [];
          retained.forEach((ch, i) => bus.emit(ch, `r${i}`));
          rules.forEach((r, listener) =>
            bus.on(r.on, value => {
              const v = value as string;
              // Logging after the emit exposes any delivery nested inside it instead of queued.
              if (r.to && depthOf(v) < MAX_DEPTH) bus.emit(r.to, `${v}.${listener}`);
              log.push({ listener, channel: r.on, value: v });
            })
          );

          triggers.forEach((ch, i) => bus.emit(ch, `${i}`));

          expect(log).toEqual(fifoModel(rules, retained, triggers));
        }
      ),
      settings(2)
    );
  });

  it('delivers every value to every listener however many siblings throw', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: 5 }),
        (throws, emits) => {
          const reported = stubReportError();
          const bus = createBus();
          const received = throws.map(() => [] as unknown[]);
          throws.forEach((throwing, i) =>
            bus.on('a', value => {
              received[i]!.push(value);
              if (throwing) throw new Error(`listener ${i}`);
            })
          );

          const values = Array.from({ length: emits }, (_, i) => i);
          values.forEach(value => expect(() => bus.emit('a', value)).not.toThrow());

          received.forEach(log => expect(log).toEqual(values));
          expect(reported).toHaveBeenCalledTimes(throws.filter(Boolean).length * emits);
          vi.unstubAllGlobals();
        }
      ),
      settings(3)
    );
  });

  type CopyOp =
    | { kind: 'emit'; copy: number; channel: ChannelId; value: number; retain: boolean }
    | { kind: 'on'; copy: number; channel: ChannelId };

  it('behaves as one bus however operations spread over several copies of the module', async () => {
    const copies: { bus: Bus }[] = [];
    for (let i = 0; i < 3; i++) {
      vi.resetModules();
      copies.push(await import('../src/lib/global/global-bus.js'));
    }
    expect(new Set(copies.map(c => c.bus)).size).toBe(3);
    const op: fc.Arbitrary<CopyOp> = fc.oneof(
      fc.record({
        kind: fc.constant('emit' as const),
        copy: fc.nat({ max: 2 }),
        channel,
        value: fc.integer({ min: 0, max: 99 }),
        retain: fc.boolean(),
      }),
      fc.record({ kind: fc.constant('on' as const), copy: fc.nat({ max: 2 }), channel })
    );

    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), ops => {
        delete globalThis.__NF_BUS__;
        const reference = createBus();
        const spread: unknown[][] = [];
        const single: unknown[][] = [];

        ops.forEach(o => {
          const target = copies[o.copy]!.bus;
          if (o.kind === 'emit') {
            target.emit(o.channel, o.value, { retain: o.retain });
            reference.emit(o.channel, o.value, { retain: o.retain });
            return;
          }
          const mine: unknown[] = [];
          const theirs: unknown[] = [];
          spread.push(mine);
          single.push(theirs);
          target.on(o.channel, value => mine.push(value));
          reference.on(o.channel, value => theirs.push(value));
        });

        expect(spread).toEqual(single);
        CHANNELS.forEach(ch =>
          copies.forEach(c => expect(c.bus.peek(ch)).toBe(reference.peek(ch)))
        );
      }),
      settings(4)
    );
    delete globalThis.__NF_BUS__;
  });
});

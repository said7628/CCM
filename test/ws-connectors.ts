/**
 * Offline parsing tests for the WebSocket connectors.
 *
 * The live sockets need network, but the part that actually breaks is message
 * parsing (field names, snapshot-vs-delta, signed amounts, removals). We feed
 * each connector's private onMessage() real-shaped sample payloads and assert
 * the resulting top-of-book — no network required.
 */
import assert from 'assert';
import { OkxWsClient } from '../src/exchanges/okx-ws';
import { CoinbaseWsClient } from '../src/exchanges/coinbase-ws';
import { BitstampWsClient } from '../src/exchanges/bitstamp-ws';
import { GeminiWsClient } from '../src/exchanges/gemini-ws';
import { GateWsClient } from '../src/exchanges/gate-ws';
import { BitfinexWsClient } from '../src/exchanges/bitfinex-ws';
import { KucoinWsClient } from '../src/exchanges/kucoin-ws';

function feed(client: unknown, msg: unknown): void {
  // call the private onMessage with a Buffer, as ws would
  (client as { onMessage(raw: Buffer): void }).onMessage(Buffer.from(JSON.stringify(msg)));
}

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

console.log('WebSocket connector parsing tests:');

check('okx books5 snapshot -> top of book', () => {
  const c = new OkxWsClient('BTC/USDT', 5, () => {});
  feed(c, { arg: { channel: 'books5', instId: 'BTC-USDT' }, data: [{
    asks: [['70010.5', '1.2', '0', '1'], ['70011', '0.5', '0', '1']],
    bids: [['70009.5', '0.8', '0', '1'], ['70009', '2.0', '0', '1']], ts: '1700000000000',
  }] });
  assert.ok(c.isReady(), 'should be ready after snapshot');
  const b = c.getOrderBook();
  assert.strictEqual(b.bids[0].price, 70009.5);
  assert.strictEqual(b.asks[0].price, 70010.5);
  assert.strictEqual(b.exchange, 'okx');
});

check('coinbase level2 snapshot + update + removal', () => {
  const c = new CoinbaseWsClient('BTC/USDT', 10, () => {});
  feed(c, { channel: 'l2_data', events: [{ type: 'snapshot', product_id: 'BTC-USD', updates: [
    { side: 'bid', price_level: '70000', new_quantity: '1.0' },
    { side: 'offer', price_level: '70002', new_quantity: '1.5' },
    { side: 'offer', price_level: '70003', new_quantity: '2.0' },
  ] }] });
  assert.strictEqual(c.getOrderBook().asks[0].price, 70002);
  // update: improve the bid, remove the 70002 ask
  feed(c, { channel: 'l2_data', events: [{ type: 'update', product_id: 'BTC-USD', updates: [
    { side: 'bid', price_level: '70001', new_quantity: '0.5' },
    { side: 'offer', price_level: '70002', new_quantity: '0' },
  ] }] });
  const b = c.getOrderBook();
  assert.strictEqual(b.bids[0].price, 70001, 'best bid should update to 70001');
  assert.strictEqual(b.asks[0].price, 70003, '70002 ask should be removed');
});

check('bitstamp order_book full snapshot each msg', () => {
  const c = new BitstampWsClient('BTC/USDT', 10, () => {});
  feed(c, { event: 'data', channel: 'order_book_btcusdt', data: {
    bids: [['70000.00', '0.5'], ['69999.00', '1.0']],
    asks: [['70001.00', '0.7'], ['70002.00', '1.2']], timestamp: '1700000000',
  } });
  const b = c.getOrderBook();
  assert.strictEqual(b.bids[0].price, 70000);
  assert.strictEqual(b.asks[0].price, 70001);
});

check('gemini l2 snapshot then delta', () => {
  const c = new GeminiWsClient('BTC/USDT', 10, () => {});
  feed(c, { type: 'l2_updates', symbol: 'BTCUSD', changes: [
    ['buy', '70000', '1.0'], ['sell', '70005', '2.0'], ['sell', '70006', '1.0'],
  ] });
  assert.strictEqual(c.getOrderBook().asks[0].price, 70005);
  feed(c, { type: 'l2_updates', symbol: 'BTCUSD', changes: [['sell', '70005', '0'], ['buy', '70001', '0.3']] });
  const b = c.getOrderBook();
  assert.strictEqual(b.asks[0].price, 70006, 'removed 70005 ask');
  assert.strictEqual(b.bids[0].price, 70001, 'new best bid 70001');
});

check('gate spot.order_book full snapshot', () => {
  const c = new GateWsClient('BTC/USDT', 20, () => {});
  feed(c, { channel: 'spot.order_book', event: 'update', result: {
    bids: [['70000', '0.4'], ['69998', '1.0']],
    asks: [['70004', '0.9'], ['70005', '1.1']], t: 1700000000000,
  } });
  const b = c.getOrderBook();
  assert.strictEqual(b.bids[0].price, 70000);
  assert.strictEqual(b.asks[0].price, 70004);
});

check('bitfinex book snapshot + signed-amount sides + removal', () => {
  const c = new BitfinexWsClient('BTC/USDT', 25, () => {});
  // snapshot: [price, count, amount]; amount>0 bid, amount<0 ask
  feed(c, [12345, [
    [70000, 1, 0.5],   // bid
    [69999, 2, 1.2],   // bid
    [70002, 1, -0.8],  // ask
    [70003, 3, -2.0],  // ask
  ]]);
  let b = c.getOrderBook();
  assert.strictEqual(b.bids[0].price, 70000, 'best bid');
  assert.strictEqual(b.asks[0].price, 70002, 'best ask');
  assert.strictEqual(b.asks[0].amount, 0.8, 'ask amount is absolute value');
  // update: remove the 70002 ask (count=0, amount=-1 means ask side)
  feed(c, [12345, [70002, 0, -1]]);
  b = c.getOrderBook();
  assert.strictEqual(b.asks[0].price, 70003, '70002 ask removed');
  // update: new best bid
  feed(c, [12345, [70001, 1, 0.2]]);
  assert.strictEqual(c.getOrderBook().bids[0].price, 70001);
  // heartbeat must be ignored
  feed(c, [12345, 'hb']);
  assert.strictEqual(c.getOrderBook().bids[0].price, 70001);
});

check('kucoin level2Depth5 full snapshot', () => {
  const c = new KucoinWsClient('BTC/USDT', 5, () => {});
  feed(c, { type: 'message', topic: '/spotMarket/level2Depth5:BTC-USDT', data: {
    asks: [['70010', '0.5'], ['70011', '1.0']],
    bids: [['70009', '0.6'], ['70008', '1.2']], timestamp: 1700000000000,
  } });
  const b = c.getOrderBook();
  assert.strictEqual(b.bids[0].price, 70009);
  assert.strictEqual(b.asks[0].price, 70010);
});

console.log(`\n${passed} parsing checks passed.`);
